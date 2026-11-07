"""Fail-closed analytic product demo regressions; NOT pinned-C++ execution."""
from __future__ import annotations

import math
import unittest

from runtime_material_oracle import EXPECTED, MaterialOracleError, check_stage


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

    def test_unknown_stage(self):
        holes, volume = self.case("plate-8mm-two-bores")
        with self.assertRaisesRegex(MaterialOracleError, "unsupported"):
            check_stage("different-part", holes, volume)


if __name__ == "__main__":
    unittest.main()
