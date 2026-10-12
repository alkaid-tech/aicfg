"""Check that desktop manifests, lockfiles, and release tags agree."""

import argparse
import json
from pathlib import Path
import re
import sys
import tomllib


ROOT = Path(__file__).resolve().parents[1]
VERSION_PATTERN = r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"


def check_versions(root: Path, tag: str | None = None) -> str:
    desktop = root / "desktop"
    package = json.loads((desktop / "package.json").read_text())
    npm_lock = json.loads((desktop / "package-lock.json").read_text())
    tauri = json.loads((desktop / "src-tauri/tauri.conf.json").read_text())
    cargo = tomllib.loads((desktop / "src-tauri/Cargo.toml").read_text())
    cargo_lock = tomllib.loads((desktop / "src-tauri/Cargo.lock").read_text())
    manifest = json.loads((root / ".release-please-manifest.json").read_text())

    version = tauri["version"]
    if not isinstance(version, str) or not re.fullmatch(VERSION_PATTERN, version):
        raise ValueError(f"Expected a stable semantic version, got {version!r}")

    locked_packages = [
        entry for entry in cargo_lock["package"]
        if entry["name"] == cargo["package"]["name"]
    ]
    if len(locked_packages) != 1:
        raise ValueError("Cargo.lock must contain exactly one application package")

    versions = {
        "package.json": package["version"],
        "package-lock.json": npm_lock["version"],
        "package-lock.json root package": npm_lock["packages"][""]["version"],
        "Cargo.toml": cargo["package"]["version"],
        "Cargo.lock application package": locked_packages[0]["version"],
    }
    if "desktop" in manifest:
        versions["release-please manifest"] = manifest["desktop"]
    elif tag is not None:
        raise ValueError("The release-please manifest has no desktop release version")

    if tag is not None:
        if not re.fullmatch(f"v{VERSION_PATTERN}", tag):
            raise ValueError(f"Expected a release tag in vMAJOR.MINOR.PATCH format, got {tag!r}")
        versions["release tag"] = tag[1:]

    mismatches = [
        f"{name} = {value!r}" for name, value in versions.items() if value != version
    ]
    if mismatches:
        raise ValueError(f"Release versions must all equal {version}: " + "; ".join(mismatches))
    return version


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="Require the checked-out release to match this tag")
    args = parser.parse_args()
    try:
        version = check_versions(ROOT, args.tag)
    except (KeyError, OSError, ValueError) as error:
        print(f"Release version check failed: {error}", file=sys.stderr)
        sys.exit(1)
    print(f"Release versions are consistent: {version}")


if __name__ == "__main__":
    main()
