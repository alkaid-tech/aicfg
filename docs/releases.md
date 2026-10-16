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

### Apple signing and notarization

Developer ID signing requires an active Apple Developer Program membership, a **Developer ID Application** certificate with its private key, and notarization credentials. While enrollment is pending, leave all six Apple secrets unset: the workflow can still publish an unsigned preview containing application fixes such as Finder PATH discovery.

The workflow selects distribution mode from the Apple secrets:

| Configuration | Result |
| --- | --- |
| All six secrets unset | Publish an unsigned, unnotarized preview with an ad-hoc app signature, `_unsigned` asset names, and a prominent notice in the release notes. |
| All six secrets configured | Sign with Developer ID, notarize, and verify before publishing. |
| Some secrets configured | Fail with the missing secret names; do not fall back to an unsigned release. |

After enrollment is approved, configure all of these repository secrets under **Settings → Secrets and variables → Actions**. The next build automatically uses Developer ID signing and notarization:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` export containing the Developer ID Application certificate and private key. |
| `APPLE_CERTIFICATE_PASSWORD` | Nonempty password used when exporting the `.p12` file. |
| `APPLE_SIGNING_IDENTITY` | Full certificate identity, such as `Developer ID Application: Your Name (TEAMID)`. |
| `APPLE_ID` | Apple Account email used for notarization. |
| `APPLE_PASSWORD` | An app-specific password for that account, rather than its account password. |
| `APPLE_TEAM_ID` | Apple Developer team ID associated with the certificate. |

Export the certificate and private key from Keychain Access as a password-protected `.p12` file. Encode it locally with:

```sh
openssl base64 -A -in /path/to/certificate.p12 -out certificate-base64.txt
```

Save the file contents as `APPLE_CERTIFICATE`. Do not commit either file. Find the signing identity with `security find-identity -v -p codesigning`. See [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/) for certificate creation and notarization setup.

With all credentials configured, Tauri imports the certificate into a temporary keychain, signs the Universal app and DMG with hardened runtime enabled for the application, and notarizes and staples the app. The workflow separately notarizes and staples the DMG, verifies both signatures and stapled tickets, and checks the app with Gatekeeper before packaging or publishing. Invalid or incomplete credentials, signing failures, and notarization or verification failures leave the release unpublished; a failed signed build never falls back to an unsigned preview.

An ad-hoc signature does not identify the developer or remove Gatekeeper's unverified-app warning. Enrollment approval alone does not change existing downloads: configure the secrets and publish a new version to distribute a Developer ID signed, notarized app.

Previously downloaded unsigned releases remain unsigned. For an existing trusted copy, macOS offers **System Settings → Privacy & Security → Open Anyway** after a blocked launch. This exception applies to that copy; a later download or replacement may need approval again. Clearing quarantine attributes does not sign or notarize the app. See [Apple's guidance on opening apps](https://support.apple.com/en-us/102445).

## Publish a release

1. Merge changes into `main` with Conventional Commit messages. Release Please opens or updates one release PR containing the proposed version and changelog.
2. Review the release PR, including the generated `CHANGELOG.md`, and merge it when ready.
3. The workflow creates a `vMAJOR.MINOR.PATCH` tag and a draft GitHub Release, checks out that exact tag, verifies versions, selects the signing mode, runs frontend and Rust checks, and builds Universal application and DMG packages using the committed lockfiles.
4. The workflow verifies the built application's version, both CPU architectures, and app signature. Signed builds also require valid Developer ID signatures, notarization tickets, and Gatekeeper acceptance. It records the distribution mode in the release notes, uploads the assets, and publishes the Release after every required step succeeds.

The PR synchronizes `desktop/package.json`, both application lockfiles, `desktop/src-tauri/Cargo.toml`, and the Tauri configuration. `.release-please-manifest.json` starts empty so that the first release remains `0.1.0`; subsequent release PRs track the released version there. Do not manually increment these files for ordinary releases.

You can run **Actions → Release → Run workflow** on `main` with the tag field empty to refresh the release PR, including when initially enabling the workflow.

## Release assets

Every release contains:

- `aicfg_<version>_universal.dmg`: the macOS installer.
- `aicfg_<version>_universal.app.zip`: a compressed application bundle.
- `SHA256SUMS`: checksums for both downloads.

Unsigned previews use `aicfg_<version>_universal_unsigned.dmg` and `aicfg_<version>_universal_unsigned.app.zip` instead. Their release notes explain the Gatekeeper warning and how to open a trusted copy. Here, "unsigned" means there is no Apple Developer ID signature or notarization; the app has an ad-hoc signature for Apple Silicon compatibility.

The same files are retained as a workflow artifact for 14 days. Verify downloaded assets from their directory with:

```sh
shasum -a 256 -c SHA256SUMS
```

Developer ID signed releases are notarized. They can still show macOS's normal first-launch confirmation for an application downloaded from the Internet. Unsigned previews continue to require an explicit Gatekeeper exception for a trusted copy. Both modes include the same application code and require local Git and Node.js with npm/npx; the app discovers the shell's `PATH` for Finder launches, as described in the [development guide](development.md#runtime-executable-discovery).

## Recover a failed build

Failed builds leave the Release as a draft. Fix incomplete or invalid Apple credentials, transient runner issues, or network problems, then run **Actions → Release → Run workflow** on `main` and enter the existing tag, for example `v0.1.0`. The workflow rebuilds the exact tagged source, replaces any partially uploaded assets, and publishes only after successful checks. If a retry changes signing mode, it updates the release notice and removes this version's application and DMG assets from the previous mode after uploading their replacements.

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

For signed local builds, install the Developer ID certificate in your keychain and export `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` before building. Tauri signs the app and DMG and notarizes the app; reproduce the workflow's separate DMG notarization and validation steps before distributing the DMG. Never modify bundle contents after signing.
