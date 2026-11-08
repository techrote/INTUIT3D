#!/usr/bin/env python3
"""Install a hash-pinned, source-matched OCCT 8.0.1 offline worker archive.

No network or source checkout is required. Replays the ACTUAL extracted C++
worker before publishing the destination; never promotes source-only fixtures.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile

from abi_compat import ABIError, verify_abi
from execution_environment import sealed_env


ROOT_NAME = "offline-occt801"
BUNDLE_SCHEMA = "intuit3d/pinned-occt801-offline-linux-bundle-v1"
OCCT_SHA = "b8f597c677811d1f9f4d8a97f5ae2825c0353a42"
MAX_MEMBERS = 1000
MAX_UNPACKED_BYTES = 2 * 1024**3


class InstallError(RuntimeError):
    """An archive may not be installed or described as qualified."""


def require(ok: bool, explanation: str) -> None:
    if not ok:
        raise InstallError(explanation)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(data)
    return h.hexdigest()


def validate_archive(tar: tarfile.TarFile) -> None:
    """Restrict extraction to the canonical bundle root and SONAME symlinks."""
    members = tar.getmembers()
    require(0 < len(members) <= MAX_MEMBERS, "invalid archive entry count")
    seen: set[str] = set()
    uncompressed = 0
    for member in members:
        name = member.name
        components = PurePosixPath(name).parts
        require(name not in seen, f"duplicate archive path: {name}")
        seen.add(name)
        require(bool(components) and components[0] == ROOT_NAME
                and all(x not in (".", "..", "") for x in components)
                and not name.startswith("/"), f"unsafe archive path: {name}")
        require(member.isdir() or member.isfile() or member.issym(),
                f"unsupported archive entry: {name}")
        if member.issym():
            # The packager only emits sibling library SONAME aliases, so a
            # link crossing directories is not needed or safe to import.
            target = member.linkname
            require(len(components) == 3 and components[1] == "lib"
                    and target and target not in (".", "..")
                    and "/" not in target and "\\" not in target,
                    f"unsafe/non-library archive symlink: {name}")
        if member.isfile():
            uncompressed += member.size
            require(uncompressed <= MAX_UNPACKED_BYTES,
                    "offline bundle exceeds uncompressed size bound")
    require(f"{ROOT_NAME}/manifest.json" in seen
            and f"{ROOT_NAME}/verify.py" in seen
            and f"{ROOT_NAME}/selftest.py" in seen
            and f"{ROOT_NAME}/bin/intuit3d_occt8_plate" in seen,
            "missing required offline executable/verification files")


def run_gate(command: list[str], cwd: Path, label: str, timeout: int) -> str:
    completed = subprocess.run(command, cwd=cwd, capture_output=True,
                               text=True, timeout=timeout, check=False,
                               env=sealed_env())
    require(completed.returncode == 0,
            f"{label} failed (exit={completed.returncode}): "
            + (completed.stderr + completed.stdout)[-1400:])
    return completed.stdout


def install(archive: Path, destination: Path, expected_digest: str,
            expected_kernel_sha: str) -> dict:
    require(sys.platform == "linux", "offline C++ ELF bundle requires Linux")
    require(re.fullmatch(r"[a-f0-9]{64}", expected_digest) is not None,
            "expected archive SHA-256 must be a 64-digit lowercase digest")
    require(re.fullmatch(r"[a-f0-9]{40}", expected_kernel_sha) is not None,
            "expected Kernel SHA must be an immutable 40-digit commit")
    archive = archive.absolute()
    destination = destination.absolute()
    require(archive.is_file() and not archive.is_symlink(),
            "source archive does not exist or is a symlink")
    require(not os.path.lexists(destination), "destination already exists; no overwrite")
    actual_digest = sha256(archive)
    require(actual_digest == expected_digest, "offline archive SHA-256 mismatch")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".intuit3d-occt8-stage-",
                                     dir=destination.parent) as staging:
        stage = Path(staging)
        with tarfile.open(archive, "r:gz") as source:
            validate_archive(source)
            source.extractall(stage, filter="data")
        root = stage / ROOT_NAME
        require(root.is_dir() and not root.is_symlink(),
                "extracted archive root missing")
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        require(manifest.get("schema") == BUNDLE_SCHEMA
                and manifest.get("occtVersion") == "8.0.1"
                and manifest.get("occtSourceCommit") == OCCT_SHA
                and manifest.get("kernelSourceCommit") == expected_kernel_sha
                and manifest.get("nativeCppExecuted") is True
                and manifest.get("independentCadInteroperability") is False,
                "unsupported/unqualified/mismatched native source manifest")
        worker = root / "bin/intuit3d_occt8_plate"
        require(worker.is_file() and os.access(worker, os.X_OK)
                and sha256(worker) == manifest.get("workerSha256"),
                "native executable absent, not executable or digest mismatch")
        run_gate([sys.executable, str(root / "verify.py")], root,
                 "archive SHA-256/SONAME verification", 60)
        abi_record = verify_abi(worker, root / "lib", manifest.get("elfAbiProfile"))
        result = json.loads(run_gate([sys.executable, str(root / "selftest.py")],
                                    root, "extracted native C++/STEP replay", 450))
        require(result.get("status") == "OFFLINE_CXX_REPLAY_PASS"
                and result.get("kernelSourceCommit") == expected_kernel_sha
                and result.get("workerSha256") == manifest.get("workerSha256")
                and result.get("dimensionEditExecuted") is True
                and result.get("dimensionsRestored") is True
                and set(result.get("cases", {})) == {"8", "12", "edited8", "restored8"},
                "extracted native worker did not pass four source-matched STEP cases")
        require(not os.path.lexists(destination), "destination appeared during verification")
        root.rename(destination)
    # Export only checked, real paths; consumer uses INTUIT3D_OCCT8_WORKER.
    return {
        "status": "OFFLINE_OCCT8_INSTALL_PASS",
        "archiveSha256": actual_digest,
        "manifestSha256": sha256(destination / "manifest.json"),
        "kernelSourceCommit": expected_kernel_sha,
        "occtSourceCommit": OCCT_SHA,
        "workerSha256": manifest["workerSha256"],
        "workerPath": str(destination / "bin/intuit3d_occt8_plate"),
        "runScriptPath": str(destination / "run.sh"),
        "nativeReplayCases": sorted(result["cases"]),
        "abiPreflight": abi_record,
        "independentCadInteroperability": False,
        "windowsNativeQualified": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--kernel-sha", required=True)
    args = parser.parse_args()
    try:
        result = install(args.archive, args.destination,
                         args.expected_sha256, args.kernel_sha)
    except (InstallError, ABIError, OSError, ValueError, KeyError, TypeError,
            subprocess.SubprocessError, tarfile.TarError) as exc:
        print("OFFLINE_OCCT8_INSTALL_FAIL:", exc, file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
