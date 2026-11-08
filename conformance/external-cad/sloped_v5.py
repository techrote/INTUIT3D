#!/usr/bin/env python3
"""Fail-closed independent AnvilCAD import of genuine pinned KERNEL-002 v5 STEP.

Consumes TWO separately produced physical native execution directories:
the direct selected sloped profile and the authored INTENT/RUNTIME profile,
each at 8 and 12 mm. Does not generate STEP, trust same-engine readback as
external CAD, or promote skipped/synthetic probes into product authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys

ANVIL_PIN = "50c053840933c92d598976e837e63ccd7626c312"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA64 = re.compile(r"[0-9a-f]{64}\Z")
KINDS = ("direct", "authored")
THICKNESSES = (8, 12)
MAX_STEP_BYTES = 50_000_000


class Rejected(ValueError):
    """No independent CAD acceptance can be issued."""


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise Rejected(reason)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cut_presence(kind: str, thickness: int, cut_count: int) -> tuple[bool, bool]:
    require(kind in KINDS and thickness in THICKNESSES and
            type(cut_count) is int and 0 <= cut_count <= 2,
            "unsupported selected-profile progression")
    return ((cut_count == 2, cut_count >= 1) if kind == "direct"
            else (cut_count >= 1, cut_count == 2))


def expected_volume(kind: str, thickness: int, cut_count: int = 2) -> float:
    window, pocket = cut_presence(kind, thickness, cut_count)
    pocket_area = math.pi * 25 if kind == "direct" else 100
    return (5700 - (112 if window else 0)) * thickness - (
        pocket_area * 3 if pocket else 0)


def expected_surface(kind: str, thickness: int, cut_count: int = 2) -> float:
    window, pocket = cut_presence(kind, thickness, cut_count)
    wall = 2 * math.pi * 5 * 3 if kind == "direct" else 40 * 3
    return 2 * (5700 - (112 if window else 0)) + (
        320 + math.sqrt(4000) + (44 if window else 0)) * thickness + (
        wall if pocket else 0)


def ray_oracle(kind: str, thickness: int, cut_count: int = 2) -> list[tuple[str, float, float, float | None]]:
    """Selected diagonal polygon, concave junction, four cut walls and floor.

    Defined here from the authored feature dimensions, not copied from native
    receipts or STEP text. Every expected terminal is Z=thickness or the
    top-down blind pocket's Z=thickness-3; void means zero intersections.
    """
    window, pocket = cut_presence(kind, thickness, cut_count)
    z = float(thickness)
    rays: list[tuple[str, float, float, float | None]] = [
        ("stock.bottom", 40., 5., z),
        ("stock.left", 5., 40., z),
        ("stock.top", 5., 75., z),
        ("stock.right_foot", 112., 10., z),
        ("exterior.left", -2., 40., None),
        ("exterior.bottom", 40., -2., None),
        ("exterior.right", 122., 10., None),
        ("exterior.top", 20., 82., None),
        ("notch.below", 70., 19., z),
        ("notch.above", 70., 21., None),
    ]
    for i, y in enumerate((30., 50., 70.)):
        boundary = 65 - (y - 20) / 3
        rays.extend([
            (f"slope.{i}.inner", boundary - 1, y, z),
            (f"slope.{i}.outer", boundary + 1, y, None),
        ])
    rays.append(("window.centre", 95., 10., None if window else z))
    for side, dx, dy, half in (
        ("east", 1, 0, 7), ("west", -1, 0, 7),
        ("north", 0, 1, 4), ("south", 0, -1, 4),
    ):
        rays.extend([
            (f"window.inner.{side}", 95+(half-.5)*dx,
             10+(half-.5)*dy, None if window else z),
            (f"window.outer.{side}", 95+(half+.5)*dx,
             10+(half+.5)*dy, z),
        ])
    floor = z-3 if pocket else z
    rays.append(("pocket.centre", 15., 50., floor))
    for side, dx, dy in (
        ("east", 1, 0), ("west", -1, 0),
        ("north", 0, 1), ("south", 0, -1),
    ):
        rays.extend([
            (f"pocket.inner.{side}", 15+4.5*dx, 50+4.5*dy, floor),
            (f"pocket.outer.{side}", 15+5.5*dx, 50+5.5*dy, z),
        ])
    # The circle and square share cardinal wall occupancy. Their four
    # diagonal points (+/-4,+/-4) do not: radius sqrt(32) exceeds R5,
    # but each corner lies inside the 10x10 square. A mode swap must
    # fail even where 1% volume/surface budgets would otherwise pass.
    diagonal = z if kind == "direct" or not pocket else floor
    for side, dx, dy in (
        ("ne", 1, 1), ("nw", -1, 1), ("se", 1, -1), ("sw", -1, -1),
    ):
        rays.append((f"pocket.diagonal.{side}", 15+4*dx,
                     50+4*dy, diagonal))
    # A complete angular wall fingerprint, bracketing each expected pocket
    # boundary to 0.2 mm. The direct circular R5 wall has constant radius;
    # the authored 10x10 rectangle has orientation-dependent radial distance.
    # Uncut and through-only stages must have material at every sample.
    for i in range(12):
        angle = math.radians(15 + i * 30)
        dx, dy = math.cos(angle), math.sin(angle)
        wall = 5 if kind == "direct" else 5 / max(abs(dx), abs(dy))
        inner, outer = wall - .2, wall + .2
        rays.extend([
            (f"pocket.radial.{i}.inner", 15 + inner*dx,
             50 + inner*dy, z-3 if pocket else z),
            (f"pocket.radial.{i}.outer", 15 + outer*dx,
             50 + outer*dy, z),
        ])
    require(len(rays) == 62, "incomplete sloped selected-profile oracle")
    return rays


def expected_moments(kind: str, thickness: int,
                     cut_count: int = 2) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """Analytic selected-polygon mass centroid and six 3D covariance entries.

    Green's theorem integrates the CCW sloped contour directly. Rectangular
    through and circular/square blind tool moments are then subtracted.
    This oracle is authored independently of CAD mesh, STEP and native reports.
    """
    window, pocket = cut_presence(kind, thickness, cut_count)
    vertices = ((0., 0.), (120., 0.), (120., 20.),
                (65., 20.), (45., 80.), (0., 80.))
    area2 = moment_x = moment_y = second_xx = second_yy = second_xy = 0.
    for (x, y), (nx, ny) in zip(vertices, vertices[1:] + vertices[:1]):
        edge = x * ny - nx * y
        area2 += edge
        moment_x += (x + nx) * edge / 6
        moment_y += (y + ny) * edge / 6
        second_xx += (x*x + x*nx + nx*nx) * edge / 12
        second_yy += (y*y + y*ny + ny*ny) * edge / 12
        second_xy += (2*x*y + x*ny + nx*y + 2*nx*ny) * edge / 24
    area = area2 / 2
    require(abs(area - 5700) < 1e-8, "invalid independent polygon oracle")
    t = float(thickness)
    total = area * t
    first = [moment_x*t, moment_y*t, area*t*t/2]
    second = [second_xx*t, second_yy*t, area*t**3/3,
              second_xy*t, moment_x*t*t/2, moment_y*t*t/2]
    axes = ((0, 0), (1, 1), (2, 2), (0, 1), (0, 2), (1, 2))

    def subtract(volume: float, centre: tuple[float, ...],
                 variance: tuple[float, ...]) -> None:
        nonlocal total
        total -= volume
        for i in range(3):
            first[i] -= volume * centre[i]
        for k, (i, j) in enumerate(axes):
            second[k] -= volume * (
                centre[i] * centre[j] + (variance[i] if i == j else 0))

    if window:
        subtract(112*t, (95, 10, t/2), (14**2/12, 8**2/12, t*t/12))
    if pocket:
        lateral = 25/4 if kind == "direct" else 100/12
        pocket_area = 25*math.pi if kind == "direct" else 100
        subtract(pocket_area*3, (15, 50, t-1.5),
                 (lateral, lateral, 9/12))
    require(abs(total - expected_volume(kind, thickness, cut_count)) < 1e-7,
            "analytic selected-profile mass is inconsistent")
    centre = tuple(v / total for v in first)
    covariance = tuple(second[k]/total - centre[i]*centre[j]
                       for k, (i, j) in enumerate(axes))
    return centre, covariance


def parse_receipt(stdout: str, kind: str, thickness: int,
                  cut_count: int | None = None) -> dict:
    # None means legacy two-cut v5 receipt without a cuts field.
    progression = 2 if cut_count is None else cut_count
    expected = ray_oracle(kind, thickness, progression)
    lines = stdout.splitlines()
    require(len(lines) == 63, "missing, extra or duplicate physical ray lines")
    observed = []
    for line, (name, x, y, top) in zip(lines[:-1], expected):
        parts = line.split()
        require(len(parts) == 7 and parts[:2] == ["SLOPE_RAY", name],
                f"wrong independently reconstructed ray label/order: {name}")
        try:
            px, py = float(parts[2]), float(parts[3])
            count = int(parts[4])
            lo, hi = float(parts[5]), float(parts[6])
        except ValueError as exc:
            raise Rejected("invalid sloped ray observation") from exc
        require(all(map(math.isfinite, (px, py, lo, hi))) and
                abs(px-x) <= 1e-7 and abs(py-y) <= 1e-7,
                f"nonfinite or displaced selected-profile ray: {name}")
        if top is None:
            require(count == 0 and lo == -1 and hi == -1,
                    f"unexpected material in contour/cut void: {name}")
        else:
            require(count == 2 and abs(lo) <= .05 and abs(hi-top) <= .05,
                    f"wrong material/circular/rectangular pocket floor: {name}")
        observed.append({"name": name, "xMm": px, "yMm": py,
                         "hits": count, "enterZMm": lo if count else None,
                         "exitZMm": hi if count else None})
    pairs = [token.split("=", 1) for token in lines[-1].split()[1:]]
    require(lines[-1].startswith("SLOPE_ACCEPT ") and
            all(len(pair) == 2 for pair in pairs),
            "missing or malformed independent physical acceptance line")
    fields = dict(pairs)
    required = {
        "kind", "thickness_mm", "solids", "source_unit",
        "imported_exact", "tris", "open_edges", "volume_mm3",
        "expected_mm3", "surface_area_mm2", "expected_surface_mm2",
        "warnings",
    }
    required.update({
        "centroid_x_mm", "centroid_y_mm", "centroid_z_mm",
        "cov_xx_mm2", "cov_yy_mm2", "cov_zz_mm2",
        "cov_xy_mm2", "cov_xz_mm2", "cov_yz_mm2",
    })
    if cut_count is not None:
        required.add("cuts")
    require(len(fields) == len(pairs) and set(fields) == required,
            "duplicate, missing or unexpected sloped import receipt fields")
    if cut_count is not None:
        require(fields["cuts"] == str(progression),
                "independent progressive cut count mismatch")
    require(fields["kind"] == kind and
            fields["source_unit"] in ("millimetre", "millimeter") and
            fields["solids"] == "1" and fields["imported_exact"] == "true" and
            fields["open_edges"] == "0" and fields["warnings"] == "0",
            "wrong contour case, units or independently imported B-rep quality")
    try:
        read_t = float(fields["thickness_mm"])
        triangles = int(fields["tris"])
        volume, claimed = float(fields["volume_mm3"]), float(fields["expected_mm3"])
        area = float(fields["surface_area_mm2"])
        claimed_area = float(fields["expected_surface_mm2"])
    except ValueError as exc:
        raise Rejected("invalid independent imported mass or surface") from exc
    oracle = expected_volume(kind, thickness, progression)
    surface_oracle = expected_surface(kind, thickness, progression)
    require(all(map(math.isfinite, (read_t, volume, claimed, area, claimed_area)))
            and read_t == thickness and triangles >= 8 and volume > 0 and area > 0,
            "nonfinite, empty or wrong thickness independent solid")
    require(abs(claimed-oracle) < 1e-5 and
            abs(volume-oracle) <= oracle*.01,
            "independently reconstructed selected-profile material volume wrong")
    require(abs(claimed_area-surface_oracle) < 1e-5 and
            abs(area-surface_oracle) <= surface_oracle*.01,
            "independently reconstructed selected-profile surface wrong")
    centre_names = ("centroid_x_mm", "centroid_y_mm", "centroid_z_mm")
    cov_names = ("cov_xx_mm2", "cov_yy_mm2", "cov_zz_mm2",
                 "cov_xy_mm2", "cov_xz_mm2", "cov_yz_mm2")
    try:
        centre = tuple(float(fields[key]) for key in centre_names)
        covariance = tuple(float(fields[key]) for key in cov_names)
    except ValueError as exc:
        raise Rejected("invalid independently reconstructed material moments") from exc
    analytic_centre, analytic_covariance = expected_moments(
        kind, thickness, progression)
    for i, (actual, expected_centre) in enumerate(zip(centre, analytic_centre)):
        require(math.isfinite(actual) and abs(actual - expected_centre) <= .15,
                f"independent selected-profile centroid axis {i} wrong")
    for i, (actual, reference) in enumerate(zip(covariance, analytic_covariance)):
        tolerance = max(abs(reference)*.01, .1) if i < 3 else max(abs(reference)*.05, .25)
        require(math.isfinite(actual) and abs(actual-reference) <= tolerance,
                f"independent selected-profile material covariance {i} wrong")
    return {"importedExactBRep": True, "cutCount": progression, "rayCount": 62,
            "measuredCentroidMm": list(centre),
            "expectedCentroidMm": list(analytic_centre),
            "measuredMaterialCovarianceMm2": list(covariance),
            "expectedMaterialCovarianceMm2": list(analytic_covariance),
            "rays": observed, "triangleCount": triangles,
            "measuredVolumeMm3": volume, "expectedVolumeMm3": oracle,
            "measuredSurfaceAreaMm2": area,
            "expectedSurfaceAreaMm2": surface_oracle}


def read_json(path: Path) -> dict:
    data = path.read_bytes()
    require(len(data) <= 2_000_000, "oversized source receipt")
    result = json.loads(data)
    require(isinstance(result, dict), "malformed source receipt")
    return result


def verify_producer(kind: str, directory: Path, kernel_sha: str,
                    worker_sha: str, cpp_sha: str) -> dict:
    record_name = ("sloped-receipts.json" if kind == "direct"
                   else "authored-receipts.json")
    record = read_json(directory / record_name)
    provenance = record.get("provenance")
    require(isinstance(provenance, dict) and
            provenance.get("sourceSha") == kernel_sha and
            provenance.get("workerSha256") == worker_sha and
            provenance.get("cppSourceSha256") == cpp_sha and
            provenance.get("pinnedVersionRequired") == "OCCT-cxx-8.0.1" and
            provenance.get("qualifiedBinarySourceBinding") ==
            "requires-exact-head-build-log",
            "pinned C++ producer source/binary provenance does not match")
    if kind == "direct":
        require(record.get("status") ==
                "PINNED_OCCT8_LINEAR_V5_PHYSICAL_WORKER_EXECUTED",
                "direct pinned C++ v5 worker not recorded as executed")
    else:
        require(record.get("result") ==
                "PINNED_CXX_AUTHORED_SLOPED_TWO_STEP_EXECUTED" and
                record.get("exactAuthority") is False and
                record.get("independentInteroperability") is False,
                "authored selected-profile native evidence absent or overclaimed")
    receipts = record.get("receipts")
    require(isinstance(receipts, list) and len(receipts) == 2,
            "expected two distinct edited source-matched C++ STEP files")
    result = {}
    for i, thickness in enumerate(THICKNESSES):
        item = receipts[i]
        require(isinstance(item, dict), "invalid producer case")
        if kind == "direct":
            require(item.get("thickness") == thickness and
                    item.get("bodyId") == "body.sloped.bracket" and
                    item.get("cutFeatureIds") ==
                    ["cut.sloped.blind", "cut.sloped.through"] and
                    item.get("backend") == "pinned-OCCT-8.0.1-C++",
                    "direct native selected-profile/cutter identity mismatch")
        else:
            require(item.get("label") == f"authored-{thickness}" and
                    item.get("semanticBodyId") == "body.sloped" and
                    item.get("cutFeatureIds") ==
                    ["cut.sloped.through", "cut.sloped.blind"] and
                    item.get("cutDepths") == [thickness, 3],
                    "authored model history/cut order or thickness mismatch")
        require(item.get("exactAuthority") is False and
                item.get("independentInteroperability") is False,
                "unqualified native receipt claimed product exactness")
        source = item.get("source")
        require(isinstance(source, dict) and source.get("solidCount") == 1,
                "pinned C++ source solid evidence absent")
        step_hash = item.get("stepSha256")
        require(isinstance(step_hash, str) and SHA64.fullmatch(step_hash) is not None,
                "native STEP digest missing")
        filename = (f"sloped-{thickness}.step" if kind == "direct"
                    else f"authored-{thickness}.step")
        data = (directory / filename).read_bytes()
        require(256 < len(data) <= MAX_STEP_BYTES and
                item.get("stepBytes") == len(data) and digest(data) == step_hash,
                "original native STEP bytes differ from source-bound producer receipt")
        result[thickness] = (filename, data, step_hash)
    require(result[8][2] != result[12][2],
            "retrospective thickness edit did not produce distinct STEP")
    return {"recordSha256": digest((directory / record_name).read_bytes()),
            "provenance": provenance, "cases": result}


def execute(args: argparse.Namespace) -> int:
    if args.output_dir.exists():
        raise Rejected("evidence directory already exists; require fresh path")
    require(SHA40.fullmatch(args.kernel_sha) is not None and
            SHA64.fullmatch(args.probe_sha256) is not None and
            args.anvil_source_sha == ANVIL_PIN,
            "invalid producer, independent engine or executable source pin")
    source_sha = subprocess.check_output(
        ["git", "-C", str(args.kernel_tree), "rev-parse", "HEAD"],
        text=True, timeout=10).strip()
    require(source_sha == args.kernel_sha,
            "actual KERNEL checkout differs from pinned native source")
    cpp_sha = digest((args.kernel_tree / "native/occt8/plate_worker.cpp").read_bytes())
    worker_sha = digest(args.worker.read_bytes())
    probe_sha = digest(args.probe.read_bytes())
    require(probe_sha == args.probe_sha256 and args.probe.is_file() and
            args.worker.is_file(),
            "independent probe binary hash or worker binary missing/mismatched")
    direct = verify_producer("direct", args.direct_dir, source_sha, worker_sha, cpp_sha)
    authored = verify_producer("authored", args.authored_dir, source_sha, worker_sha, cpp_sha)
    args.output_dir.mkdir(parents=True)
    report = {
        "schema": "intuit3d.external-sloped-profile/v1",
        "status": "REJECTED",
        "independentCadInteroperability": False,
        "kernelSourceSha": source_sha,
        "nativeCppSourceSha256": cpp_sha,
        "nativeWorkerSha256": worker_sha,
        "anvilSourceSha": ANVIL_PIN,
        "independentProbeSha256": probe_sha,
        "sourceBindingNote": "Independent review of exact-source hosted compile log still required",
        "cases": [],
    }
    try:
        for kind, producer in (("direct", direct), ("authored", authored)):
            for thickness in THICKNESSES:
                filename, original, original_sha = producer["cases"][thickness]
                copied = args.output_dir / (kind + "-" + filename)
                copied.write_bytes(original)
                cmd = [str(args.probe.resolve()), "--sloped-profile",
                       str(copied.resolve()), kind, str(thickness)]
                try:
                    proc = subprocess.run(cmd, capture_output=True, text=True,
                                          timeout=args.timeout, check=False)
                except subprocess.TimeoutExpired as exc:
                    raise Rejected(f"independent {kind} {thickness}mm importer timed out") from exc
                log = args.output_dir / f"{kind}-{thickness}.anvil.log"
                log.write_text("command=" + json.dumps(cmd) +
                               "\nexit=" + str(proc.returncode) +
                               "\nstdout:\n" + proc.stdout +
                               "\nstderr:\n" + proc.stderr)
                require(proc.returncode == 0 and not proc.stderr.strip(),
                        f"independent CAD failed or warned for {kind}/{thickness}")
                physical = parse_receipt(proc.stdout, kind, thickness)
                require(digest(copied.read_bytes()) == original_sha,
                        "source-matched STEP bytes changed during independent import")
                report["cases"].append({
                    "kind": kind, "thicknessMm": thickness,
                    "nativeStepSha256": original_sha, "filename": copied.name,
                    "probeLogSha256": digest(log.read_bytes()),
                    "producerReceiptSha256": producer["recordSha256"],
                    **physical,
                })
        require(len(report["cases"]) == 4 and
                sum(case["rayCount"] for case in report["cases"]) == 248,
                "missing generalized edited CAD physical predicates")
        report["status"] = "NON_OCCT_SLOPED_V5_FOUR_STEP_PHYSICAL_PASS"
        report["independentCadInteroperability"] = True
        return 0
    except (Rejected, OSError, ValueError) as exc:
        report["error"] = str(exc)
        return 3
    finally:
        (args.output_dir / "qualification.json").write_text(
            json.dumps(report, sort_keys=True, indent=2) + "\n")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    for option in ("direct-dir", "authored-dir", "kernel-tree",
                   "worker", "probe", "output-dir"):
        p.add_argument("--" + option, type=Path, required=True)
    p.add_argument("--kernel-sha", required=True)
    p.add_argument("--probe-sha256", required=True)
    p.add_argument("--anvil-source-sha", required=True)
    p.add_argument("--timeout", type=int, default=120)
    args = p.parse_args()
    try:
        require(1 <= args.timeout <= 180, "unbounded independent CAD timeout")
        return execute(args)
    except (Rejected, OSError, ValueError, subprocess.SubprocessError,
            json.JSONDecodeError) as exc:
        print(f"NON_OCCT_SLOPED_V5_REJECTED: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
