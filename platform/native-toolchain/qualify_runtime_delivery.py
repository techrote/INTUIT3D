#!/usr/bin/env python3
"""Physically qualify an installed pinned OCCT8 worker through accepted RUNTIME.

This is a Linux native-product execution gate, not a source-only or synthetic
provider check. It uses the real RUNTIME/INTENT/SKETCH local bridge demo and
verifies physical STEP receipts after the offline installer has replayed four
C++/STEP cases. Input checkout commits and archive hash must be supplied by an
external trusted build receipt. No network access or npm install is performed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

SHA = re.compile(r"[0-9a-f]{40}\\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\\Z")
EXPECTED_STAGES = (
    "plate-8mm-two-bores",
    "retrospective-12mm-rebuild",
    "solved-hole-spacing-and-bore-resize",
    "undo-hole-layout-rebuild",
    "undo-thickness-rebuild",
    "archive-reopen-edited-hole-layout",
    "archive-reopen-original-plate",
)
DEMO = "packages/workflow-runtime/test/local-occt8-bridge.native-demo.mjs"


class DeliveryError(RuntimeError):
    pass


def require(ok: bool, message: str) -> None:
    if not ok:
        raise DeliveryError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def runtime_checkout_sha(root: Path, expected: str) -> str:
    require(bool(SHA.fullmatch(expected)), "runtime source must be a full immutable Git SHA")
    result = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"],
                            capture_output=True, text=True, timeout=15, check=False)
    require(result.returncode == 0 and result.stdout.strip() == expected,
            "RUNTIME checkout is not the required exact source commit")
    clean = subprocess.run(["git", "-C", str(root), "diff", "--quiet", "HEAD", "--"],
                           capture_output=True, text=True, timeout=15, check=False)
    require(clean.returncode == 0, "checkout has modified tracked source files")
    return expected


def valid_number(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def close(actual: float, expected: float, *, label: str) -> None:
    require(math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-6),
            f"{label} did not reconstruct original native material")


def validate_demo(output: object) -> dict:
    """Independently demand physical native replay semantics from RUNTIME JSON."""
    require(isinstance(output, dict) and
            output.get("kind") == "RUNTIME_REAL_PINNED_OCCT8_LOCAL_BRIDGE_PASS" and
            output.get("source") == "actual INTENT/SKETCH and native C++ worker" and
            output.get("exactAuthority") is False and
            output.get("independentInteroperability") is False and
            output.get("externalCadProbeExecuted") is False,
            "RUNTIME did not produce a genuine bounded pinned C++ local-bridge PASS")
    rows = output.get("results")
    require(isinstance(rows, list) and len(rows) == len(EXPECTED_STAGES),
            "native RUNTIME demo omitted a required edit/undo/archive stage")
    prepared = []
    for row, stage in zip(rows, EXPECTED_STAGES):
        require(isinstance(row, dict) and row.get("stage") == stage,
                "native RUNTIME stage order/content mismatch: " + stage)
        require(type(row.get("revision")) is int and row["revision"] >= 0,
                "invalid physical STEP source revision")
        require(valid_number(row.get("volumeMm3")) and row["volumeMm3"] > 0,
                "invalid measured native material volume: " + stage)
        require(type(row.get("bytes")) is int and 256 <= row["bytes"] <= 32 * 1024 * 1024,
                "missing/oversized native STEP: " + stage)
        require(isinstance(row.get("sha256"), str) and SHA256.fullmatch(row["sha256"]),
                "invalid native STEP SHA: " + stage)
        require("externalCadSample" not in row,
                "unexpected external CAD sample in non-independent native run")
        holes = row.get("holes")
        require(isinstance(holes, list) and len(holes) == 2,
                "expected the authored two-bore native plate: " + stage)
        for hole in holes:
            require(isinstance(hole, dict) and
                    set(hole) == {"x", "y", "radius"} and
                    all(valid_number(hole[k]) for k in hole) and hole["radius"] > 0,
                    "invalid native bore geometry: " + stage)
        prepared.append(row)
    initial, thick, resized, undo_holes, undo_thick, reopened_edit, reopened_initial = prepared
    require(thick["volumeMm3"] > initial["volumeMm3"] and
            thick["sha256"] != initial["sha256"],
            "thickness edit did not produce changed physical material/STEP")
    require(resized["volumeMm3"] > thick["volumeMm3"] and
            resized["sha256"] != thick["sha256"] and
            resized["holes"] != thick["holes"],
            "bore resizing did not change physical material/STEP")
    for restored, original, label in (
            (undo_holes, thick, "bore undo"),
            (undo_thick, initial, "thickness undo"),
            (reopened_edit, resized, "edited archive reopen"),
            (reopened_initial, initial, "initial archive reopen")):
        close(restored["volumeMm3"], original["volumeMm3"], label=label)
        require(restored["holes"] == original["holes"],
                label + " changed physical bore inventory")
    return {"status": "RUNTIME_PINNED_OCCT8_DELIVERY_PASS",
            "stages": list(EXPECTED_STAGES),
            "physicalNativeStepSha256": {x["stage"]: x["sha256"] for x in prepared},
            "volumesMm3": {x["stage"]: x["volumeMm3"] for x in prepared},
            "nativeStepCount": len(prepared),
            "independentCadInteroperability": False,
            "windowsNativeQualified": False}


def run_consumer(root: Path, source_sha: str, worker: Path,
                 worker_digest: str, *, node: str = "node",
                 timeout: int = 900) -> dict:
    require(sys.platform == "linux", "this native delivery gate requires Linux")
    runtime_checkout_sha(root, source_sha)
    require(root.joinpath(DEMO).is_file(), "RUNTIME real pinned-C++ demo is absent")
    require(worker.is_absolute() and worker.is_file() and os.access(worker, os.X_OK),
            "verified compiled C++ worker path must be absolute and executable")
    require(bool(SHA256.fullmatch(worker_digest)) and sha256(worker) == worker_digest,
            "source-matched native worker SHA-256 mismatch")
    version = subprocess.run([node, "--version"], capture_output=True,
                             text=True, timeout=15, check=False)
    match = re.fullmatch(r"v(\\d+)\\.(\\d+)\\.(\\d+)\\s*", version.stdout)
    require(version.returncode == 0 and match is not None and
            (int(match[1]), int(match[2])) >= (22, 6),
            "real native RUNTIME demo requires Node.js 22.6+")
    # Do not inherit a host/vendor OCCT library or an unrelated optional CAD
    # reader. If independent geometry is required, STEP owns that separate gate.
    environment = {k: v for k, v in os.environ.items()
                   if k not in ("LD_LIBRARY_PATH", "LD_PRELOAD", "LD_AUDIT",
                                "LD_DEBUG", "INTUIT3D_ANVIL_STEP_PROBE",
                                "INTUIT3D_ANVIL_PROBE_SHA256")}
    environment["INTUIT3D_OCCT8_WORKER"] = str(worker)
    environment["PYTHON"] = sys.executable
    done = subprocess.run([node, DEMO], cwd=root, env=environment,
                          capture_output=True, text=True, check=False, timeout=timeout)
    require(done.returncode == 0,
            f"real pinned RUNTIME demo failed (exit={done.returncode}): "
            + (done.stderr + done.stdout)[-2500:])
    try:
        reported = json.loads(done.stdout)
    except ValueError as exc:
        raise DeliveryError("real RUNTIME returned no valid JSON physical evidence: "
                            + done.stdout[-900:]) from exc
    receipt = validate_demo(reported)
    return {**receipt, "runtimeSourceCommit": source_sha,
            "workerSha256": worker_digest, "nodeVersion": version.stdout.strip()}


def qualify(args: argparse.Namespace) -> dict:
    from install_offline import install, InstallError  # genuine installer
    from abi_compat import ABIError
    platform_root = Path(__file__).resolve().parents[2]
    platform_sha = runtime_checkout_sha(platform_root, args.platform_sha)
    runtime_root = args.runtime_tree.resolve(strict=True)
    runtime_checkout_sha(runtime_root, args.runtime_sha)
    destination = args.destination.absolute()
    require(not os.path.lexists(destination),
            "destination already exists; no overwrite")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Entire consumer qualification is transactional: if the genuine RUNTIME
    # edit/undo/reopen demo fails, no apparently accepted worker is deployed.
    with tempfile.TemporaryDirectory(prefix=".intuit3d-native-delivery-",
                                     dir=destination.parent) as staging:
        installed = Path(staging) / "runtime"
        try:
            info = install(args.archive, installed, args.archive_sha256,
                           args.kernel_sha)
        except (InstallError, ABIError) as exc:
            raise DeliveryError("native archive installation failed: " + str(exc)) from exc
        require(info.get("status") == "OFFLINE_OCCT8_INSTALL_PASS",
                "native offline archive was not physically accepted")
        result = run_consumer(runtime_root, args.runtime_sha,
                              Path(info["workerPath"]), info["workerSha256"],
                              node=args.node)
        require(not os.path.lexists(destination),
                "destination appeared during native consumer qualification")
        installed.rename(destination)
    return {**result, "archiveSha256": info["archiveSha256"],
            "kernelSourceCommit": info["kernelSourceCommit"],
            "occtSourceCommit": info["occtSourceCommit"],
            "platformSourceCommit": platform_sha,
            "workerPath": str(destination / "bin/intuit3d_occt8_plate"),
            "nativeArchiveReplayCases": info["nativeReplayCases"],
            "abiPreflight": info.get("abiPreflight"),
            "archiveAndRuntimeSourceMatched": True}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--archive-sha256", required=True)
    parser.add_argument("--kernel-sha", required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--runtime-tree", type=Path, required=True)
    parser.add_argument("--runtime-sha", required=True)
    parser.add_argument("--platform-sha", required=True)
    parser.add_argument("--node", default="node")
    arguments = parser.parse_args()
    try:
        result = qualify(arguments)
    except (DeliveryError, OSError, ValueError, KeyError, TypeError,
            subprocess.SubprocessError) as exc:
        print("RUNTIME_PINNED_OCCT8_DELIVERY_FAIL:", exc, file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
