"""One-shot process-isolated exact plate provider supervisor (local only).

Example:
  python native/run_plate.py --step-output /tmp/plate.step < request.json
Prints one JSON response; no cloud service, no geometry fallback.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from protocol import SCHEMA, InvalidRequest, validate_request, validate_result
from step_preflight import verify_step_artifact

MAX_REQUEST_BYTES = 65536
MAX_RESPONSE_BYTES = 65536


def execute(request: object, *, timeout: float = 25.0, step_output: Path | None = None, worker: Path | None = None) -> dict:
    valid = validate_request(request)
    if step_output is not None and valid["exportStep"] is not True:
        raise InvalidRequest("--step-output requires exportStep: true")
    if valid["exportStep"] and step_output is None:
        raise InvalidRequest("exportStep: true requires a durable --step-output destination")
    worker = worker or Path(__file__).resolve().with_name('ocp_worker.py')
    with tempfile.TemporaryDirectory(prefix='intuit3d-kernel-') as temporary:
        folder = Path(temporary)
        request_path, response_path, step_path = (folder / n for n in ('request.json', 'response.json', 'result.step'))
        request_path.write_text(json.dumps(valid, allow_nan=False), encoding='utf-8')
        args = [sys.executable, str(worker), '--request', str(request_path), '--response', str(response_path), '--step', str(step_path)]
        try:
            completed = subprocess.run(args, cwd=folder, capture_output=True, timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            return {"protocol": SCHEMA, "requestId": valid["requestId"], "status": "timeout", "message": "geometry worker exceeded deadline; no exact result accepted"}
        if completed.returncode != 0:
            return {"protocol": SCHEMA, "requestId": valid["requestId"], "status": "worker_crash", "message": f"worker exit {completed.returncode}; no exact result accepted", "diagnostic": completed.stderr.decode('utf-8', errors='replace')[-600:]}
        try:
            if not response_path.is_file() or response_path.stat().st_size > MAX_RESPONSE_BYTES:
                raise ValueError("response file absent or too large")
            response = validate_result(valid, json.loads(response_path.read_text(encoding='utf-8')))
            if valid['exportStep']:
                if not step_path.is_file():
                    raise ValueError("STEP artifact missing")
                # Inspect the actual STEP bytes before atomic publication.
                # This is structural preflight, not independent geometry proof.
                verify_step_artifact(step_path, expected_holes=len(valid["plate"]["holes"]))
                if step_output is not None:
                    destination = step_output.expanduser().resolve()
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    # Stage on the same filesystem, then publish atomically with
                    # exclusive hard-link creation. Never expose a partial STEP or
                    # clobber a previous valid export.
                    staged = None
                    try:
                        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.intuit3d-step-', suffix='.tmp', delete=False) as target:
                            staged = Path(target.name)
                            with step_path.open('rb') as source:
                                shutil.copyfileobj(source, target)
                            target.flush()
                            os.fsync(target.fileno())
                        os.link(staged, destination)
                    finally:
                        if staged is not None:
                            staged.unlink(missing_ok=True)
                    response['stepPath'] = str(destination)
            return response
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as error:
            return {"protocol": SCHEMA, "requestId": valid["requestId"], "status": "requires_reconciliation", "message": f"untrusted or invalid worker result: {error}"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--step-output', type=Path, default=None)
    parser.add_argument('--timeout-seconds', type=float, default=25.0)
    args = parser.parse_args()
    try:
        if not (0.1 <= args.timeout_seconds <= 600):
            raise InvalidRequest("timeout must be between 0.1 and 600 seconds")
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise InvalidRequest("input request exceeds 64 KiB")
        request = json.loads(raw)
        result = execute(request, timeout=args.timeout_seconds, step_output=args.step_output)
    except (InvalidRequest, ValueError, TypeError, UnicodeDecodeError) as exc:
        result = {"protocol": SCHEMA, "status": "invalid_request", "message": str(exc)}
    print(json.dumps(result, allow_nan=False))
    return 0 if result['status'] == 'validated_exact' else 2


if __name__ == '__main__':
    sys.exit(main())
