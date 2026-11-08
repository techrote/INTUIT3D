#!/usr/bin/env python3
"""Execute a source-bound, non-OCCT *3D* material witness and physical negative.

This is deliberately distinct from the hardcoded v5/v6 vertical-ray oracle:
the independently authored witness describes arbitrary world-space points and
3D ray directions. It never reads STEP text to derive expected geometry.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ANVIL_PIN = "50c053840933c92d598976e837e63ccd7626c312"
HEX40 = re.compile(r"[a-f0-9]{40}\Z")
HEX64 = re.compile(r"[a-f0-9]{64}\Z")
FLOAT = r"-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)"
MOMENT_FIELDS = ("centroid_x_mm", "centroid_y_mm", "centroid_z_mm",
                 "cov_xx_mm2", "cov_yy_mm2", "cov_zz_mm2",
                 "cov_xy_mm2", "cov_xz_mm2", "cov_yz_mm2")
MOMENTS = re.compile("WITNESS_MOMENTS " + " ".join(
    name + "=(" + FLOAT + ")" for name in MOMENT_FIELDS) + r"\Z")
SUCCESS = re.compile(
    r"WITNESS_ACCEPT solids=1 imported_exact=true warnings=0 "
    r"rays=(\d+) triangles=(\d+) volume_mm3=([0-9.]+) area_mm2=([0-9.]+)\Z")


RAY_RECEIPT = re.compile(
    r"WITNESS_RAY ([A-Za-z0-9._-]{1,56}) (material|void) intersections=(\d+)\Z")


class Rejected(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Rejected(message)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def bound_bytes(path: Path, cap: int) -> bytes:
    require(path.is_file() and 0 < path.stat().st_size <= cap,
            "required source-bound input missing, empty or oversized")
    return path.read_bytes()


def witness_version(raw: bytes) -> int:
    first = raw.decode("ascii").splitlines()
    require(bool(first) and first[0] in
            ("INTUIT3D_3D_WITNESS_V1", "INTUIT3D_3D_WITNESS_V2"),
            "unsupported 3D material witness format")
    return 2 if first[0].endswith("_V2") else 1


def witness_count(raw: bytes) -> int:
    """Reject malformed, oversized, ungrounded or weak test specification."""
    require(len(raw) <= 100_000, "oversized witness")
    lines = raw.decode("ascii").splitlines()
    version = witness_version(raw)
    counts = {"VOLUME": 0, "AREA": 0, "RAY": 0,
              "CENTROID": 0, "COVARIANCE": 0}
    ids = set()
    for line in lines[1:]:
        if not line:
            continue
        fields = line.split()
        require(len(line) <= 256 and fields[0] in counts,
                "unrecognized witness record")
        kind = fields[0]
        counts[kind] += 1
        if kind == "RAY":
            require(len(fields) == 9 and
                    re.fullmatch(r"[A-Za-z0-9._-]{1,56}", fields[1]) and
                    fields[1] not in ids and
                    fields[8] in ("material", "void"),
                    "invalid witness ray identity or occupancy")
            ids.add(fields[1])
            vectors = [float(x) for x in fields[2:8]]
            require(all(abs(x) < 1e8 for x in vectors) and
                    any(abs(x) > 1e-8 for x in vectors[3:]),
                    "invalid witness ray vector")
        elif kind in ("CENTROID", "COVARIANCE"):
            dimensions = 3 if kind == "CENTROID" else 6
            require(version == 2 and len(fields) == 1 + 2 * dimensions,
                    "mass moments require complete V2 witness")
            for i in range(dimensions):
                lower, upper = map(float, fields[1+2*i:3+2*i])
                permitted = (0.5 if kind == "CENTROID" else
                             0.03 * max(abs(lower), abs(upper), 1) + 0.5)
                require(float("-inf") < lower < upper < float("inf") and
                        upper-lower <= permitted,
                        "independent 3D mass-moment interval too broad")
        else:
            require(len(fields) == 3, "invalid witness interval")
            lower, upper = map(float, fields[1:])
            require(0 < lower < upper and (upper-lower)/lower <= .02,
                    "missing or overly broad physical mass/area bound")
    require(counts["VOLUME"] == counts["AREA"] == 1 and
            8 <= counts["RAY"] <= 256, "incomplete independent witness")
    if version == 1:
        require(counts["CENTROID"] == counts["COVARIANCE"] == 0,
                "V1 cannot claim 3D mass moments")
    else:
        require(counts["CENTROID"] == counts["COVARIANCE"] == 1,
                "V2 requires centroid and all six covariance moments")
    return counts["RAY"]


def authored_rays(raw: bytes) -> tuple[tuple[str, str], ...]:
    """Expected identities/occupancy in authored witness order, not ray count alone."""
    return tuple((parts[1], parts[8])
                 for line in raw.decode("ascii").splitlines()[1:]
                 if (parts := line.split()) and parts[0] == "RAY")


def verify_originals(args: argparse.Namespace) -> dict:
    for value, expression in (
        (args.kernel_sha, HEX40), (args.worker_sha256, HEX64),
        (args.probe_sha256, HEX64), (args.receipt_sha256, HEX64),
        (args.positive_sha256, HEX64), (args.negative_sha256, HEX64),
        (args.witness_sha256, HEX64),
    ):
        require(expression.fullmatch(value) is not None, "invalid immutable hash")
    require(args.anvil_source_sha == ANVIL_PIN,
            "independent non-OCCT engine source version mismatch")
    require(not args.output_dir.exists(), "evidence directory must be fresh")
    current = subprocess.check_output(
        ["git", "-C", str(args.kernel_tree), "rev-parse", "HEAD"],
        timeout=10, text=True).strip()
    require(current == args.kernel_sha, "producer Git source checkout not pinned")
    cpp_sha = sha(bound_bytes(args.kernel_tree / "native/occt8/plate_worker.cpp",
                             3_000_000))
    require(sha(bound_bytes(args.worker, 100_000_000)) == args.worker_sha256,
            "C++ worker binary does not match producer hash")
    require(sha(bound_bytes(args.probe, 100_000_000)) == args.probe_sha256,
            "independent AnvilCAD executable hash mismatch")
    witness_raw = bound_bytes(args.witness, 100_000)
    require(sha(witness_raw) == args.witness_sha256, "witness was modified")
    total_rays = witness_count(witness_raw)
    receipt_raw = bound_bytes(args.receipt, 2_000_000)
    require(sha(receipt_raw) == args.receipt_sha256,
            "native producer receipt was modified")
    receipt = json.loads(receipt_raw)
    require(receipt.get("status") == "PINNED_OCCT8_PROGRESSIVE_V6_PHYSICAL_EXECUTED",
            "not a real pinned C++ progressive native producer receipt")
    origin = receipt.get("provenance", {})
    require(origin.get("sourceSha") == current and
            origin.get("cppSourceSha256") == cpp_sha and
            origin.get("workerSha256") == args.worker_sha256 and
            origin.get("occtVersionRequired") == "8.0.1",
            "native producer worker/C++/source provenance differs")
    items = receipt.get("receipts")
    require(isinstance(items, list) and len(items) == 6,
            "six progressive native source outputs required")
    require(0 <= args.positive_index < 6 and
            0 <= args.negative_index < 6 and
            args.positive_index != args.negative_index,
            "distinct source-bound positive/negative stages required")
    native_stages = {}
    for role, i, path, expected in (
        ("positive", args.positive_index, args.positive, args.positive_sha256),
        ("negative", args.negative_index, args.negative, args.negative_sha256),
    ):
        item = items[i]
        original = bound_bytes(path, 50_000_000)
        require(item.get("stepSha256") == expected and
                item.get("stepBytes") == len(original) and
                sha(original) == expected and
                item.get("cutCount") == i // 2 and
                item.get("thickness") == (8 if i % 2 == 0 else 12) and
                item.get("bodyId") == "body.sloped.bracket",
                "STEP bytes not bound to their specific physical C++ stage")
        revision = item.get("revision")
        request_id = item.get("requestId")
        require(type(revision) is int and revision >= 0 and
                isinstance(request_id, str) and 0 < len(request_id) <= 128,
                "native source stage revision/request identity missing")
        native_stages[role] = {
            "revision": revision, "requestId": request_id,
            "bodyId": item["bodyId"], "cutCount": item["cutCount"],
            "thicknessMm": item["thickness"], "stepSha256": expected,
        }
    expected_revision = getattr(args, "expected_native_revision", None)
    if expected_revision is not None:
        require(native_stages["positive"]["revision"] == expected_revision,
                "positive STEP not from expected native source revision")
    require(args.positive_sha256 != args.negative_sha256,
            "negative must be a distinct genuine C++ STEP export")
    return {"cppSha256": cpp_sha, "rays": total_rays,
            "witnessVersion": witness_version(witness_raw),
            "nativeStages": native_stages}


def run_probe(probe: Path, step: Path, witness: Path, timeout: int,
              log: Path, count: int, positive: bool, version: int = 1) -> dict:
    cmd = [str(probe.resolve()), "--witness-3d",
           str(step.resolve()), str(witness.resolve())]
    completed = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=timeout, check=False)
    log.write_text("command=" + json.dumps(cmd) + "\nexit=" +
                   str(completed.returncode) + "\nstdout:\n" +
                   completed.stdout + "\nstderr:\n" + completed.stderr)
    if not positive:
        # An unreadable STEP, generic import error or crashing importer is
        # *never* a successful physical wrong-geometry demonstration.
        require(completed.returncode == 3 and not completed.stdout.strip().endswith(
                "WITNESS_ACCEPT") and
                completed.stderr.startswith("NOT_QUALIFIED: WITNESS_GEOMETRY: ") and
                len(completed.stderr.strip().splitlines()) == 1 and
                "WITNESS_ACCEPT " not in completed.stdout,
                "negative did not reject genuine imported geometric evidence")
        return {"rejection": completed.stderr.strip()}
    require(completed.returncode == 0 and not completed.stderr.strip(),
            "independent physical STEP import failed or warned")
    output = completed.stdout.strip().splitlines()
    expected_rays = authored_rays(bound_bytes(witness, 100_000))
    require(len(expected_rays) == count and
            len(output) == count + (2 if version == 2 else 1),
            "physical witness ray receipts incomplete/malformed")
    ray_receipts = []
    for line, (expected_id, expected_occupancy) in zip(output[:count], expected_rays):
        matched = RAY_RECEIPT.fullmatch(line)
        require(matched is not None and
                (matched.group(1), matched.group(2)) ==
                (expected_id, expected_occupancy),
                "physical ray receipt not bound to authored witness identity/order")
        crossings = int(matched.group(3))
        require(crossings % 2 == (1 if expected_occupancy == "material" else 0),
                "physical ray intersection parity contradicts authored occupancy")
        ray_receipts.append({"name": expected_id, "occupancy": expected_occupancy,
                             "intersections": crossings})
    moments = None
    if version == 2:
        matched = MOMENTS.fullmatch(output[count])
        require(matched is not None, "physical centroid/covariance receipt missing")
        moments = dict(zip(MOMENT_FIELDS, (float(v) for v in matched.groups())))
    accepted = SUCCESS.fullmatch(output[-1])
    require(accepted is not None and int(accepted.group(1)) == count and
            int(accepted.group(2)) >= 8,
            "independent exact-body physical acceptance missing")
    result = {"rayCount": count, "triangleCount": int(accepted.group(2)),
              "volumeMm3": float(accepted.group(3)),
              "surfaceMm2": float(accepted.group(4)),
              "importedTopology": {"solids": 1, "exactBrep": True,
                                   "warningCount": 0, "closedMesh": True},
              "rayReceipts": ray_receipts}
    if moments is not None:
        result["independentMassMoments"] = moments
    return result


def execute(args: argparse.Namespace) -> int:
    verified = verify_originals(args)
    args.output_dir.mkdir(parents=True)
    report = {
        "schema": "intuit3d.external-3d-material-witness/v1",
        "status": "REJECTED", "independentCadInteroperability": False,
        "kernelSourceSha": args.kernel_sha,
        "nativeCppSha256": verified["cppSha256"],
        "nativeWorkerSha256": args.worker_sha256,
        "independentProbeSha256": args.probe_sha256,
        "anvilSourceSha": args.anvil_source_sha,
        "witnessVersion": verified["witnessVersion"],
        "producerReceiptSha256": args.receipt_sha256,
        "nativeStageIdentities": verified["nativeStages"],
        "currentBrowserRevisionProven": False,
        "sourceToBinaryCompilationBinding": "separate exact-head hosted build-log review required",
        "physicalCases": [],
    }
    try:
        for name, original, expected, positive in (
            ("positive", args.positive, args.positive_sha256, True),
            ("negative", args.negative, args.negative_sha256, False),
        ):
            target = args.output_dir / (name + ".step")
            target.write_bytes(original.read_bytes())
            log = args.output_dir / (name + ".anvil.log")
            result = run_probe(args.probe, target, args.witness, args.timeout,
                               log, verified["rays"], positive,
                               verified["witnessVersion"])
            require(sha(target.read_bytes()) == expected,
                    "original STEP mutated during physical witness import")
            report["physicalCases"].append({
                "role": name, "sourceStepSha256": expected,
                "logSha256": sha(log.read_bytes()), **result,
            })
        report["status"] = "NON_OCCT_3D_MATERIAL_WITNESS_PHYSICAL_PASS"
        report["independentCadInteroperability"] = True
        return 0
    except (Rejected, OSError, ValueError) as exc:
        report["error"] = str(exc)
        return 3
    finally:
        (args.output_dir / "qualification.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("kernel-tree", "worker", "probe", "receipt", "positive",
                 "negative", "witness", "output-dir"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in ("kernel-sha", "worker-sha256", "probe-sha256",
                 "receipt-sha256", "positive-sha256", "negative-sha256",
                 "witness-sha256", "anvil-source-sha"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--positive-index", type=int, required=True)
    parser.add_argument("--negative-index", type=int, required=True)
    parser.add_argument("--expected-native-revision", type=int,
                        help="optional native stage revision fence, not browser authority")
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()
    try:
        require(1 <= args.timeout <= 120, "unbounded physical importer timeout")
        require(args.expected_native_revision is None or
                0 <= args.expected_native_revision < 2**53,
                "invalid expected native source revision")
        return execute(args)
    except (Rejected, OSError, ValueError, TypeError, KeyError,
            subprocess.SubprocessError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"NON_OCCT_3D_MATERIAL_WITNESS_REJECTED: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
