#!/usr/bin/env python3
"""Preserve fresh four-case OCCT replay STEP bytes after their physical audit.

This module only publishes receipts produced by an already executed and
validated C++ replay. It never treats fixtures or metadata as CAD execution.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

CASES = ("8", "12", "edited8", "restored8")


class EvidenceError(RuntimeError):
    pass


def require(ok: bool, message: str) -> None:
    if not ok:
        raise EvidenceError(message)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def publish_replay_steps(workdir: Path, destination: Path, requests: dict,
                         observations: dict, producer: dict) -> dict:
    """Publish physical STEP/request receipts atomically, or leave no output.

    "workdir" must contain files emitted by actual "execute_case" calls.
    This function checks byte hashes against prior validated physical receipts;
    it does not independently reconstruct or import STEP geometry.
    """
    require(set(requests) == set(CASES) and set(observations) == set(CASES),
            "four replay requests and measured cases are mandatory")
    require(isinstance(producer, dict) and
            all(isinstance(producer.get(k), str) and producer[k]
                for k in ("kernelSourceCommit", "workerSha256", "occtSourceCommit")),
            "missing pinned native producer identity")
    source_root = workdir.resolve(strict=True)
    destination = destination.absolute()
    require(not destination.is_relative_to(source_root),
            "evidence destination must outlive the temporary STEP directory")
    require(not os.path.lexists(destination), "replay evidence destination already exists")
    files = {}
    for case in CASES:
        step = source_root / f"fresh-{case}.step"
        info = observations[case]
        require(step.is_file() and not step.is_symlink(),
                f"missing actual fresh STEP replay: {case}")
        require(isinstance(info, dict) and
                info.get("stepBytes") == step.stat().st_size and
                info.get("stepSha256") == digest(step),
                f"replayed STEP differs from validated physical receipt: {case}")
        require(isinstance(requests[case], dict),
                f"missing original C++ request object for {case}")
        files[case] = {"stepSha256": info["stepSha256"],
                       "stepBytes": info["stepBytes"]}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".occt801-fresh-step-",
                                     dir=destination.parent) as temp:
        staging = Path(temp) / "physical-replay"
        staging.mkdir()
        sha_inventory = {}
        for case in CASES:
            step_name = f"fresh-{case}.step"
            request_name = f"request-{case}.json"
            shutil.copyfile(source_root / step_name, staging / step_name)
            (staging / request_name).write_text(
                json.dumps(requests[case], sort_keys=True, indent=2) + "\n",
                encoding="utf-8")
            sha_inventory[step_name] = digest(staging / step_name)
            sha_inventory[request_name] = digest(staging / request_name)
            require(sha_inventory[step_name] == files[case]["stepSha256"],
                    f"staged STEP changed after validation: {case}")
        receipt = {
            "schema": "intuit3d/offline-occt8-physical-replay-evidence-v1",
            "engine": "OCCT-cxx-8.0.1",
            "physicalWorkerExecuted": True,
            "independentCadInteroperability": False,
            "source": producer,
            "cases": files,
            "fileSha256": sha_inventory,
        }
        (staging / "evidence.json").write_text(
            json.dumps(receipt, indent=2, sort_keys=True) + "\n",
            encoding="utf-8")
        require(not os.path.lexists(destination),
                "replay evidence destination appeared during staging")
        staging.rename(destination)
    return {"directory": str(destination),
            "receiptSha256": digest(destination / "evidence.json"),
            "stepSha256": {case: files[case]["stepSha256"] for case in CASES}}
