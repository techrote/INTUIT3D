#!/usr/bin/env python3
"""Independent AnvilCAD verification of six real KERNEL-002 L-profile STEP outputs.

This is a NEW physical test: source/same-engine receipts alone cannot pass.
Requires the SHA-pinned original hosted C++ Actions ZIP and a separately
compiled, SHA-pinned independent AnvilCAD probe with --l-profile support.
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

OCCT_SOURCE = "b8f597c677811d1f9f4d8a97f5ae2825c0353a42"
SHA = re.compile(r"[0-9a-f]{64}\Z")
GIT = re.compile(r"[0-9a-f]{40}\Z")
# Real, immutable input artifact #13589327619 (run #42408155937).
# Four geometric states, six distinct native exports; two baseline exports
# are intentionally independent producer executions of the same geometry.
CASES = (
    ("thickness", "initial-8", 120, 8, 3, 32720),
    ("thickness", "edited-12", 120, 12, 3, 49200),
    ("width", "l-width-120", 120, 8, 3, 32720),
    ("width", "l-width-140", 140, 8, 3, 35920),
    ("pocket", "pocket-3", 120, 8, 3, 32720),
    ("pocket", "pocket-5", 120, 8, 5, 32560),
)


class Rejected(ValueError):
    pass


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require(condition: bool, why: str) -> None:
    if not condition:
        raise Rejected(why)


def rays(width: float, thick: float, pocket: float):
    """Independent expected material/void and top-down pocket-floor Z rays."""
    z = thick - pocket
    return (
        ("foot.solid", 0, -30, thick),
        ("leg.solid", -width / 2 + 10, 0, thick),
        ("notch.void", 0, 0, None),
        ("exterior.void", width / 2 + 4, -30, None),
        ("foot.tip.inner", width / 2 - 1, -30, thick),
        ("foot.tip.outer", width / 2 + 1, -30, None),
        ("leg.notch.inner", -width / 2 + 29, 0, thick),
        ("leg.notch.outer", -width / 2 + 31, 0, None),
        ("foot.front.inner", 0, -39, thick),
        ("foot.front.outer", 0, -41, None),
        ("leg.top.inner", -width / 2 + 10, 39, thick),
        ("leg.top.outer", -width / 2 + 10, 41, None),
        ("window.centre", 15, -30, None),
        ("window.east.inner", 19, -30, None),
        ("window.east.outer", 21, -30, thick),
        ("window.west.inner", 11, -30, None),
        ("window.west.outer", 9, -30, thick),
        ("window.north.inner", 15, -27, None),
        ("window.north.outer", 15, -25, thick),
        ("window.south.inner", 15, -33, None),
        ("window.south.outer", 15, -35, thick),
        ("pocket.centre", -45, 10, z),
        ("pocket.east.inner", -41.5, 10, z),
        ("pocket.east.outer", -40.5, 10, thick),
        ("pocket.west.inner", -48.5, 10, z),
        ("pocket.west.outer", -49.5, 10, thick),
        ("pocket.north.inner", -45, 14.5, z),
        ("pocket.north.outer", -45, 15.5, thick),
        ("pocket.south.inner", -45, 5.5, z),
        ("pocket.south.outer", -45, 4.5, thick),
    )


def parse_receipt(output: str, width: int, thick: int, pocket: int, volume: int) -> dict:
    """Only actual imported-mesh ray output qualifies, never native manifests."""
    lines = output.splitlines()
    expected = rays(width, thick, pocket)
    require(len(lines) == len(expected) + 1, "missing/extra independent geometry observations")
    observations = []
    for line, (name, x, y, end) in zip(lines[:-1], expected):
        fields = line.split()
        require(len(fields) == 7 and fields[:2] == ["L_RAY", name],
                "independent ray missing, renamed or reordered: " + name)
        try:
            xx, yy, n, lo, hi = (float(fields[2]), float(fields[3]), int(fields[4]),
                                 float(fields[5]), float(fields[6]))
        except ValueError as exc:
            raise Rejected("invalid independent ray data: " + name) from exc
        require(all(math.isfinite(v) for v in (xx, yy, lo, hi))
                and abs(xx - x) <= 1e-7 and abs(yy - y) <= 1e-7,
                "ray position does not match authored fixture: " + name)
        if end is None:
            require(n == 0 and lo == -1 and hi == -1,
                    "expected truly empty material/through ray: " + name)
        else:
            require(n == 2 and abs(lo) <= 0.05 and abs(hi - end) <= 0.05,
                    "wrong material thickness, blind floor or translated shape: " + name)
        observations.append(dict(name=name, xMm=xx, yMm=yy, hits=n,
                                 entryZMm=lo if n else None,
                                 exitZMm=hi if n else None))
    fields = lines[-1].split()
    require(fields and fields[0] == "L_ACCEPT", "missing independent exact B-rep receipt")
    parts = [f.split("=", 1) for f in fields[1:]]
    require(all(len(p) == 2 for p in parts), "malformed physical receipt")
    result = dict(parts)
    require(len(result) == len(parts) and set(result) == {
        "solids", "source_unit", "imported_exact", "tris", "open_edges",
        "volume_mm3", "expected_mm3", "warnings"}, "duplicate/unknown receipt fields")
    require(result["solids"] == "1" and result["source_unit"] in
            ("millimetre", "millimeter") and result["imported_exact"] == "true"
            and result["open_edges"] == "0" and result["warnings"] == "0",
            "imported L-profile is not one exact closed, warning-free solid")
    try:
        count = int(result["tris"])
        measured, analytical = float(result["volume_mm3"]), float(result["expected_mm3"])
    except ValueError as exc:
        raise Rejected("malformed independent L-profile volume") from exc
    require(count >= 8 and all(math.isfinite(v) for v in (measured, analytical)) and
            abs(analytical - volume) <= 0.00001 and
            abs(measured - volume) <= volume * 0.01,
            "wrong independently measured solid volume")
    return dict(triangles=count, measuredVolumeMm3=measured,
                analyticalVolumeMm3=volume, rays=observations,
                importedExactBRep=True, sourceUnit=result["source_unit"])


def verify_source(z: zipfile.ZipFile, kernel_sha: str) -> dict:
    """Source binding of the *original* hosted bytes, not a geometry PASS."""
    names = z.namelist()
    require(len(names) == len(set(names)), "duplicate source-artifact archive member")
    assignments = dict(line.split("=", 1) for line in z.read("versions.txt").decode().splitlines()
                       if "=" in line)
    origin = dict(line.split("=", 1) for line in
                  z.read("l-profile-consumer/source-provenance.txt").decode().splitlines()
                  if "=" in line)
    require(assignments.get("kernel") == kernel_sha and origin.get("kernel_sha") == kernel_sha
            and GIT.fullmatch(origin.get("workflow_sha", "")) is not None
            and GIT.fullmatch(assignments.get("platform", "")) is not None,
            "source-matched KERNEL/Platform/Workflow provenance missing")
    acquire = json.loads(z.read("source-fetch/acquisition.json"))
    native = json.loads(z.read("qualification/qualification.json"))
    require(acquire.get("sourceCommit") == OCCT_SOURCE and
            native.get("status") == "NATIVE_EXPERIMENTAL_PASS" and
            native.get("nativeCppExecuted") is True, "pinned C++ source/execution not attested")
    worker = z.read("qualification/worker-build/intuit3d_occt8_plate")
    require(sha(worker) == native["worker"]["sha256"],
            "original compiled native worker bytes do not match qualification")
    # The six-step SHA list is an additional immutable producer receipt; it
    # does not serve as independent geometric evidence.
    receipts = {}
    for line in z.read("l-profile-consumer/six-step-files.sha256").decode().splitlines():
        token = line.split(maxsplit=1)
        require(len(token) == 2 and SHA.fullmatch(token[0]) is not None,
                "invalid native STEP SHA inventory")
        basename = token[1].split("l-profile-consumer/", 1)
        require(len(basename) == 2 and basename[1] not in receipts, "invalid STEP inventory path")
        receipts[basename[1]] = token[0]
    bound = {}
    for scenario, name, width, thick, pocket, volume in CASES:
        rel = f"{scenario}/{name}.step"
        path = "l-profile-consumer/" + rel
        require(names.count(path) == 1 and rel in receipts, "missing original native STEP: " + rel)
        content = z.read(path)
        manifest = json.loads(z.read(f"l-profile-consumer/{scenario}/manifest.json"))
        records = [r for r in manifest["records"] if r.get("label") == name]
        require(len(records) == 1 and manifest.get("independentInteroperability") is False,
                "native source receipt altered/misrepresented: " + rel)
        r = records[0]
        require(len(content) > 100 and sha(content) == r.get("stepSha256") == receipts[rel]
                and len(content) == r.get("stepBytes"), "native STEP bytes changed: " + rel)
        bound[rel] = content
    require(len(receipts) == len(CASES), "extra unexpected STEP in native SHA inventory")
    return dict(steps=bound, platform=assignments["platform"],
                workflow=origin["workflow_sha"], kernel=kernel_sha,
                workerSha256=sha(worker))


def qualify(args) -> int:
    require(GIT.fullmatch(args.kernel_sha) is not None and
            GIT.fullmatch(args.anvil_source_sha) is not None and
            SHA.fullmatch(args.probe_sha256) is not None and
            SHA.fullmatch(args.artifact_sha256) is not None,
            "all source and binary identities must be immutable full SHAs")
    require(args.timeout > 0 and args.timeout <= 180, "bounded physical execution timeout required")
    require(not args.output_dir.exists(), "output directory already exists")
    require(args.probe.is_file() and sha(args.probe.read_bytes()) == args.probe_sha256,
            "independent probe binary hash mismatch")
    require(sha(args.bundle.read_bytes()) == args.artifact_sha256,
            "original hosted native archive hash mismatch")
    with zipfile.ZipFile(args.bundle) as z:
        identity = verify_source(z, args.kernel_sha)
    args.output_dir.mkdir(parents=True)
    report = dict(schema="intuit3d/anvilcad-l-profile-physical/v1",
                  status="NOT_QUALIFIED", independentCadInteroperability=False,
                  nativeArtifactSha256=args.artifact_sha256,
                  anvilSourceCommit=args.anvil_source_sha,
                  anvilProbeSha256=args.probe_sha256,
                  occtSourceCommit=OCCT_SOURCE,
                  kernelSourceCommit=args.kernel_sha,
                  platformSourceCommit=identity["platform"],
                  workflowSourceCommit=identity["workflow"],
                  nativeWorkerSha256=identity["workerSha256"], cases=[])
    try:
        for scenario, name, width, thick, pocket, volume in CASES:
            rel = f"{scenario}/{name}.step"
            step = args.output_dir / f"{scenario}-{name}.step"
            step.write_bytes(identity["steps"][rel])
            cmd = [str(args.probe.resolve()), "--l-profile", str(step.resolve()),
                   str(width), "80", str(thick), "30", "20", str(pocket)]
            try:
                done = subprocess.run(cmd, text=True, capture_output=True,
                                      timeout=args.timeout, check=False)
            except subprocess.TimeoutExpired as exc:
                raise Rejected("independent L-profile CAD execution timed out: " + rel) from exc
            log = args.output_dir / f"{scenario}-{name}.probe.log"
            log.write_text("COMMAND " + json.dumps(cmd) + "\nEXIT " + str(done.returncode) +
                           "\n[stdout]\n" + done.stdout + "\n[stderr]\n" + done.stderr)
            require(done.returncode == 0 and not done.stderr.strip(),
                    "independent CAD importer/probe failed: " + rel)
            result = parse_receipt(done.stdout, width, thick, pocket, volume)
            report["cases"].append(dict(name=rel, nativeStepSha256=sha(step.read_bytes()),
                                        probeLogSha256=sha(log.read_bytes()), **result))
        measurements = {c["name"]: c["measuredVolumeMm3"] for c in report["cases"]}
        require(measurements["thickness/edited-12.step"] >
                measurements["thickness/initial-8.step"] and
                measurements["width/l-width-140.step"] >
                measurements["width/l-width-120.step"] and
                measurements["pocket/pocket-5.step"] <
                measurements["pocket/pocket-3.step"],
                "independent CAD failed retrospective thickness/width/pocket changes")
        report["status"] = "NON_OCCT_SOURCE_MATCHED_L_PROFILE_ACCEPTED"
        report["independentCadInteroperability"] = True
        return 0
    except (Rejected, ValueError, OSError) as exc:
        report["error"] = str(exc)
        return 3
    finally:
        (args.output_dir / "qualification.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"status": report["status"],
                          "evidence": str(args.output_dir / "qualification.json"),
                          "error": report.get("error")}, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("bundle", "probe", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("kernel-sha", "anvil-source-sha", "probe-sha256", "artifact-sha256"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--timeout", type=float, default=90)
    try:
        return qualify(parser.parse_args())
    except (Rejected, ValueError, OSError, KeyError, zipfile.BadZipFile) as exc:
        print("NOT_QUALIFIED:", exc, file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
