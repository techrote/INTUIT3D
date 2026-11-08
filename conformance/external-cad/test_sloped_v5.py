"""Source-only regressions for sloped v5 physical probe contracts.

Synthetic receipts in these tests are NOT AnvilCAD executions and cannot
qualify any C++ STEP geometry. The real gate is sloped_v5.py with pinned
compiled worker, real STEP bytes and imported AnvilCAD results.
"""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from sloped_v5 import (
    Rejected, digest, expected_surface, expected_volume, expected_moments, parse_receipt,
    ray_oracle, verify_producer,
)


def synthetic_mass_fields(kind: str, thickness: int, cut_count: int = 2) -> str:
    """Source-only analytic numbers, NOT observations from imported CAD."""
    centre, cov = expected_moments(kind, thickness, cut_count)
    keys = ("centroid_x_mm", "centroid_y_mm", "centroid_z_mm",
            "cov_xx_mm2", "cov_yy_mm2", "cov_zz_mm2",
            "cov_xy_mm2", "cov_xz_mm2", "cov_yz_mm2")
    return " ".join(f"{name}={value:.9f}" for name, value
                    in zip(keys, centre + cov))


def synthetic_receipt(kind: str, thickness: int) -> str:
    lines = []
    for name, x, y, floor in ray_oracle(kind, thickness):
        count, low, high = ((0, -1., -1.) if floor is None else (2, 0., floor))
        lines.append(
            f"SLOPE_RAY {name} {x:.9f} {y:.9f} {count} {low:.9f} {high:.9f}"
        )
    volume = expected_volume(kind, thickness)
    surface = expected_surface(kind, thickness)
    lines.append(
        f"SLOPE_ACCEPT kind={kind} thickness_mm={thickness:.1f} "
        f"solids=1 source_unit=millimetre imported_exact=true tris=400 "
        f"open_edges=0 volume_mm3={volume:.9f} expected_mm3={volume:.9f} "
        f"surface_area_mm2={surface:.9f} expected_surface_mm2={surface:.9f} "
        f"{synthetic_mass_fields(kind, thickness)} warnings=0"
    )
    return "\n".join(lines) + "\n"


def synthetic_source(folder: Path, kind: str,
                     kernel: str = "a"*40,
                     worker: str = "b"*64,
                     cpp: str = "c"*64) -> dict:
    prov = {"sourceSha": kernel, "workerSha256": worker,
            "cppSourceSha256": cpp, "pinnedVersionRequired": "OCCT-cxx-8.0.1",
            "qualifiedBinarySourceBinding": "requires-exact-head-build-log"}
    items = []
    for thickness in (8, 12):
        filename = (f"sloped-{thickness}.step" if kind == "direct"
                    else f"authored-{thickness}.step")
        data = (f"MOCK STEP {kind} {thickness}" * 25).encode()
        (folder / filename).write_bytes(data)
        item = {"stepSha256": digest(data), "stepBytes": len(data),
                "source": {"solidCount": 1}, "exactAuthority": False,
                "independentInteroperability": False}
        if kind == "direct":
            item.update(thickness=thickness, bodyId="body.sloped.bracket",
                        backend="pinned-OCCT-8.0.1-C++",
                        cutFeatureIds=["cut.sloped.blind", "cut.sloped.through"])
        else:
            item.update(label=f"authored-{thickness}", semanticBodyId="body.sloped",
                        cutFeatureIds=["cut.sloped.through", "cut.sloped.blind"],
                        cutDepths=[thickness, 3])
        items.append(item)
    if kind == "direct":
        result = {"status": "PINNED_OCCT8_LINEAR_V5_PHYSICAL_WORKER_EXECUTED",
                  "provenance": prov, "receipts": items}
        name = "sloped-receipts.json"
    else:
        result = {"result": "PINNED_CXX_AUTHORED_SLOPED_TWO_STEP_EXECUTED",
                  "provenance": prov, "receipts": items,
                  "exactAuthority": False, "independentInteroperability": False}
        name = "authored-receipts.json"
    (folder / name).write_text(json.dumps(result))
    return result


