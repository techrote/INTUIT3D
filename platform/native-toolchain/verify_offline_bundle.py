#!/usr/bin/env python3
"""Offline SHA-256/SONAME inventory verifier; no repo, network or OCCT required."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import sys


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    root = Path(__file__).resolve().parent
    try:
        manifest = json.loads((root / "manifest.json").read_text())
        if manifest.get("schema") != "intuit3d/pinned-occt801-offline-linux-bundle-v1":
            raise ValueError("incorrect bundle schema")
        files, links = {}, {}
        for path in root.rglob("*"):
            rel = path.relative_to(root).as_posix()
            if rel == "manifest.json":
                continue
            if path.is_symlink():
                if not path.resolve().is_relative_to(root):
                    raise ValueError(f"escaping bundle SONAME symlink: {rel}")
                links[rel] = os.readlink(path)
            elif path.is_file():
                files[rel] = sha256(path)
        if files != manifest["files"]:
            raise ValueError("bundle file missing, added or SHA-256 mismatch")
        if links != manifest["links"]:
            raise ValueError("bundle symlink missing, added or redirected")
        if sha256(root / "bin/intuit3d_occt8_plate") != manifest["workerSha256"]:
            raise ValueError("worker ELF hash mismatch")
        print("OCCT801_OFFLINE_BUNDLE_VERIFY_PASS",
              manifest["occtSourceCommit"], manifest["kernelSourceCommit"])
        return 0
    except (OSError, KeyError, ValueError) as exc:
        print("OCCT801_OFFLINE_BUNDLE_VERIFY_FAIL:", exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
