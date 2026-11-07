"""Pinned OCCT 8.0.1 C++ one-shot plate bridge for trusted local CAD projects.

C++ worker always runs in its own failure-contained subprocess. Its STEP
roundtrip is same-engine verification, NOT external CAD interoperability.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from plate_envelope import require_plate_vertex_envelope_mm
from protocol import validate_request, validate_result, analytic_invariants, close
from process_supervision import run_isolated_worker

BACKEND = "OCCT-cxx-8.0.1"
VERSION = "8.0.1"
MAX_RESPONSE_BYTES = 128 * 1024
MAX_STEP_BYTES = 32 * 1024 * 1024

def canonical_request(request: dict) -> str:
    p = request["plate"]
    lines = [
        "INTUIT3D_OCCT8_PLATE_V1",
        f'{request["requestId"]} {request["featureId"]} {request["revision"]} {int(request["exportStep"])}',
        f'{p["width"]:.17g} {p["depth"]:.17g} {p["thickness"]:.17g} {len(p["holes"])}',
    ]
    lines.extend(f'{h["x"]:.17g} {h["y"]:.17g} {h["radius"]:.17g}' for h in p["holes"])
    return "\n".join(lines) + "\n"

def _cross_version_step_audit(request: dict, response: dict, stage: Path,
                              directory: Path, deadline: float) -> str:
    """Reopen real STEP bytes in a separately supervised pinned OCP 7.9.3.1 process.

    This is cross-version OCCT corroboration, NOT independent CAD engine
    interoperability. No worker report can replace the actual artifact's audit.
    """
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(["external-step-audit"], 0)
    report = directory / "external-step-audit.json"
    auditor = Path(__file__).resolve().parent / "occt8" / "audit_step.py"
    completed = run_isolated_worker(
        [sys.executable, str(auditor), "--step", str(stage), "--report", str(report)],
        cwd=directory, timeout=remaining,
    )
    if completed.returncode != 0:
        raise ValueError("external OCCT 7.9.3.1 STEP read-back failed")
    if not report.is_file() or not 1 <= report.stat().st_size <= MAX_RESPONSE_BYTES:
        raise ValueError("absent or oversized external STEP audit")
    audit = json.loads(report.read_text(encoding="utf-8"))
    if not isinstance(audit, dict) or set(audit) != {"sha256", "metrics", "vertexEnvelopeMm"}:
        raise ValueError("external STEP audit has wrong schema")
    digest = hashlib.sha256(stage.read_bytes()).hexdigest()
    if audit["sha256"] != digest:
        raise ValueError("external STEP audit does not match artifact bytes")
    require_plate_vertex_envelope_mm(request["plate"], audit["vertexEnvelopeMm"], "external STEP")
    # Use the *separate reader's* measured B-rep, not producer-claimed metrics.
    validate_result(request, {**response, "stepReadback": audit["metrics"]},
                    expected_backend=BACKEND, expected_version=VERSION)
    return digest


def _part21_step_audit(request: dict, stage: Path, directory: Path, deadline: float) -> dict:
    """Independent, strictly plate-subset readback; not a general CAD importer."""
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(["part21-plate-audit"], 0)
    intent = directory / "part21-intent.json"
    report = directory / "part21-report.json"
    intent.write_text(json.dumps(request, allow_nan=False), encoding="utf-8")
    auditor = Path(__file__).resolve().parent / "occt8" / "part21_oracle.py"
    result = run_isolated_worker(
        [sys.executable, str(auditor), "--step", str(stage),
         "--intent", str(intent), "--report", str(report)],
        cwd=directory, timeout=remaining,
    )
    if result.returncode != 0:
        raise ValueError("independent Part 21 plate geometry readback failed")
    if not report.is_file() or not 1 <= report.stat().st_size <= MAX_RESPONSE_BYTES:
        raise ValueError("missing or oversized Part 21 readback report")
    audit = json.loads(report.read_text(encoding="utf-8"))
    fields = {"sha256", "readback", "solidCount", "faceCount", "edgeCount",
              "vertexEnvelopeMm", "cylindricalHoles", "analyticPlateVolumeMm3"}
    if not isinstance(audit, dict) or set(audit) != fields or (
            audit["readback"] != "independent-part21-plate-subset-v1"):
        raise ValueError("unrecognized independent STEP readback report")
    digest = hashlib.sha256(stage.read_bytes()).hexdigest()
    if audit["sha256"] != digest:
        raise ValueError("STEP bytes changed during independent readback")
    volume, _ = analytic_invariants(request["plate"])
    if type(audit["analyticPlateVolumeMm3"]) not in (int, float) or (
            not close(float(audit["analyticPlateVolumeMm3"]), volume)):
        raise ValueError("independent STEP geometry differs from analytic plate volume")
    return {"kind": "part21-plate-structural-v1", "sha256": digest}


def execute(request_input: object, *, worker: Path, step_output: Path | None = None,
            timeout: float = 30.0, cross_version_audit: bool = False,
            part21_audit: bool = False) -> dict:
    request = validate_request(request_input)
    # Normalize relative output paths before changing the subprocess cwd.
    if step_output is not None:
        step_output = step_output.resolve()
    if request["exportStep"] != (step_output is not None):
        raise ValueError("step_output required if and only if exportStep is true")
    if not 0 < timeout <= 3600:
        raise ValueError("timeout must be between 0 and 3600 seconds")
    if cross_version_audit and not request["exportStep"]:
        raise ValueError("cross-version STEP readback requires exportStep")
    if part21_audit and not request["exportStep"]:
        raise ValueError("Part 21 readback requires exportStep")
    deadline = time.monotonic() + timeout
    with tempfile.TemporaryDirectory(prefix=".intuit3d-occt8-",
                                         dir=step_output.parent if step_output else None) as temp:
        directory = Path(temp)
        wire = directory / "request.txt"
        report = directory / "result.json"
        stage = directory / "plate.step"
        wire.write_text(canonical_request(request), encoding="ascii")
        args = [str(worker.resolve()), str(wire), str(report), str(stage)]
        try:
            result = run_isolated_worker(args, cwd=directory, timeout=timeout)
        except subprocess.TimeoutExpired:
            return {"protocol":request["protocol"], "requestId":request["requestId"],
                    "status":"timeout", "message":"C++ worker exceeded deadline"}
        except (OSError, subprocess.SubprocessError) as exc:
            return {"protocol":request["protocol"], "requestId":request["requestId"],
                    "status":"worker_crash", "message":f"worker spawn failed: {type(exc).__name__}"}
        if result.returncode:
            return {"protocol":request["protocol"], "requestId":request["requestId"],
                    "status":"worker_crash", "message":"OCCT C++ worker returned failure",
                    "diagnostic":result.stderr.decode("utf-8","replace")[-600:]}
        try:
            if not report.is_file() or report.stat().st_size > MAX_RESPONSE_BYTES:
                raise ValueError("absent or oversized worker report")
            response = json.loads(report.read_text(encoding="utf-8"))
            validate_result(request, response,
                            expected_backend=BACKEND, expected_version=VERSION)
            if request["exportStep"]:
                assert step_output is not None
                if not stage.is_file() or not 256 <= stage.stat().st_size <= MAX_STEP_BYTES:
                    raise ValueError("missing, empty or oversized STEP bytes")
                with stage.open("rb") as stream:
                    if b"ISO-10303-21" not in stream.read(256):
                        raise ValueError("not STEP Part 21")
                    stream.seek(max(0, stage.stat().st_size - 256))
                    if b"END-ISO-10303-21;" not in stream.read():
                        raise ValueError("truncated STEP Part 21")
                # The caller owns the destination. Atomic exclusive publication:
                # no overwrite of files created during the C++ worker's lifetime.
                digest = ( _cross_version_step_audit(request, response, stage, directory, deadline)
                           if cross_version_audit else hashlib.sha256(stage.read_bytes()).hexdigest() )
                part21_result = (_part21_step_audit(request, stage, directory, deadline)
                                 if part21_audit else None)
                os.link(stage, step_output)
                response["stepPath"] = str(step_output)
                response["stepSha256"] = digest
                if part21_result is not None:
                    response["part21Audit"] = part21_result
                response["stepVerification"] = (
                    "occt-7.9.3.1-separate-process" if cross_version_audit
                    else "occt-8.0.1-same-engine"
                )
            elif stage.exists():
                raise ValueError("worker emitted STEP for no-export intent")
            return response
        except subprocess.TimeoutExpired:
            return {"protocol": request["protocol"], "requestId": request["requestId"],
                    "status": "timeout", "message": "external STEP reader exceeded shared deadline"}
        except (OSError, ValueError, KeyError, TypeError, AssertionError) as exc:
            return {"protocol":request["protocol"], "requestId":request["requestId"],
                    "status":"requires_reconciliation", "message":str(exc)[:600]}

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--worker", type=Path, required=True)
    p.add_argument("--step-output", type=Path)
    p.add_argument("--timeout", type=float, default=30)
    p.add_argument("--cross-version-step-audit", action="store_true",
                   help="require separate OCP 7.9.3.1 reader; not independent CAD interoperability")
    p.add_argument("--part21-step-audit", action="store_true",
                   help="require independent plate-subset STEP geometry readback, not general interoperability")
    args = p.parse_args()
    try:
        response = execute(json.load(sys.stdin), worker=args.worker,
                           step_output=args.step_output, timeout=args.timeout,
                           cross_version_audit=args.cross_version_step_audit,
                           part21_audit=args.part21_step_audit)
    except (ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"status":"invalid_request","message":str(exc)[:600]}))
        return 2
    print(json.dumps(response, allow_nan=False))
    return 0 if response["status"]=="validated_exact" else 2

if __name__ == "__main__":
    raise SystemExit(main())
