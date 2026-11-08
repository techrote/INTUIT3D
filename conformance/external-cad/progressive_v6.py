#!/usr/bin/env python3
"""Independent physical CAD custody/geometry gate for 12 progressive KERNEL v6 STEP files.

Only imported pinned AnvilCAD geometry can PASS. Original STEP files, actual
pinned-C++ producer manifests, exact KERNEL checkout, source and binary hashes
are prerequisites, not substitutes for cross-engine reconstruction.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

from sloped_v5 import ANVIL_PIN, MAX_STEP_BYTES, Rejected, digest, parse_receipt, require

STAGES = tuple((count, thickness) for count in (0, 1, 2) for thickness in (8, 12))
CUTS = {
    "direct": ("cut.sloped.blind", "cut.sloped.through"),
    "authored": ("cut.sloped.through", "cut.sloped.blind"),
}
RECEIPTS = {
    "direct": ("progressive-v6-receipts.json",
               "PINNED_OCCT8_PROGRESSIVE_V6_PHYSICAL_EXECUTED"),
    "authored": ("authored-progressive-v6-receipts.json",
                 "PINNED_AUTHORED_V6_PHYSICAL_EXECUTED"),
}

# Each physical adversary must fail an EXPECTED geometric predicate, not just
# return code 3 for an unrelated reader/IO/dependency failure. These diagnostics
# are emitted by the pinned independent Rust importer after successful import.
# The circle-vs-square case must reach its distinguishing diagonal ray.
NEGATIVE_GEOMETRY_REASONS = {
    "blind-pocket-omitted": (
        "sloped imported material centroid axis ",
        "sloped imported material covariance ",
        "pocket.centre: incorrect imported material/floor",
    ),
    "square-pocket-fabricated": (
        "sloped imported material centroid axis ",
        "sloped imported material covariance ",
        "pocket.centre: incorrect imported material/floor",
    ),
    "circle-vs-square": (
        "pocket.diagonal.",
    ),
    "wrong-thickness": (
        "sloped profile wrong mesh/mass/area:",
    ),
}


def verify_producer(kind: str, directory: Path, kernel_sha: str,
                    worker_sha: str, cpp_sha: str) -> dict:
    name, status = RECEIPTS[kind]
    raw = (directory / name).read_bytes()
    require(len(raw) <= 2_000_000, "oversized native progressive receipt")
    record = json.loads(raw)
    require(isinstance(record, dict) and record.get("status") == status,
            "progressive v6 native physical execution missing")
    provenance = record.get("provenance")
    require(isinstance(provenance, dict) and
            provenance.get("sourceSha") == kernel_sha and
            provenance.get("cppSourceSha256") == cpp_sha and
            provenance.get("workerSha256") == worker_sha,
            "native progressive source/binary provenance mismatch")
    if kind == "direct":
        require(provenance.get("occtVersionRequired") == "8.0.1" and
                provenance.get("sourceToBinaryCompilationBinding") ==
                "exact-head-build-log-required",
                "direct source-bound pinned C++ evidence incomplete")
    else:
        require(provenance.get("requiredOcct") == "8.0.1" and
                provenance.get("compiledFromThisSource") ==
                "requires-source-matched-build-log",
                "authored source-bound pinned C++ evidence incomplete")
    items = record.get("receipts")
    require(isinstance(items, list) and len(items) == 6,
            "six direct/authored edited STEP outputs required")
    cases = {}
    for i, (cuts, t) in enumerate(STAGES):
        item = items[i]
        require(isinstance(item, dict) and
                type(item.get("cutCount")) is int and item["cutCount"] == cuts and
                type(item.get("thickness")) is int and item["thickness"] == t,
                "wrong progressive stage ordering/thickness")
        body_id = "body.sloped.bracket" if kind == "direct" else "body.sloped"
        require(item.get("bodyId") == body_id and
                item.get("cutFeatureIds") == list(CUTS[kind][:cuts]) and
                isinstance(item.get("profileId"), str) and
                len(item["profileId"]) >= 5,
                "wrong selected body/profile or ordered native cutter history")
        require(item.get("exactAuthority") is False and
                item.get("independentInteroperability") is False,
                "source-only producer overclaims admitted physical authority")
        if kind == "direct":
            require(item.get("requestId") == f"native.progressive.v6.{cuts}.{t}" and
                    item.get("revision") == 20 + 2 * cuts + (t == 12),
                    "direct revision/request identity incorrect")
        else:
            require(item.get("requestId") ==
                    f"authored.progressive.native.{cuts}.{t}" and
                    type(item.get("revision")) is int and
                    isinstance(item.get("projectId"), str) and item["projectId"],
                    "authored model revision/project provenance missing")
        for phase in ("source", "stepReadback"):
            observed = item.get(phase)
            require(isinstance(observed, dict) and observed.get("valid") is True and
                    observed.get("solidCount") == 1,
                    "native producer lacks valid source/STEP single-solid receipts")
        filename = (f"progressive-{cuts}-{t}.step" if kind == "direct"
                    else f"authored-{cuts}-{t}.step")
        original = (directory / filename).read_bytes()
        step_sha = item.get("stepSha256")
        require(isinstance(step_sha, str) and
                re.fullmatch("[0-9a-f]{64}", step_sha) is not None and
                256 <= len(original) <= MAX_STEP_BYTES and
                item.get("stepBytes") == len(original) and
                digest(original) == step_sha,
                "original physical STEP bytes/hash do not match native producer")
        cases[(cuts, t)] = (filename, original, step_sha)
    require(len({v[2] for v in cases.values()}) == 6,
            "progressive source produced identical or missing stage STEP exports")
    for cuts in (0, 1, 2):
        a, b = items[2 * cuts:2 * cuts + 2]
        require(all(a.get(k) == b.get(k) for k in (
            "bodyId", "profileId", "cutFeatureIds")),
            "retrospective edit changed target body/selected profile/cutter IDs")
    return {"receiptSha256": digest(raw), "cases": cases}


def run_probe(probe: Path, step: Path, kind: str, cuts: int, t: int,
              timeout: int, log: Path, expect_pass: bool,
              expected_reasons: tuple[str, ...] = ()) -> dict | None:
    cmd = [str(probe.resolve()), "--progressive-v6", str(step.resolve()),
           kind, str(cuts), str(t)]
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True,
                                   timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise Rejected(f"independent AnvilCAD {kind}/{cuts}/{t} timed out") from exc
    log.write_text("command=" + json.dumps(cmd) + "\nexit=" +
                   str(completed.returncode) + "\nstdout:\n" +
                   completed.stdout + "\nstderr:\n" + completed.stderr)
    if not expect_pass:
        # A missing STEP, broken AnvilCAD importer, uncaught failure, or
        # always-rejecting fake probe must never count as a geometric negative.
        stderr = completed.stderr.strip().splitlines()
        reason = (stderr[0].removeprefix("NOT_QUALIFIED: ")
                  if len(stderr) == 1 and
                  stderr[0].startswith("NOT_QUALIFIED: ") else "")
        require(bool(expected_reasons) and completed.returncode == 3 and
                any(reason.startswith(prefix) for prefix in expected_reasons) and
                not any(line.startswith("SLOPE_ACCEPT ")
                        for line in completed.stdout.splitlines()),
                f"wrong-geometry physical {kind}/{cuts}/{t} rejected for "
                "an unrelated/non-geometric reason")
        return None
    require(completed.returncode == 0 and not completed.stderr.strip(),
            f"independent {kind}/{cuts}/{t} importer failed or emitted warnings")
    return parse_receipt(completed.stdout, kind, t, cut_count=cuts)


def execute(args: argparse.Namespace) -> int:
    require(not args.output_dir.exists(), "evidence directory must be fresh")
    require(re.fullmatch("[0-9a-f]{40}", args.kernel_sha) is not None and
            re.fullmatch("[0-9a-f]{64}", args.probe_sha256) is not None and
            args.anvil_source_sha == ANVIL_PIN,
            "invalid immutable producer/AnvilCAD source or binary pin")
    source_sha = subprocess.check_output(
        ["git", "-C", str(args.kernel_tree), "rev-parse", "HEAD"],
        text=True, timeout=10).strip()
    require(source_sha == args.kernel_sha, "KERNEL checkout differs from requested pin")
    cpp_sha = digest((args.kernel_tree / "native/occt8/plate_worker.cpp").read_bytes())
    worker_sha = digest(args.worker.read_bytes())
    probe_sha = digest(args.probe.read_bytes())
    require(args.probe.is_file() and args.worker.is_file() and
            probe_sha == args.probe_sha256,
            "independent executable or pinned native C++ worker hash mismatch")
    producers = {
        k: verify_producer(k, d, source_sha, worker_sha, cpp_sha)
        for k, d in (("direct", args.direct_dir), ("authored", args.authored_dir))
    }
    args.output_dir.mkdir(parents=True)
    report = {
        "schema": "intuit3d.external-progressive-v6/v1",
        "status": "REJECTED",
        "independentCadInteroperability": False,
        "kernelSourceSha": source_sha,
        "nativeCppSourceSha256": cpp_sha,
        "nativeWorkerSha256": worker_sha,
        "anvilSourceSha": ANVIL_PIN,
        "independentProbeSha256": probe_sha,
        "producerReceiptSha256": {k: p["receiptSha256"] for k, p in producers.items()},
        "sourceBinaryBinding": "separate exact-head compiler-log review required",
        "cases": [], "physicalNegatives": [],
    }
    try:
        for kind, producer in producers.items():
            for cuts, t in STAGES:
                original_name, original, sha = producer["cases"][(cuts, t)]
                copied = args.output_dir / f"{kind}-{original_name}"
                copied.write_bytes(original)
                log = args.output_dir / f"{kind}-{cuts}-{t}.anvil.log"
                result = run_probe(args.probe, copied, kind, cuts, t,
                                   args.timeout, log, True)
                require(digest(copied.read_bytes()) == sha,
                        "source-bound STEP changed during independently executed import")
                report["cases"].append({
                    "kind": kind, "cutCount": cuts, "thicknessMm": t,
                    "nativeStepSha256": sha, "filename": copied.name,
                    "independentLogSha256": digest(log.read_bytes()), **result,
                })
        # Actual negative re-imports of original physical STEP, with intentionally
        # wrong stage/shape/thickness expectations. A crash is NOT a rejection.
        adversaries = [
            ("direct", 1, 8, "direct", 0, 8, "blind-pocket-omitted"),
            ("authored", 1, 8, "authored", 2, 8, "square-pocket-fabricated"),
            ("direct", 2, 8, "authored", 2, 8, "circle-vs-square"),
            ("direct", 2, 8, "direct", 2, 12, "wrong-thickness"),
        ]
        for actual_kind, actual_cuts, actual_t, claimed_kind, claimed_cuts, claimed_t, name in adversaries:
            filename = producers[actual_kind]["cases"][(actual_cuts, actual_t)][0]
            copied = args.output_dir / f"{actual_kind}-{filename}"
            log = args.output_dir / f"negative-{name}.anvil.log"
            require(digest(copied.read_bytes()) ==
                    producers[actual_kind]["cases"][(actual_cuts, actual_t)][2],
                    "negative replay STEP bytes changed after positive import")
            run_probe(args.probe, copied, claimed_kind, claimed_cuts,
                      claimed_t, args.timeout, log, False,
                      NEGATIVE_GEOMETRY_REASONS[name])
            report["physicalNegatives"].append({
                "name": name, "originalStep": copied.name,
                "independentLogSha256": digest(log.read_bytes()),
                "rejected": True,
            })
        require(len(report["cases"]) == 12 and
                sum(case["rayCount"] for case in report["cases"]) == 744 and
                len(report["physicalNegatives"]) == 4,
                "physical 12-STEP/456-ray/four-negative acceptance incomplete")
        report["status"] = "NON_OCCT_PROGRESSIVE_V6_PHYSICAL_GATE_PASS"
        report["independentCadInteroperability"] = True
        return 0
    except (Rejected, OSError, ValueError) as exc:
        report["error"] = str(exc)
        return 3
    finally:
        (args.output_dir / "qualification.json").write_text(
            json.dumps(report, sort_keys=True, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("direct-dir", "authored-dir", "kernel-tree",
                 "worker", "probe", "output-dir"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in ("kernel-sha", "probe-sha256", "anvil-source-sha"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    try:
        require(1 <= args.timeout <= 180, "unbounded independent engine timeout")
        return execute(args)
    except (Rejected, OSError, ValueError, TypeError, KeyError,
            subprocess.SubprocessError, json.JSONDecodeError) as exc:
        print(f"NON_OCCT_PROGRESSIVE_V6_REJECTED: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