class SlopedSourceOnlyTests(unittest.TestCase):
    def test_analytic_edited_cut_modes(self):
        self.assertAlmostEqual(expected_volume("direct", 8), 44468.3805509808)
        self.assertAlmostEqual(expected_volume("direct", 12), 66820.3805509808)
        self.assertEqual(expected_volume("authored", 8), 44404)
        self.assertEqual(expected_volume("authored", 12), 66756)
        self.assertEqual(len(ray_oracle("direct", 8)), 62)
        self.assertEqual(len(set(name for name, *_ in ray_oracle("direct", 8))), 62)
        self.assertGreater(expected_surface("direct", 12),
                           expected_surface("direct", 8))
        with self.assertRaises(Rejected):
            expected_volume("direct", 10)

    def test_four_synthetic_receipts_parse_only(self):
        for kind in ("direct", "authored"):
            for thickness in (8, 12):
                with self.subTest(kind=kind, thickness=thickness):
                    receipt = parse_receipt(synthetic_receipt(kind, thickness),
                                            kind, thickness)
                    self.assertEqual(receipt["rayCount"], 62)
                    self.assertAlmostEqual(receipt["measuredVolumeMm3"],
                                           expected_volume(kind, thickness))
                    self.assertAlmostEqual(receipt["measuredSurfaceAreaMm2"],
                                           expected_surface(kind, thickness))

    def test_slope_concavity_and_cut_floor_adversaries_rejected(self):
        base = synthetic_receipt("direct", 8)
        for old, new in (
            ("SLOPE_RAY slope.1.inner", "SLOPE_RAY slope.1.outer"),
            ("SLOPE_RAY notch.above 70.000000000 21.000000000 0",
             "SLOPE_RAY notch.above 70.000000000 21.000000000 2"),
            ("SLOPE_RAY window.centre 95.000000000 10.000000000 0",
             "SLOPE_RAY window.centre 95.000000000 10.000000000 2"),
            ("SLOPE_RAY pocket.centre 15.000000000 50.000000000 2 0.000000000 5.000000000",
             "SLOPE_RAY pocket.centre 15.000000000 50.000000000 2 0.000000000 8.000000000"),
            ("SLOPE_RAY slope.2.outer", "SLOPE_RAY slope.2.inner"),
        ):
            self.assertIn(old, base)
            with self.subTest(old=old):
                with self.assertRaises(Rejected):
                    parse_receipt(base.replace(old, new), "direct", 8)

    def test_wrong_circular_vs_square_pocket_rejected_at_diagonal(self):
        # Circle and square share cardinal wall occupancy, but their four
        # 4x4 diagonal samples are physically different.
        direct = synthetic_receipt("direct", 8)
        authored = synthetic_receipt("authored", 8)
        self.assertIn("SLOPE_RAY pocket.diagonal.ne 19.000000000 54.000000000 "
                      "2 0.000000000 8.000000000", direct)
        self.assertIn("SLOPE_RAY pocket.diagonal.ne 19.000000000 54.000000000 "
                      "2 0.000000000 5.000000000", authored)
        disguised = authored.replace("kind=authored", "kind=direct")
        vol = expected_volume("direct", 8)
        area = expected_surface("direct", 8)
        disguised = disguised.replace(
            "expected_mm3=44404.000000000", f"expected_mm3={vol:.9f}"
        ).replace("expected_surface_mm2=" + f"{expected_surface('authored', 8):.9f}",
                  "expected_surface_mm2=" + f"{area:.9f}")
        with self.assertRaisesRegex(Rejected, "floor"):
            parse_receipt(disguised, "direct", 8)

    def test_nonfinite_warning_wrong_mass_area_and_duplicate_rejected(self):
        base = synthetic_receipt("authored", 12)
        for changed in (
            base.replace("source_unit=millimetre", "source_unit=inch"),
            base.replace("warnings=0", "warnings=1"),
            base.replace("imported_exact=true", "imported_exact=false"),
            base.replace("open_edges=0", "open_edges=2"),
            base.replace("volume_mm3=66756.000000000", "volume_mm3=nan"),
            base.replace("expected_mm3=66756.000000000", "expected_mm3=1"),
            base.replace("surface_area_mm2=", "surface_area_mm2=nan", 1),
            base.replace("expected_surface_mm2=", "expected_surface_mm2=inf", 1),
            base.replace("solids=1", "solids=2"),
            base.replace("tris=400", "tris=0"),
            base.replace("kind=authored", "kind=direct"),
            base.replace("thickness_mm=12.0", "thickness_mm=8.0"),
            base + base.splitlines()[0] + "\n",
            base.replace("warnings=0", "warnings=0 warnings=0"),
        ):
            with self.subTest(changed=changed[-80:]):
                with self.assertRaises(Rejected):
                    parse_receipt(changed, "authored", 12)

    def test_producer_mutation_source_and_identity_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for kind in ("direct", "authored"):
                with self.subTest(kind=kind):
                    source = synthetic_source(directory, kind)
                    result = verify_producer(kind, directory, "a"*40,
                                             "b"*64, "c"*64)
                    self.assertEqual(len(result["cases"]), 2)
                    with self.assertRaisesRegex(Rejected, "provenance"):
                        verify_producer(kind, directory, "f"*40,
                                        "b"*64, "c"*64)
                    step = directory / ("sloped-8.step" if kind == "direct"
                                        else "authored-8.step")
                    step.write_bytes(step.read_bytes() + b"tampered")
                    with self.assertRaisesRegex(Rejected, "original native STEP"):
                        verify_producer(kind, directory, "a"*40,
                                        "b"*64, "c"*64)
                    source["receipts"][0]["cutFeatureIds"] = []
                    name = ("sloped-receipts.json" if kind == "direct"
                            else "authored-receipts.json")
                    (directory / name).write_text(json.dumps(source))
                    with self.assertRaisesRegex(Rejected, "identity|order"):
                        verify_producer(kind, directory, "a"*40,
                                        "b"*64, "c"*64)


