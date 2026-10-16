use std::{
    env,
    ffi::{OsStr, OsString},
    io::{Read, Seek},
    os::unix::ffi::OsStringExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::OnceLock,
    thread,
    time::{Duration, Instant},
};

const SYSTEM_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
const PATH_PROBE: &str = "printf '\\000AICFG_PATH\\000%s\\000' \"$PATH\"";

pub(crate) fn path() -> &'static OsStr {
    static PATH: OnceLock<OsString> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = env::var_os("SHELL")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| PathBuf::from("/bin/zsh"));
        let home = env::var_os("HOME").map(PathBuf::from);
        discover_path(
            &shell,
            home.as_deref(),
            env::var_os("PATH").as_deref(),
            Duration::from_secs(5),
        )
    })
}

fn discover_path(
    shell: &Path,
    home: Option<&Path>,
    inherited: Option<&OsStr>,
    timeout: Duration,
) -> OsString {
    let shell_path = shell_path(shell, home, inherited, timeout);
    let mut paths = Vec::new();
    for value in [shell_path.as_deref(), inherited].into_iter().flatten() {
        paths.extend(env::split_paths(value));
    }
    if let Some(home) = home {
        paths.extend(
            [
                ".volta/bin",
                ".asdf/shims",
                ".local/share/mise/shims",
                ".local/bin",
            ]
            .map(|directory| home.join(directory)),
        );
    }
    paths.extend(env::split_paths(OsStr::new(
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    )));
    let mut unique = Vec::new();
    for path in paths {
        // Never search the current repository for runtime executables.
        if path.is_absolute() && !unique.contains(&path) {
            unique.push(path);
        }
    }
    env::join_paths(unique).unwrap_or_else(|_| OsString::from(SYSTEM_PATH))
}

fn shell_path(
    shell: &Path,
    home: Option<&Path>,
    inherited: Option<&OsStr>,
    timeout: Duration,
) -> Option<OsString> {
    // A file avoids pipe deadlocks from verbose startup scripts or background jobs.
    let mut stdout = tempfile::tempfile().ok()?;
    let mut command = Command::new(shell);
    command
        .args(["-ilc", PATH_PROBE])
        .env("PATH", inherited.unwrap_or_else(|| OsStr::new(SYSTEM_PATH)))
        .env("DISABLE_AUTO_UPDATE", "true")
        .stdin(Stdio::null())
        .stdout(stdout.try_clone().ok()?)
        .stderr(Stdio::null());
    if let Some(home) = home {
        command.current_dir(home);
    }
    let mut child = command.spawn().ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    stdout.rewind().ok()?;
    let mut output = Vec::new();
    stdout.take(1024 * 1024).read_to_end(&mut output).ok()?;
    let mut fields = output.split(|byte| *byte == 0);
    while let Some(field) = fields.next() {
        if field == b"AICFG_PATH" {
            let path = fields.next()?;
            return (!path.is_empty()).then(|| OsString::from_vec(path.to_vec()));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt};

    fn executable(path: &Path, script: &str) {
        fs::write(path, script).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn finder_path_can_run_npx_and_its_node_interpreter() {
        let temp = tempfile::tempdir().unwrap();
        let bin = temp.path().join("Node installation with spaces");
        fs::create_dir(&bin).unwrap();
        executable(
            &bin.join("node"),
            "#!/bin/sh\nprintf 'node found: %s' \"$2\"\n",
        );
        executable(&bin.join("npx"), "#!/usr/bin/env node\n");
        let shell = temp.path().join("shell");
        executable(
            &shell,
            "#!/bin/sh\n[ \"$1\" = -ilc ] || exit 1\n[ \"$PWD\" -ef \"${0%/*}\" ] || exit 1\nprintf 'startup message\\n'\nPATH=\"$PWD/Node installation with spaces:$PATH\"\nexport PATH\n/bin/sh -c \"$2\"\nprintf '\\nshutdown message'\n",
        );
        let path = discover_path(
            &shell,
            Some(temp.path()),
            Some(OsStr::new(SYSTEM_PATH)),
            Duration::from_secs(1),
        );
        let output = Command::new("npx")
            .env("PATH", path)
            .arg("argument with spaces; $(literal)")
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert_eq!(
            output.stdout,
            b"node found: argument with spaces; $(literal)"
        );
    }

    #[test]
    fn unavailable_or_broken_shell_keeps_inherited_and_fallback_paths() {
        let temp = tempfile::tempdir().unwrap();
        let shell = temp.path().join("shell");
        for script in [
            None,
            Some("#!/bin/sh\nexit 1\n"),
            Some("#!/bin/sh\necho noise\n"),
        ] {
            if let Some(script) = script {
                executable(&shell, script);
            }
            let path = discover_path(
                &shell,
                Some(temp.path()),
                Some(OsStr::new(
                    "/custom/node/bin:/usr/bin:/custom/node/bin::relative",
                )),
                Duration::from_secs(1),
            );
            let paths: Vec<_> = env::split_paths(&path).collect();
            assert_eq!(paths[0], Path::new("/custom/node/bin"));
            assert!(paths.contains(&temp.path().join(".volta/bin")));
            assert!(paths.contains(&PathBuf::from("/opt/homebrew/bin")));
            assert!(paths.contains(&PathBuf::from("/usr/local/bin")));
            assert!(paths.iter().all(|path| path.is_absolute()));
            assert_eq!(
                paths
                    .iter()
                    .filter(|path| **path == Path::new("/custom/node/bin"))
                    .count(),
                1
            );
        }
    }

    #[test]
    fn stalled_shell_times_out_and_preserves_a_usable_path() {
        let temp = tempfile::tempdir().unwrap();
        let shell = temp.path().join("shell");
        executable(&shell, "#!/bin/sh\nexec /bin/sleep 10\n");
        let started = Instant::now();
        let path = discover_path(&shell, None, None, Duration::from_millis(40));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(env::split_paths(&path).any(|path| path == Path::new("/usr/bin")));
    }
}
