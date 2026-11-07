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
from protocol import validate_request, validate_result
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

def execute(request_input: object, *, worker: Path, step_output: Path | None = None,
            timeout: float = 30.0) -> dict:
    request = validate_request(request_input)
    if request["exportStep"] != (step_output is not None):
        raise ValueError("step_output required if and only if exportStep is true")
    if not 0 < timeout <= 3600:
        raise ValueError("timeout must be between 0 and 3600 seconds")
    with tempfile.TemporaryDirectory(prefix="intuit3d-occt8-") as temp:
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
                # The caller owns the destination. Atomic exclusive publication:
                # no overwrite of files created during the C++ worker's lifetime.
                os.link(stage, step_output)
                response["stepPath"] = str(step_output)
                response["stepSha256"] = hashlib.sha256(step_output.read_bytes()).hexdigest()
            elif stage.exists():
                raise ValueError("worker emitted STEP for no-export intent")
            return response
        except (OSError, ValueError, KeyError, TypeError, AssertionError) as exc:
            return {"protocol":request["protocol"], "requestId":request["requestId"],
                    "status":"requires_reconciliation", "message":str(exc)[:600]}

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--worker", type=Path, required=True)
    p.add_argument("--step-output", type=Path)
    p.add_argument("--timeout", type=float, default=30)
    args = p.parse_args()
    try:
        response = execute(json.load(sys.stdin), worker=args.worker,
                           step_output=args.step_output, timeout=args.timeout)
    except (ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"status":"invalid_request","message":str(exc)[:600]}))
        return 2
    print(json.dumps(response, allow_nan=False))
    return 0 if response["status"]=="validated_exact" else 2

if __name__ == "__main__":
    raise SystemExit(main())