if __name__ == "__main__":
    unittest.main()

# Synthetic v6 receipts deliberately do not count as physical C++/AnvilCAD runs.
class ProgressiveV6OracleTests(unittest.TestCase):
    def v6_receipt(self, kind, count, thickness):
        rows = []
        for name, x, y, floor in ray_oracle(kind, thickness, count):
            hits, low, high = ((0, -1., -1.) if floor is None else (2, 0., floor))
            rows.append(
                f"SLOPE_RAY {name} {x:.9f} {y:.9f} {hits} {low:.9f} {high:.9f}"
            )
        v = expected_volume(kind, thickness, count)
        s = expected_surface(kind, thickness, count)
        rows.append(
            f"SLOPE_ACCEPT kind={kind} cuts={count} thickness_mm={thickness:.1f} "
            "solids=1 source_unit=millimetre imported_exact=true tris=400 "
            f"open_edges=0 volume_mm3={v:.9f} expected_mm3={v:.9f} "
            f"surface_area_mm2={s:.9f} expected_surface_mm2={s:.9f} "
            f"{synthetic_mass_fields(kind, thickness, count)} warnings=0"
        )
        return "\n".join(rows) + "\n"

    def test_radial_wall_fingerprint_all_stages(self):
        # Analytic source-only oracle: angular wall brackets must detect
        # displaced/wrong-radius circular pockets, square corners and absent cuts.
        import math
        for kind in ("direct", "authored"):
            for count in (0, 1, 2):
                for thickness in (8, 12):
                    with self.subTest(kind=kind, count=count, thickness=thickness):
                        rays = {name: (x, y, top) for name, x, y, top
                                in ray_oracle(kind, thickness, count)}
                        pocket = count >= 1 if kind == "direct" else count == 2
                        self.assertEqual(len(rays), 62)
                        for i in range(12):
                            angle = math.radians(15 + 30*i)
                            dx, dy = math.cos(angle), math.sin(angle)
                            expected_wall = (5 if kind == "direct" else
                                             5/max(abs(dx), abs(dy)))
                            near = rays[f"pocket.radial.{i}.inner"]
                            far = rays[f"pocket.radial.{i}.outer"]
                            self.assertAlmostEqual(math.hypot(near[0]-15, near[1]-50),
                                                   expected_wall-.2, places=8)
                            self.assertAlmostEqual(math.hypot(far[0]-15, far[1]-50),
                                                   expected_wall+.2, places=8)
                            self.assertEqual(near[2], thickness-3 if pocket else thickness)
                            self.assertEqual(far[2], thickness)
                        # A wrong wall at any single azimuth must fail the
                        # receipt contract even when its volume fields match.
                        good = self.v6_receipt(kind, count, thickness)
                        label = "pocket.radial.1.inner"
                        row = next(r for r in good.splitlines()
                                   if r.startswith(f"SLOPE_RAY {label} "))
                        with self.assertRaises(Rejected):
                            parse_receipt(good.replace(row, row.replace(
                                "SLOPE_RAY "+label, "SLOPE_RAY pocket.radial.bad")),
                                kind, thickness, cut_count=count)

    def test_progressive_twelve_stage_geometry(self):
        for kind in ("direct", "authored"):
            for count in (0, 1, 2):
                for t in (8, 12):
                    with self.subTest(kind=kind, count=count, t=t):
                        self.assertEqual(len(ray_oracle(kind, t, count)), 62)
                        receipt = parse_receipt(self.v6_receipt(kind, count, t),
                                                kind, t, cut_count=count)
                        self.assertEqual(receipt["cutCount"], count)
                        self.assertEqual(receipt["rayCount"], 62)
                        self.assertAlmostEqual(receipt["measuredVolumeMm3"],
                                               expected_volume(kind, t, count))
        self.assertAlmostEqual(expected_volume("direct", 8, 0), 45600)
        self.assertAlmostEqual(expected_volume("direct", 8, 1), 45364.38055098)
        self.assertAlmostEqual(expected_volume("direct", 8, 2), 44468.38055098)
        self.assertAlmostEqual(expected_volume("authored", 8, 0), 45600)
        self.assertEqual(expected_volume("authored", 8, 1), 44704)
        self.assertEqual(expected_volume("authored", 8, 2), 44404)

    def test_material_distribution_and_nan_rejected_across_all_progressions(self):
        # Synthetic parser adversaries demonstrate a previously unobserved
        # equal-volume/area, point-ray-preserving displacement in the receipt.
        # The Rust probe must independently calculate the values from triangles.
        for kind in ("direct", "authored"):
            for count in (0, 1, 2):
                for thickness in (8, 12):
                    with self.subTest(kind=kind, count=count, thickness=thickness):
                        good = self.v6_receipt(kind, count, thickness)
                        parsed = parse_receipt(good, kind, thickness,
                                               cut_count=count)
                        c, cov = expected_moments(kind, thickness, count)
                        self.assertAlmostEqual(parsed["measuredCentroidMm"][0], c[0])
                        self.assertAlmostEqual(parsed["measuredMaterialCovarianceMm2"][3],
                                               cov[3])
                        for field in ("centroid_x_mm", "centroid_z_mm",
                                      "cov_xx_mm2", "cov_xy_mm2"):
                            marker = next(token for token in good.splitlines()[-1].split()
                                          if token.startswith(field + "="))
                            bad_value = float(marker.split("=", 1)[1])
                            displaced = good.replace(
                                marker, f"{field}={bad_value + (100 if field.startswith('cov_') else 10):.9f}")
                            with self.assertRaisesRegex(Rejected, "centroid|covariance"):
                                parse_receipt(displaced, kind, thickness,
                                              cut_count=count)
                            with self.assertRaises(Rejected):
                                parse_receipt(good.replace(marker, f"{field}=nan"),
                                              kind, thickness, cut_count=count)

    def test_progressive_wrong_stage_and_absent_cut_rejection(self):
        for kind in ("direct", "authored"):
            for count in (0, 1, 2):
                good = self.v6_receipt(kind, count, 8)
                bad_stage = good.replace(f"cuts={count}", f"cuts={(count+1)%3}")
                with self.assertRaisesRegex(Rejected, "cut count"):
                    parse_receipt(bad_stage, kind, 8, cut_count=count)
                wrong = good.replace("SLOPE_RAY window.centre 95.000000000 10.000000000 2",
                                     "SLOPE_RAY window.centre 95.000000000 10.000000000 0")
                if count == 0 or (kind == "direct" and count == 1):
                    with self.assertRaises(Rejected):
                        parse_receipt(wrong, kind, 8, cut_count=count)
                wrong_pocket = good.replace(
                    next(row for row in good.splitlines() if row.startswith("SLOPE_RAY pocket.centre ")),
                    "SLOPE_RAY pocket.centre 15.000000000 50.000000000 0 -1.000000000 -1.000000000")
                with self.assertRaises(Rejected):
                    parse_receipt(wrong_pocket, kind, 8, cut_count=count)
