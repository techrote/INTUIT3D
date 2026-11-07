#!/usr/bin/env python3
"""Independent non-OCCT import of four source-matched pinned C++ cut-chain STEP.

Checks the genuine native Actions ZIP, newly compiled AnvilCAD probe SHA, exact
B-rep, closed imported mesh, material/void rays, pocket floors and edits.
Original producer's same-engine receipts are *provenance*, not CAD acceptance.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import zipfile

OCCT_SHA = "b8f597c677811d1f9f4d8a97f5ae2825c0353a42"
ARTIFACT_ID = 13590844544
ARTIFACT_SHA = "8fc4672185012fac4adae2dd0546435b78e94d31b8fee36014be724e536cbd65"
KERNEL_SHA = "ad60d1d5a05031c8ce63ee280fd1f34d9c51ecd9"
GIT_SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
# These are distinct source-produced STEP bytes; dimensional/Boolean oracles
# below are independently specified from fixture dimensions, not OCCT readback.
CASES = (
    ("ordered", 8, "plate-cuts-8.step"),
    ("ordered", 12, "plate-cuts-12.step"),
    ("mixed", 8, "mixed-8.step"),
    ("mixed", 12, "mixed-12.step"),
)


class Rejected(ValueError):
    pass


def require(ok: bool, why: str) -> None:
    if not ok:
        raise Rejected(why)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def expected_volume(kind: str, thick: int) -> float:
    require(kind in {"ordered", "mixed"} and thick in (8, 12),
            "unsupported authored cut-chain fixture")
    pocket = 3 if thick == 8 else 5
    pocket_area = 120 if kind == "ordered" else math.pi * 25
    return (120 * 80 - 2 * math.pi * 36) * thick - 80 * thick - pocket_area * pocket


def rays(kind: str, thick: int) -> list[tuple[str, float, float, float | None]]:
    """Vertical physical occupancy in model mm, independently authored."""
    require(kind in {"ordered", "mixed"} and thick in (8, 12),
            "unsupported physical ray fixture")
    result = [("stock.centre", 0., 0., float(thick)),
              ("stock.nw", -45., -30., float(thick)),
              ("stock.ne", 45., 30., float(thick))]
    for i, x in enumerate((-30., 30.)):
        result.append((f"bore.{i}.centre", x, 0., None))
        for side, dx, dy in (("east", 1., 0.), ("west", -1., 0.),
                             ("north", 0., -1.), ("south", 0., 1.)):
            result.append((f"bore.{i}.inner.{side}", x + 5.4 * dx, 5.4 * dy, None))
            result.append((f"bore.{i}.outer.{side}", x + 6.6 * dx, 6.6 * dy,
                           float(thick)))
    result.append(("window.centre", 5., -20., None))
    for side, dx, dy, half in (("east", 1., 0., 5.), ("west", -1., 0., 5.),
                               ("north", 0., 1., 4.), ("south", 0., -1., 4.)):
        result.append((f"window.inner.{side}", 5 + (half - .5) * dx,
                       -20 + (half - .5) * dy, None))
        result.append((f"window.outer.{side}", 5 + (half + .5) * dx,
                       -20 + (half + .5) * dy, float(thick)))
    floor = float(thick - (3 if thick == 8 else 5))
    result.append(("pocket.centre", -10., 20., floor))
    for side, dx, dy, half in (
        ("east", 1., 0., 6. if kind == "ordered" else 5.),
        ("west", -1., 0., 6. if kind == "ordered" else 5.),
        ("north", 0., 1., 5.), ("south", 0., -1., 5.),
    ):
        result.append((f"pocket.inner.{side}", -10 + (half - .5) * dx,
                       20 + (half - .5) * dy, floor))
        result.append((f"pocket.outer.{side}", -10 + (half + .5) * dx,
                       20 + (half + .5) * dy, float(thick)))
    require(len(result) == 39, "internal physical sampling mismatch")
    return result


def parse_receipt(stdout: str, kind: str, thickness: int) -> dict:
    expected = rays(kind, thickness)
    lines = stdout.splitlines()
    require(len(lines) == len(expected) + 1,
            "missing/extra independent material/void observations")
    observations = []
    for line, (name, x, y, last) in zip(lines[:-1], expected):
        fields = line.split()
        require(len(fields) == 7 and fields[:2] == ["CUT_RAY", name],
                "independent ray missing/renamed/reordered: " + name)
        try:
            rx, ry = float(fields[2]), float(fields[3])
            hit = int(fields[4])
            low, high = float(fields[5]), float(fields[6])
        except ValueError as exc:
            raise Rejected("invalid physical ray numeric receipt: " + name) from exc
        require(all(math.isfinite(v) for v in (rx, ry, low, high))
                and abs(rx - x) <= 1e-7 and abs(ry - y) <= 1e-7,
                "independent ray at wrong model coordinates: " + name)
        if last is None:
            require(hit == 0 and low == -1 and high == -1,
                    "unexpected solid at through-window/bore/void: " + name)
        else:
            require(hit == 2 and abs(low) <= .05 and abs(high - last) <= .05,
                    "wrong material/floor/thickness at: " + name)
        observations.append(dict(name=name, xMm=rx, yMm=ry, hits=hit,
                                 entryZMm=low if hit else None,
                                 exitZMm=high if hit else None))
    tokens = lines[-1].split()
    require(tokens and tokens[0] == "CUT_ACCEPT",
            "missing independent imported exact CAD acceptance receipt")
    pairs = [token.split("=", 1) for token in tokens[1:]]
    require(all(len(p) == 2 for p in pairs), "malformed imported CAD receipt")
    receipt = dict(pairs)
    require(len(receipt) == len(pairs) and set(receipt) == {
        "kind", "solids", "source_unit", "imported_exact", "tris", "open_edges",
        "volume_mm3", "expected_mm3", "warnings"
    }, "duplicate/missing/unknown imported CAD receipt field")
    require(receipt["kind"] == kind and receipt["solids"] == "1"
            and receipt["source_unit"] in ("millimetre", "millimeter")
            and receipt["imported_exact"] == "true"
            and receipt["open_edges"] == "0" and receipt["warnings"] == "0",
            "import lacks one exact closed, warning-free imported CAD solid")
    try:
        triangles = int(receipt["tris"])
        measured, claimed = float(receipt["volume_mm3"]), float(receipt["expected_mm3"])
    except ValueError as exc:
        raise Rejected("invalid physical volume/triangle receipt") from exc
    oracle = expected_volume(kind, thickness)
    require(triangles >= 8 and all(map(math.isfinite, (measured, claimed)))
            and abs(claimed - oracle) <= 1e-5
            and abs(measured - oracle) <= oracle * .01,
            "independently measured cut-chain volume mismatch")
    return dict(importedExactBRep=True, sourceUnit=receipt["source_unit"],
                triangles=triangles, measuredVolumeMm3=measured,
                analyticVolumeMm3=oracle, rayCount=len(observations), rays=observations)


def verify_native_source(archive: zipfile.ZipFile, kernel_sha: str) -> dict:
    """Verify original OCCT C++ evidence provenance; do not use it as the oracle."""
    names = archive.namelist()
    require(len(names) == len(set(names)), "duplicate native artifact member")
    versions = dict(line.split("=", 1) for line in
                    archive.read("versions.txt").decode().splitlines() if "=" in line)
    require(versions.get("kernel") == kernel_sha
            and GIT_SHA.fullmatch(versions.get("platform", "")) is not None,
            "native C++ source checkout identity mismatch")
    producer = dict(line.split("=", 1) for line in
                    archive.read("cut-chain-fixtures/source-and-worker.txt").decode().splitlines()
                    if "=" in line)
    require(producer.get("kernel") == kernel_sha,
            "cut-chain producer not compiled from requested KERNEL SHA")
    source = json.loads(archive.read("source-fetch/acquisition.json"))
    qualification = json.loads(archive.read("qualification/qualification.json"))
    require(source.get("sourceCommit") == OCCT_SHA
            and qualification.get("status") == "NATIVE_EXPERIMENTAL_PASS"
            and qualification.get("nativeCppExecuted") is True,
            "pinned OCCT8 C++ execution not attested")
    worker = archive.read("qualification/worker-build/intuit3d_occt8_plate")
    worker_digest = sha(worker)
    require(worker_digest == qualification["worker"]["sha256"]
            == producer.get("worker_sha256"), "genuine compiled C++ worker hash mismatch")
    receipts = {}
    for line in archive.read("cut-chain-fixtures/native-cut-step.sha256").decode().splitlines():
        entries = line.split(maxsplit=1)
        require(len(entries) == 2 and DIGEST.fullmatch(entries[0]) is not None,
                "invalid native STEP digest line")
        name = entries[1].split("cut-chain-fixtures/", 1)
        require(len(name) == 2 and name[1] not in receipts,
                "unexpected native cut-chain digest path")
        receipts[name[1]] = entries[0]
    require(len(receipts) == 4, "native artifact lacks exactly four original cut-chain STEP")
    steps = {}
    for kind, thick, filename in CASES:
        rel = f"{kind}/{filename}"
        folder = "ordered" if kind == "ordered" else "mixed"
        # The native producer stores source path 'ordered' or 'mixed'.
        source_path = f"cut-chain-fixtures/{folder}/{filename}"
        actual = archive.read(source_path)
        manifest = json.loads(archive.read(f"cut-chain-fixtures/{folder}/manifest.json"))
        record = next((r for r in manifest if r.get("revision") == thick), None)
        require(record is not None and record.get("independentInteroperability") is False,
                "producer native source case missing/incorrect authority")
        expected = record.get("expected")
        require(isinstance(expected, dict)
                and isinstance(expected.get("volumeMm3"), (int, float))
                and abs(expected["volumeMm3"] - expected_volume(kind, thick)) <= 1e-5,
                "producer expected volume disagrees with independent fixture definition")
        artifact = record.get("artifact")
        require(isinstance(artifact, dict)
                and artifact.get("sha256") == sha(actual)
                and artifact.get("bytes") == len(actual)
                and receipts.get(rel) == sha(actual),
                "original native STEP source bytes do not match SHA manifest")
        steps[rel] = actual
    require(len(set(map(sha, steps.values()))) == 4,
            "native edited STEP outputs were not all physically distinct")
    return dict(steps=steps, kernelSha=kernel_sha, platformSha=versions["platform"],
                workerSha256=worker_digest)


def qualify(args: argparse.Namespace) -> int:
    require(DIGEST.fullmatch(args.artifact_sha256) is not None
            and DIGEST.fullmatch(args.probe_sha256) is not None
            and GIT_SHA.fullmatch(args.kernel_sha) is not None
            and GIT_SHA.fullmatch(args.anvil_source_sha) is not None,
            "all native/probe inputs require immutable SHAs")
    require(0 < args.timeout <= 180, "real CAD import timeout must be bounded")
    require(not args.output_dir.exists(), "evidence directory must be new")
    require(sha(args.bundle.read_bytes()) == args.artifact_sha256,
            "original native Actions ZIP SHA-256 mismatch")
    require(args.probe.is_file() and sha(args.probe.read_bytes()) == args.probe_sha256,
            "independent AnvilCAD executable hash mismatch")
    with zipfile.ZipFile(args.bundle) as archive:
        native = verify_native_source(archive, args.kernel_sha)
    args.output_dir.mkdir(parents=True)
    report = dict(schema="intuit3d/anvilcad-kernel002-cut-chain/v1",
                  status="NOT_QUALIFIED", independentCadInteroperability=False,
                  nativeArtifactId=ARTIFACT_ID, nativeArtifactSha256=args.artifact_sha256,
                  kernelSourceCommit=args.kernel_sha,
                  platformSourceCommit=native["platformSha"],
                  occtSourceCommit=OCCT_SHA,
                  nativeWorkerSha256=native["workerSha256"],
                  anvilSourceCommit=args.anvil_source_sha,
                  anvilProbeSha256=args.probe_sha256, cases=[])
    try:
        for kind, thick, filename in CASES:
            rel = f"{kind}/{filename}"
            step = args.output_dir / filename
            step.write_bytes(native["steps"][rel])
            command = [str(args.probe.resolve()), "--cut-chains",
                       str(step.resolve()), kind, str(thick)]
            try:
                done = subprocess.run(command, capture_output=True, text=True,
                                      timeout=args.timeout, check=False)
            except subprocess.TimeoutExpired as exc:
                raise Rejected("independent cut-chain import timeout: " + rel) from exc
            log = args.output_dir / (filename + ".probe.log")
            log.write_text("COMMAND " + json.dumps(command) + "\nEXIT " +
                           str(done.returncode) + "\n[stdout]\n" + done.stdout +
                           "\n[stderr]\n" + done.stderr)
            require(done.returncode == 0 and not done.stderr.strip(),
                    "independent CAD STEP reconstruction failed: " + rel)
            measured = parse_receipt(done.stdout, kind, thick)
            report["cases"].append(dict(name=rel, nativeStepSha256=sha(step.read_bytes()),
                                        probeLogSha256=sha(log.read_bytes()), **measured))
        volumes = {c["name"]: c["measuredVolumeMm3"] for c in report["cases"]}
        require(volumes["ordered/plate-cuts-12.step"] >
                volumes["ordered/plate-cuts-8.step"] and
                volumes["mixed/mixed-12.step"] > volumes["mixed/mixed-8.step"] and
                volumes["mixed/mixed-8.step"] > volumes["ordered/plate-cuts-8.step"] and
                volumes["mixed/mixed-12.step"] > volumes["ordered/plate-cuts-12.step"],
                "independent physical edit/Boolean kind measurements inconclusive")
        report["status"] = "NON_OCCT_SOURCE_MATCHED_CUT_CHAINS_ACCEPTED"
        report["independentCadInteroperability"] = True
        return 0
    except (Rejected, ValueError, OSError, KeyError) as exc:
        report["error"] = str(exc)
        return 3
    finally:
        (args.output_dir / "qualification.json").write_text(
            json.dumps(report, sort_keys=True, indent=2) + "\n")
        print(json.dumps({"status": report["status"],
                          "evidence": str(args.output_dir / "qualification.json"),
                          "error": report.get("error")}, sort_keys=True))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    for arg in ("bundle", "probe", "output-dir"):
        p.add_argument("--" + arg, type=Path, required=True)
    for arg in ("kernel-sha", "anvil-source-sha", "probe-sha256", "artifact-sha256"):
        p.add_argument("--" + arg, required=True)
    p.add_argument("--timeout", type=float, default=90)
    try:
        return qualify(p.parse_args())
    except (Rejected, OSError, ValueError, TypeError, KeyError,
            zipfile.BadZipFile, subprocess.SubprocessError) as exc:
        print("NOT_QUALIFIED:", exc, file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
