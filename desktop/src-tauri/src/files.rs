use crate::domain::Result;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path, process::Command};

pub fn read(path: &Path) -> Result<String> {
    fs::read_to_string(path).map_err(|e| format!("Could not read {}: {e}", path.display()))
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("File has no parent directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn command(cwd: &Path, program: &str, args: &[&str]) -> Result<String> {
    let mut command = Command::new(program);
    #[cfg(target_os = "macos")]
    command.env("PATH", crate::runtime::path());
    let output = command
        .current_dir(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("DISABLE_TELEMETRY", "1")
        .output()
        .map_err(|e| {
            if program == "npx" && e.kind() == std::io::ErrorKind::NotFound {
                format!("Could not run npx. Install Node.js 22.12 or newer with npm/npx, ensure your login shell can run node and npx, then restart aicfg: {e}")
            } else {
                format!("Could not run {program}. Ensure it is installed and available on PATH: {e}")
            }
        })?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{program} failed: {}",
            message.chars().take(2000).collect::<String>()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
pub fn tree(root: &Path) -> Result<BTreeMap<String, Vec<u8>>> {
    fn collect(base: &Path, dir: &Path, values: &mut BTreeMap<String, Vec<u8>>) -> Result<()> {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if entry.file_name() == ".git" {
                continue;
            }
            if kind.is_symlink() {
                return Err(format!(
                    "Skill content contains symbolic links. Verify the source first: {}",
                    path.display()
                ));
            }
            if kind.is_dir() {
                collect(base, &path, values)?;
            } else if kind.is_file() {
                let key = path
                    .strip_prefix(base)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                values.insert(key, fs::read(path).map_err(|e| e.to_string())?);
            }
        }
        Ok(())
    }
    let mut result = BTreeMap::new();
    collect(root, root, &mut result)?;
    Ok(result)
}
pub fn tree_hash(values: &BTreeMap<String, Vec<u8>>) -> String {
    let mut digest = Sha256::new();
    for (path, contents) in values {
        digest.update((path.len() as u64).to_le_bytes());
        digest.update(path);
        digest.update((contents.len() as u64).to_le_bytes());
        digest.update(contents);
    }
    format!("{:x}", digest.finalize())
}
pub fn safe_relative(value: &str) -> Result<()> {
    let path = Path::new(value);
    if value.is_empty()
        || path
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err(format!("Invalid relative path: {value}"));
    }
    Ok(())
}
pub fn guard_ancestors(root: &Path, relative: &str) -> Result<()> {
    safe_relative(relative)?;
    let mut current = root.to_path_buf();
    let parts = Path::new(relative).components().collect::<Vec<_>>();
    for part in &parts[..parts.len().saturating_sub(1)] {
        current.push(part.as_os_str());
        if fs::symlink_metadata(&current).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(format!(
                "{} is an existing symbolic link. Adjust the directory layout first",
                current.display()
            ));
        }
    }
    Ok(())
}
pub fn marked(original: &str, body: &str) -> Result<String> {
    const START: &str = "<!-- aicfg:begin -->";
    const END: &str = "<!-- aicfg:end -->";
    let starts = original.matches(START).count();
    let ends = original.matches(END).count();
    if starts > 1 || ends > 1 || starts != ends {
        return Err("The instruction file has incomplete or duplicate aicfg managed regions. Repair the markers first".into());
    }
    let block = format!("{START}\n{body}\n{END}");
    if let (Some(a), Some(b)) = (original.find(START), original.find(END)) {
        if b < a {
            return Err("aicfg managed region markers are out of order".into());
        }
        Ok(format!(
            "{}{}{}",
            &original[..a],
            block,
            &original[b + END.len()..]
        ))
    } else {
        Ok(format!(
            "{}{}{}\n",
            original,
            if original.is_empty() || original.ends_with('\n') {
                ""
            } else {
                "\n"
            },
            block
        ))
    }
}
