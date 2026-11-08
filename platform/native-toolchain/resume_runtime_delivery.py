#!/usr/bin/env python3
"""Re-attest an existing OCCT8 installation and exercise real pinned RUNTIME.

Unlike the initial archive delivery gate, this requires no tarball, compiler,
network, or installation change. It is a Linux, source-matched seven-stage
RUNTIME acceptance check, not a launcher for the browser UI or independent
STEP interoperability. Immutable source and digest pins must be supplied
from records OUTSIDE the installed tree.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

from abi_compat import ABIError
from install_offline import InstallError
from qualify_runtime_delivery import (DeliveryError, run_consumer,
                                      runtime_checkout_sha)
from resume_offline import resume


class RestartDeliveryError(RuntimeError):
    """A restarted native RUNTIME consumer was not physically qualified."""


def qualify_restart(directory: Path, manifest_sha: str, kernel_sha: str,
                    worker_sha: str, runtime_tree: Path, runtime_sha: str,
                    *, node: str = "node", replay: bool = False) -> dict:
    if sys.platform != "linux":
        raise RestartDeliveryError("restarted OCCT8 ELF delivery requires Linux")
    # Check the consumer's immutable source before any native code executes.
    checkout = runtime_tree.resolve(strict=True)
    runtime_checkout_sha(checkout, runtime_sha)
    installed = resume(directory, manifest_sha, kernel_sha, worker_sha,
                       replay=replay)
    if installed.get("status") != "OFFLINE_OCCT8_RESUME_PASS":
        raise RestartDeliveryError("installed worker did not pass pinned preflight")
    # This executes the existing real INTENT/SKETCH/RUNTIME seven-stage demo,
    # including the authored-sketch material oracle and physical STEP receipts.
    # It does not invent a second native-provider implementation.
    result = run_consumer(checkout, runtime_sha, Path(installed["workerPath"]),
                          worker_sha, node=node)
    if result.get("status") != "RUNTIME_PINNED_OCCT8_DELIVERY_PASS" or \
            result.get("nativeStepCount") != 7:
        raise RestartDeliveryError("seven physical RUNTIME stages did not pass")
    # Executed native code must not mutate the independently pinned
    # installation. The second full manifest/SONAME/ABI attestation fails
    # closed if any file was changed, added, removed, or redirected.
    after = resume(directory, manifest_sha, kernel_sha, worker_sha)
    if after.get("workerPath") != installed["workerPath"] or \
            after.get("manifestSha256") != manifest_sha:
        raise RestartDeliveryError("verified installation changed during RUNTIME")
    return {**result,
            "status": "RUNTIME_PINNED_OCCT8_RESTART_PASS",
            "installationReattestedAfterExecution": True,
            "manifestSha256": manifest_sha,
            "kernelSourceCommit": kernel_sha,
            "occtSourceCommit": installed["occtSourceCommit"],
            "workerSha256": worker_sha,
            "workerPath": installed["workerPath"],
            "abiPreflight": after["abiPreflight"],
            "preflightNativeReplayExecuted": bool(replay),
            "independentCadInteroperability": False,
            "windowsNativeQualified": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--kernel-sha", required=True)
    parser.add_argument("--worker-sha256", required=True)
    parser.add_argument("--runtime-tree", type=Path, required=True)
    parser.add_argument("--runtime-sha", required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--replay", action="store_true",
                        help="also execute four C++/STEP install replays before RUNTIME")
    args = parser.parse_args()
    try:
        record = qualify_restart(args.directory, args.manifest_sha256,
                                 args.kernel_sha, args.worker_sha256,
                                 args.runtime_tree, args.runtime_sha,
                                 node=args.node, replay=args.replay)
    except (RestartDeliveryError, InstallError, ABIError, DeliveryError,
            OSError, ValueError, KeyError, TypeError,
            subprocess.SubprocessError) as exc:
        print("RUNTIME_PINNED_OCCT8_RESTART_FAIL:", exc, file=sys.stderr)
        return 2
    print(json.dumps(record, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
