#!/usr/bin/env python3
"""Source-matched non-OCCT physical STEP acceptance of the selected U-bracket.

Original native C++ Actions artifact is immutable; the compiled AnvilCAD
probe independently imports each STEP as a solid and samples 40 real Z rays.
Native OCCT same-engine readback is NOT independent CAD qualification.
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

ARTIFACT_ID = 13593058907
ARTIFACT_SHA = "9f6ee1b45a9db925eaa941876bb399835232fa7c0f3667f905165386b3046ba9"
KERNEL_SHA = "7e893a6deb4ca7d88c7bd92ec42fb828cfc87a5c"
OCCT_SHA = "b8f597c677811d1f9f4d8a97f5ae2825c0353a42"
ANVIL_SHA = "50c053840933c92d598976e837e63ccd7626c312"
SOURCE_FIXTURE_SHA = "e9e610a22aa3e3eac01252e6418f006f2380ef83705c756df28931bf385554a0"
GIT = re.compile(r"[a-f0-9]{40}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
CASES = (("u-8", 8, 8), ("u-12", 12, 9))


class Rejected(ValueError):
    pass


def require(ok: bool, why: str) -> None:
    if not ok:
        raise Rejected(why)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def expected_volume(thickness: int) -> float:
    require(thickness in (8, 12), "unsupported U-bracket fixture thickness")
    # Independently authored U polygon area: 120x80 minus 70x50 notch.
    # Right-leg through window 10x12, left-leg R5 blind pocket depth 3.
    return (120 * 80 - 70 * 50 - 10 * 12) * thickness - math.pi * 25 * 3


def rays(thickness: int) -> list[tuple[str, float, float, float | None]]:
    """Model-coordinate ray oracle; no CAD import or native receipt dependency."""
    require(thickness in (8, 12), "unsupported U-bracket fixture thickness")
    z = float(thickness)
    result: list[tuple[str, float, float, float | None]] = [
        ("stock.left.foot", -47, -30, z), ("stock.right.foot", 47, -30, z),
        ("stock.web", 0, -30, z), ("stock.left.top", -47, 30, z),
        ("stock.right.top", 47, 30, z), ("notch.void", 0, 10, None),
        ("notch.floor.inner", 0, -9, None), ("notch.floor.outer", 0, -11, z),
        ("notch.left.inner", -34, 10, None), ("notch.left.outer", -36, 10, z),
        ("notch.right.inner", 34, 10, None), ("notch.right.outer", 36, 10, z),
        ("exterior.left.inner", -59, 0, z), ("exterior.left.outer", -61, 0, None),
        ("exterior.right.inner", 59, 0, z), ("exterior.right.outer", 61, 0, None),
        ("exterior.bottom.inner", 0, -39, z), ("exterior.bottom.outer", 0, -41, None),
        ("exterior.top.left.inner", -47, 39, z),
        ("exterior.top.left.outer", -47, 41, None),
        ("exterior.top.right.inner", 47, 39, z),
        ("exterior.top.right.outer", 47, 41, None),
        ("rectangle.centre", 47, 10, None),
    ]
    for side, dx, dy, half in (("east", 1, 0, 5), ("west", -1, 0, 5),
                               ("north", 0, 1, 6), ("south", 0, -1, 6)):
        result.append((f"rectangle.inner.{side}", 47+(half-.5)*dx,
                       10+(half-.5)*dy, None))
        result.append((f"rectangle.outer.{side}", 47+(half+.5)*dx,
                       10+(half+.5)*dy, z))
    floor = z - 3
    result.append(("circle.centre", -47, 10, floor))
    for side, dx, dy in (("east", 1, 0), ("west", -1, 0),
                         ("north", 0, 1), ("south", 0, -1)):
        result.append((f"circle.inner.{side}", -47+4.5*dx, 10+4.5*dy, floor))
        result.append((f"circle.outer.{side}", -47+5.5*dx, 10+5.5*dy, z))
    require(len(result) == 40, "U-bracket source ray count mismatch")
    return result


def parse_receipt(stdout: str, thickness: int) -> dict:
    expected = rays(thickness)
    lines = stdout.splitlines()
    require(len(lines) == len(expected)+1, "incomplete or extra U-bracket observations")
    observations = []
    for line, (name, x, y, top) in zip(lines[:-1], expected):
        tokens = line.split()
        require(len(tokens) == 7 and tokens[:2] == ["U_RAY", name],
                "wrong independent U-bracket ray identity/order: " + name)
        try:
            px, py = float(tokens[2]), float(tokens[3])
            hits = int(tokens[4])
            low, high = float(tokens[5]), float(tokens[6])
        except ValueError as exc:
            raise Rejected("invalid imported U-bracket physical observation") from exc
        require(all(map(math.isfinite, (px, py, low, high)))
                and abs(px-x) <= 1e-7 and abs(py-y) <= 1e-7,
                "displaced or non-finite material ray: " + name)
        if top is None:
            require(hits == 0 and low == -1 and high == -1,
                    "unexpected material inside U/notch/through-window: " + name)
        else:
            require(hits == 2 and abs(low) <= .05 and abs(high-top) <= .05,
                    "wrong imported material, circle radius or blind floor: " + name)
        observations.append(dict(name=name, xMm=px, yMm=py, hitCount=hits,
                                 entryZMm=low if hits else None,
                                 exitZMm=high if hits else None))
    parts = lines[-1].split()
    require(parts and parts[0] == "U_ACCEPT", "missing independent U-bracket CAD acceptance")
    pairs = [token.split("=", 1) for token in parts[1:]]
    require(all(len(p)==2 for p in pairs), "invalid imported U-bracket summary")
    summary = dict(pairs)
    require(len(summary) == len(pairs) and set(summary) == {
        "solids", "source_unit", "imported_exact", "tris", "open_edges",
        "volume_mm3", "expected_mm3", "warnings",
    }, "duplicate, unsupported or missing independent solid fields")
    require(summary["solids"] == "1" and summary["source_unit"] in
            ("millimetre", "millimeter") and summary["imported_exact"] == "true"
            and summary["open_edges"] == "0" and summary["warnings"] == "0",
            "import not one closed, exact, warning-free non-OCCT solid")
    try:
        triangles = int(summary["tris"])
        measured, claimed = float(summary["volume_mm3"]), float(summary["expected_mm3"])
    except ValueError as exc:
        raise Rejected("invalid independent U-bracket volume") from exc
    oracle = expected_volume(thickness)
    require(triangles >= 8 and all(map(math.isfinite, (measured, claimed)))
            and abs(claimed-oracle) <= 1e-5 and
            abs(measured-oracle) <= oracle*.01,
            "independently reconstructed U-bracket volume outside 1%")
    return dict(importedExactBRep=True, measuredVolumeMm3=measured,
                expectedVolumeMm3=oracle, rayCount=len(observations),
                triangles=triangles, rays=observations, sourceUnit=summary["source_unit"])


def verify_native_source(archive: zipfile.ZipFile, kernel_sha: str) -> dict:
    """Check producer/source/STEP bytes, *without* promoting source receipts."""
    names = archive.namelist()
    require(len(names) == len(set(names)), "duplicate native ZIP paths")
    versions = dict(line.split("=", 1) for line in
                    archive.read("versions.txt").decode().splitlines() if "=" in line)
    provenance = dict(line.split("=", 1) for line in
                      archive.read("u-bracket-physical/source-provenance.txt").decode().splitlines()
                      if "=" in line)
    require(versions.get("kernel") == kernel_sha
            and provenance.get("kernel_sha") == kernel_sha
            and GIT.fullmatch(versions.get("platform", "")) is not None
            and GIT.fullmatch(provenance.get("workflow_sha", "")) is not None,
            "source-matched immutable native KERNEL/Platform/Workflow missing")
    acquisition = json.loads(archive.read("source-fetch/acquisition.json"))
    native = json.loads(archive.read("qualification/qualification.json"))
    require(acquisition.get("sourceCommit") == OCCT_SHA
            and native.get("status") == "NATIVE_EXPERIMENTAL_PASS"
            and native.get("nativeCppExecuted") is True,
            "real pinned OCCT8 C++ execution not attested")
    worker = archive.read("qualification/worker-build/intuit3d_occt8_plate")
    worker_sha = sha(worker)
    require(worker_sha == native["worker"]["sha256"], "compiled native worker SHA mismatch")
    record = json.loads(archive.read("u-bracket-physical/manifest.json"))
    require(record.get("result") == "PINNED_OCCT8_CPP_SELECTED_ORTHOGONAL_TWO_STEP_EXECUTED"
            and record.get("version") == "OCCT-8.0.1-C++"
            and record.get("claim") == "same-engine physical validation; not independent external CAD"
            and record.get("sourceFixtureSha256") == SOURCE_FIXTURE_SHA,
            "native U-bracket source/provenance fixture mismatched")
    source_cases = record.get("observations")
    require(isinstance(source_cases, list) and len(source_cases) == 2,
            "native two-case physical U-bracket receipt missing")
    digest_lines = archive.read("u-bracket-physical/worker-and-step-files.sha256").decode().splitlines()
    sha_inventory = {}
    for line in digest_lines:
        fields = line.split(maxsplit=1)
        require(len(fields) == 2 and SHA.fullmatch(fields[0]) is not None,
                "bad native C++ / STEP SHA inventory")
        basename = fields[1].rsplit("/", 1)[-1]
        require(basename not in sha_inventory, "ambiguous native SHA basename")
        sha_inventory[basename] = fields[0]
    require(set(sha_inventory) == {"intuit3d_occt8_plate", "u-8.step", "u-12.step"}
            and sha_inventory["intuit3d_occt8_plate"] == worker_sha,
            "native executable SHA inventory unexpected or stale")
    steps = {}
    for label, thickness, revision in CASES:
        records = [case for case in source_cases if case.get("label") == label]
        require(len(records) == 1, "native U-bracket revision missing/ambiguous")
        entry = records[0]
        require(entry.get("revision") == revision and
                entry.get("profileId") == "sketch.u.bracket" and
                entry.get("bodyId") == "body.u.bracket" and
                entry.get("cuts") == ["cut.left.blind", "cut.right.through"],
                "wrong native semantic identity / cut chain")
        require(entry.get("independentInteroperability") is False
                and entry.get("exactAuthority") is False
                and entry.get("thicknessMm") == thickness
                and math.isclose(entry.get("measuredVolumeMm3", -1),
                                 expected_volume(thickness), rel_tol=0, abs_tol=1e-5),
                "native U-bracket source quantity does not match fixture")
        data = archive.read(f"u-bracket-physical/{label}.step")
        require(256 < len(data) < 32*1024*1024
                and sha(data) == entry.get("stepSha256")
                and sha(data) == sha_inventory[f"{label}.step"]
                and len(data) == entry.get("stepBytes"),
                "original hosted native U-bracket STEP bytes altered")
        steps[label] = data
    require(sha(steps["u-8"]) != sha(steps["u-12"]),
            "retrospective edit exported identical native STEP")
    return dict(steps=steps, workerSha256=worker_sha,
                kernelSourceCommit=kernel_sha, platformSourceCommit=versions["platform"],
                workflowSourceCommit=provenance["workflow_sha"])


def qualify(args: argparse.Namespace) -> int:
    require(args.kernel_sha == KERNEL_SHA and args.anvil_source_sha == ANVIL_SHA
            and args.artifact_sha256 == ARTIFACT_SHA
            and SHA.fullmatch(args.probe_sha256) is not None,
            "unrecognized or non-immutable external/native source pins")
    require(0 < args.timeout <= 180, "unbounded physical import timeout")
    require(not args.output_dir.exists(), "no overwriting physical evidence")
    require(args.probe.is_file() and sha(args.probe.read_bytes()) == args.probe_sha256,
            "actual independent executable SHA mismatch")
    require(sha(args.bundle.read_bytes()) == args.artifact_sha256,
            "immutable native Actions artifact SHA mismatch")
    with zipfile.ZipFile(args.bundle) as archive:
        native = verify_native_source(archive, args.kernel_sha)
    args.output_dir.mkdir(parents=True)
    report = dict(schema="intuit3d/anvilcad-u-bracket-physical/v1",
                  status="NOT_QUALIFIED", independentCadInteroperability=False,
                  nativeArtifactId=ARTIFACT_ID, nativeArtifactSha256=args.artifact_sha256,
                  kernelSourceCommit=args.kernel_sha,
                  platformSourceCommit=native["platformSourceCommit"],
                  workflowSourceCommit=native["workflowSourceCommit"],
                  occtSourceCommit=OCCT_SHA, nativeWorkerSha256=native["workerSha256"],
                  anvilSourceCommit=args.anvil_source_sha, anvilProbeSha256=args.probe_sha256,
                  cases=[])
    try:
        for label, thickness, revision in CASES:
            path = args.output_dir / f"{label}.step"
            path.write_bytes(native["steps"][label])
            command = [str(args.probe.resolve()), "--u-bracket", str(path.resolve()),
                       str(thickness)]
            try:
                done = subprocess.run(command, capture_output=True, text=True,
                                      timeout=args.timeout, check=False)
            except subprocess.TimeoutExpired as exc:
                raise Rejected("independent U-bracket import timed out: " + label) from exc
            log = args.output_dir / f"{label}.probe.log"
            log.write_text("COMMAND " + json.dumps(command) + "\nEXIT " +
                           str(done.returncode) + "\n[stdout]\n" + done.stdout +
                           "\n[stderr]\n" + done.stderr)
            require(done.returncode == 0 and not done.stderr.strip(),
                    "non-OCCT U-bracket physical reconstruction failed: " + label)
            measurement = parse_receipt(done.stdout, thickness)
            report["cases"].append(dict(label=label, revision=revision,
                                        nativeStepSha256=sha(path.read_bytes()),
                                        probeLogSha256=sha(log.read_bytes()), **measurement))
        cases = report["cases"]
        require(cases[1]["measuredVolumeMm3"] > cases[0]["measuredVolumeMm3"]
                and cases[1]["nativeStepSha256"] != cases[0]["nativeStepSha256"]
                and sum(c["rayCount"] for c in cases) == 80,
                "two native edits not independently distinguished")
        report["status"] = "NON_OCCT_SOURCE_MATCHED_U_BRACKET_ACCEPTED"
        report["independentCadInteroperability"] = True
        return 0
    except (Rejected, OSError, ValueError, KeyError, TypeError) as exc:
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
    except (Rejected, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile,
            subprocess.SubprocessError) as exc:
        print("NOT_QUALIFIED:", exc, file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
