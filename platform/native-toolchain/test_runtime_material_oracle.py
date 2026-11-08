"""Fail-closed analytic product demo regressions; NOT pinned-C++ execution."""
from __future__ import annotations

import math
import unittest
from pathlib import Path
import shutil
import tempfile

from runtime_material_oracle import EXPECTED, MaterialOracleError, check_stage, verify_runtime_sketch_fixture


class MaterialOracleTests(unittest.TestCase):
    def case(self, stage):
        thickness, positions = EXPECTED[stage]
        holes = [{"x": x, "y": y, "radius": r} for x, y, r in positions]
        volume = thickness * (9600 - sum(math.pi * r*r for _, _, r in positions))
        return holes, volume

    def test_all_seven_real_authored_states(self):
        self.assertEqual(len(EXPECTED), 7)
        for stage in EXPECTED:
            with self.subTest(stage=stage):
                holes, volume = self.case(stage)
                self.assertAlmostEqual(check_stage(stage, holes, volume)["analyticVolumeMm3"], volume)
                self.assertEqual(check_stage(stage, list(reversed(holes)), volume)["thicknessMm"], EXPECTED[stage][0])

    def test_old_monotone_but_fabricated_volumes_refused(self):
        # Previously these 100/150/155/.. arbitrary values passed admission.
        for stage, volume in zip(EXPECTED, (100, 150, 155, 150, 100, 155, 100)):
            holes, _ = self.case(stage)
            with self.subTest(stage=stage), self.assertRaisesRegex(MaterialOracleError, "volume"):
                check_stage(stage, holes, volume)

    def test_wrong_individual_radii_equal_total_void_area(self):
        holes, volume = self.case("plate-8mm-two-bores")
        holes[0]["radius"] = 4
        holes[1]["radius"] = math.sqrt(72 - 16)
        with self.assertRaisesRegex(MaterialOracleError, "radius"):
            check_stage("plate-8mm-two-bores", holes, volume)

    def test_misplaced_bore_without_volume_change(self):
        holes, volume = self.case("retrospective-12mm-rebuild")
        holes[0]["x"] += 1
        with self.assertRaisesRegex(MaterialOracleError, "bore 0.x"):
            check_stage("retrospective-12mm-rebuild", holes, volume)

    def test_wrong_thickness_with_correct_holes(self):
        holes, wrong_volume = self.case("retrospective-12mm-rebuild")
        with self.assertRaisesRegex(MaterialOracleError, "volume"):
            check_stage("plate-8mm-two-bores", holes, wrong_volume)

    def test_nonfinite_and_invalid_shapes(self):
        holes, volume = self.case("plate-8mm-two-bores")
        for invalid in (float("nan"), float("inf"), True, "74990"):
            with self.subTest(invalid=str(invalid)), self.assertRaises(MaterialOracleError):
                check_stage("plate-8mm-two-bores", holes, invalid)
        holes[0]["radius"] = float("nan")
        with self.assertRaisesRegex(MaterialOracleError, "non-finite"):
            check_stage("plate-8mm-two-bores", holes, volume)

    @unittest.skipUnless(shutil.which("node"), "requires executable Node for source-bound fixture")
    def test_source_bound_sketch_bores_and_drift_rejection(self):
        # Synthetic module exercises the real subprocess/import boundary.
        # The physical CI independently loads the immutable accepted SKETCH.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            module = root / "packages/sketch/index.mjs"
            module.parent.mkdir(parents=True)
            source = """export function plateSketchFixture() {
              return {units:'mm',
                points:[
                  {id:'p0',x:0,y:0},{id:'p1',x:120,y:0},
                  {id:'p2',x:120,y:80},{id:'p3',x:0,y:80},
                  {id:'holeA:center',x:35,y:40},{id:'holeB:center',x:85,y:40}],
                lines:[
                  {start:'p0',end:'p1'},{start:'p1',end:'p2'},
                  {start:'p2',end:'p3'},{start:'p3',end:'p0'}],
                circles:[
                  {center:'holeA:center',radius:6},
                  {center:'holeB:center',radius:6}]};
            }"""
            module.write_text(source)
            matched = verify_runtime_sketch_fixture(root)
            self.assertEqual(matched["authoredBoresLocalMm"],
                             [{"x": -25.0, "y": 0.0, "radius": 6.0},
                              {"x": 25.0, "y": 0.0, "radius": 6.0}])
            # The old mistaken 30/90 fixture must not be silently accepted.
            module.write_text(source.replace("x:35,y:40", "x:30,y:40"))
            with self.assertRaisesRegex(MaterialOracleError, "differs"):
                verify_runtime_sketch_fixture(root)
            # Even if bore centers remain unchanged, edited plate stock is
            # not the 120x80 analytic fixture and must be rejected.
            module.write_text(source.replace("x:120,y:0", "x:121,y:0")
                                    .replace("x:120,y:80", "x:121,y:80"))
            with self.assertRaisesRegex(MaterialOracleError, "width"):
                verify_runtime_sketch_fixture(root)

    def test_unknown_stage(self):
        holes, volume = self.case("plate-8mm-two-bores")
        with self.assertRaisesRegex(MaterialOracleError, "unsupported"):
            check_stage("different-part", holes, volume)


if __name__ == "__main__":
    unittest.main()
