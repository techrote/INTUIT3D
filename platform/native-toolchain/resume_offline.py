#!/usr/bin/env python3
"""Re-attest an installed pinned OCCT8 Linux bundle before local RUNTIME reuse.

This is not an installer, downloader or CAD authority. The expected manifest,
KERNEL and worker digests must come from the independent initial install receipt,
not from the possibly mutable installation being inspected.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from abi_compat import ABIError, verify_abi
from execution_environment import sealed_env
from install_offline import BUNDLE_SCHEMA, OCCT_SHA, InstallError, require, sha256


def pin(value: str, length: int, label: str) -> None:
    require(re.fullmatch(r"[a-f0-9]{%d}" % length, value) is not None,
            f"{label} must be an immutable lowercase hex digest")


def attest_inventory(root: Path, manifest: dict) -> None:
    """Inspect the entire installation BEFORE executing its bundled verifier."""
    expected_files = manifest.get("files")
    expected_links = manifest.get("links")
    require(isinstance(expected_files, dict) and isinstance(expected_links, dict)
            and "verify.py" in expected_files and "selftest.py" in expected_files
            and "bin/intuit3d_occt8_plate" in expected_files,
            "installed bundle lacks complete file/SONAME inventory")
    actual_files: dict[str, str] = {}
    actual_links: dict[str, str] = {}
    for path in root.rglob("*"):
        name = path.relative_to(root).as_posix()
        if name == "manifest.json":
            continue
        if path.is_symlink():
            target = os.readlink(path)
            require(path.parent == root / "lib" and target not in ("", ".", "..")
                    and "/" not in target and "\\" not in target
                    and path.resolve(strict=True).is_relative_to(root / "lib"),
                    f"unsafe installed SONAME symlink: {name}")
            actual_links[name] = target
        elif path.is_file():
            require(path.resolve(strict=True).is_relative_to(root),
                    f"installed file escapes bundle: {name}")
            actual_files[name] = sha256(path)
        else:
            require(path.is_dir(), f"unsupported installed file type: {name}")
    require(actual_files == expected_files,
            "installed file inventory differs from pinned manifest")
    require(actual_links == expected_links,
            "installed SONAME inventory differs from pinned manifest")


def resume(directory: Path, expected_manifest: str, expected_kernel: str,
           expected_worker: str, replay: bool = False) -> dict:
    require(sys.platform == "linux", "native ELF restart requires Linux")
    pin(expected_manifest, 64, "manifest SHA-256")
    pin(expected_worker, 64, "worker SHA-256")
    pin(expected_kernel, 40, "KERNEL source SHA")
    require(directory.is_dir() and not directory.is_symlink(),
            "installed bundle directory is missing or a symlink")
    root = directory.absolute()
    document = root / "manifest.json"
    require(document.is_file() and not document.is_symlink()
            and sha256(document) == expected_manifest,
            "installed manifest differs from independently pinned SHA-256")
    manifest = json.loads(document.read_text(encoding="utf-8"))
    require(isinstance(manifest, dict) and manifest.get("schema") == BUNDLE_SCHEMA
            and manifest.get("occtVersion") == "8.0.1"
            and manifest.get("occtSourceCommit") == OCCT_SHA
            and manifest.get("kernelSourceCommit") == expected_kernel
            and manifest.get("workerSha256") == expected_worker
            and manifest.get("nativeCppExecuted") is True
            and manifest.get("independentCadInteroperability") is False,
            "installed manifest does not match immutable native source pins")
    attest_inventory(root, manifest)
    worker = root / "bin/intuit3d_occt8_plate"
    require(worker.is_file() and os.access(worker, os.X_OK),
            "installed native C++ worker not executable")
    # Only after the independent inventory check do we execute bundled code.
    verified = subprocess.run([sys.executable, "-I", str(root / "verify.py")],
                              cwd=root, capture_output=True, text=True,
                              timeout=60, check=False, env=sealed_env())
    require(verified.returncode == 0
            and "OCCT801_OFFLINE_BUNDLE_VERIFY_PASS" in verified.stdout,
            "installed archive verifier did not pass: " + verified.stderr[-500:])
    abi = verify_abi(worker, root / "lib", manifest.get("elfAbiProfile"))
    record = {"status": "OFFLINE_OCCT8_RESUME_PASS",
              "directory": str(root), "manifestSha256": expected_manifest,
              "kernelSourceCommit": expected_kernel,
              "occtSourceCommit": OCCT_SHA, "workerSha256": expected_worker,
              "workerPath": str(worker), "runScriptPath": str(root / "run.sh"),
              "abiPreflight": abi, "nativeReplayExecuted": False,
              "independentCadInteroperability": False,
              "windowsNativeQualified": False}
    if replay:
        # -I omits the script's package directory and would break the
        # verified bundled replay_evidence import. -E -s -B preserves it.
        proc = subprocess.run([sys.executable, "-E", "-s", "-B",
                               str(root / "selftest.py")],
                              cwd=root, capture_output=True, text=True,
                              timeout=450, check=False, env=sealed_env())
        require(proc.returncode == 0,
                "installed native four-case replay failed: " + proc.stderr[-700:])
        result = json.loads(proc.stdout)
        require(result.get("status") == "OFFLINE_CXX_REPLAY_PASS"
                and result.get("workerSha256") == expected_worker
                and result.get("kernelSourceCommit") == expected_kernel
                and result.get("dimensionEditExecuted") is True
                and result.get("dimensionsRestored") is True
                and set(result.get("cases", {})) == {"8", "12", "edited8", "restored8"},
                "installed replay did not prove exact source four-case native execution")
        # The self-test is not allowed to change this installed immutable tree.
        attest_inventory(root, manifest)
        record["nativeReplayExecuted"] = True
        record["nativeReplayCases"] = sorted(result["cases"])
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--kernel-sha", required=True)
    parser.add_argument("--worker-sha256", required=True)
    parser.add_argument("--replay", action="store_true",
                        help="add four real extracted C++/STEP export tests")
    parser.add_argument("--worker-path-only", action="store_true",
                        help="print verified path for INTUIT3D_OCCT8_WORKER")
    args = parser.parse_args()
    try:
        result = resume(args.directory, args.manifest_sha256,
                        args.kernel_sha, args.worker_sha256, args.replay)
    except (InstallError, ABIError, OSError, ValueError,
            KeyError, TypeError, subprocess.SubprocessError) as exc:
        print("OFFLINE_OCCT8_RESUME_FAIL:", exc, file=sys.stderr)
        return 2
    print(result["workerPath"] if args.worker_path_only
          else json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
