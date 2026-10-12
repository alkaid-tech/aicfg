# Releases

The [Release workflow](../.github/workflows/release.yml) uses [Release Please](https://github.com/googleapis/release-please-action) to propose versions and release notes from Conventional Commits. Merging the generated release PR builds and publishes a macOS Universal application for Apple Silicon and Intel.

## Version policy

The first release is `0.1.0`. After that, the highest-impact change since the previous release determines the next version:

| Change | Before 1.0 | From 1.0 onward |
| --- | --- | --- |
| `fix`, `perf`, or `revert` | Patch: `0.1.0` → `0.1.1` | Patch: `1.2.0` → `1.2.1` |
| `feat` | Minor: `0.1.0` → `0.2.0` | Minor: `1.2.0` → `1.3.0` |
| `!` or a `BREAKING CHANGE:` footer | Minor: `0.1.0` → `0.2.0` | Major: `1.2.0` → `2.0.0` |

Changes such as `docs`, `test`, `ci`, and `chore` do not trigger a release on their own unless they declare a breaking change. Several fixes in one release produce a single patch increment. A feature combined with fixes produces a single minor increment. Use English Conventional Commit messages, including the PR title when squash merging.

Version calculation considers commits that touch `desktop/`, along with empty commits used for explicit version overrides. Changes confined to repository documentation or workflows do not initiate an application release.

The `0.x` series represents development releases, so breaking changes do not automatically declare the product stable. When intentionally moving to `1.0.0`, add an explicit version override:

```sh
git commit --allow-empty -m "chore: prepare stable release" -m "Release-As: 1.0.0"
git push origin main
```

Release Please will propose that version in a release PR. Use `Release-As` only for an intentional exception, and choose a version higher than the last release. The policy is configured in [release-please-config.json](../release-please-config.json).

## Repository setup

Enable GitHub Actions, and allow Actions to create pull requests under **Settings → Actions → General → Workflow permissions**. The workflow grants its release preparation job permission to write contents, pull requests, and issue labels.

For CI to run automatically on generated release PRs, add the repository secret `RELEASE_PLEASE_TOKEN`. Use a fine-grained personal access token with access to this repository and **Contents**, **Pull requests**, and **Issues** read/write permissions. A GitHub App token with equivalent permissions also works.

Without this secret, the workflow uses the built-in `GITHUB_TOKEN`. GitHub does not start new workflows for PRs created with that token, so required PR checks will need a human-triggered event, such as closing and reopening the PR. Release builds still run their own tests and checks. Packaging runs in the same workflow that creates the release, so it does not depend on a tag event starting another workflow.

## Publish a release

1. Merge changes into `main` with Conventional Commit messages. Release Please opens or updates one release PR containing the proposed version and changelog.
2. Review the release PR, including the generated `CHANGELOG.md`, and merge it when ready.
3. The workflow creates a `vMAJOR.MINOR.PATCH` tag and a draft GitHub Release, checks out that exact tag, verifies versions, runs frontend and Rust checks, and builds the Universal application and DMG using the committed lockfiles.
4. The workflow verifies the built application's version and both CPU architectures, uploads the assets, and publishes the Release after every step succeeds.

The PR synchronizes `desktop/package.json`, both application lockfiles, `desktop/src-tauri/Cargo.toml`, and the Tauri configuration. `.release-please-manifest.json` starts empty so that the first release remains `0.1.0`; subsequent release PRs track the released version there. Do not manually increment these files for ordinary releases.

You can run **Actions → Release → Run workflow** on `main` with the tag field empty to refresh the release PR, including when initially enabling the workflow.

## Release assets

Every release contains:

- `aicfg_<version>_universal.dmg`: the macOS installer.
- `aicfg_<version>_universal.app.zip`: a compressed application bundle.
- `SHA256SUMS`: checksums for both downloads.

The same files are retained as a workflow artifact for 14 days. Verify downloaded assets from their directory with:

```sh
shasum -a 256 -c SHA256SUMS
```

These packages are not signed with an Apple Developer ID or notarized. macOS Gatekeeper may block downloaded applications; formal signing and notarization remain planned. The installed app still requires `git` and `npx` on `PATH`, as described in the [development guide](development.md).

## Recover a failed build

Failed builds leave the Release as a draft. Fix transient runner or network problems, then run **Actions → Release → Run workflow** on `main` and enter the existing tag, for example `v0.1.0`. The workflow rebuilds the exact tagged source, replaces any partially uploaded assets, and publishes only after successful checks.

Retrying the original workflow does not necessarily return Release Please's release creation outputs a second time; use the tag input for recovery. Published releases cannot be resumed or overwritten with this workflow. If the tagged source needs a code fix, abandon the draft and prepare a new version rather than moving the existing tag.

## Local verification

With Python 3.11 or newer, check version consistency from the repository root:

```sh
python3 scripts/check-release-version.py
```

On a checkout of an actual release tag, also verify the tag:

```sh
python3 scripts/check-release-version.py --tag v0.1.0
```

To reproduce the release bundle on macOS:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
cd desktop
npm ci
CI=true npm run bundle -- --target universal-apple-darwin --bundles app,dmg --ci -- --locked
```
