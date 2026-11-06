"""Exact plate vertex-envelope tests, including an isomass/isometric spoof."""
from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from plate_envelope import require_plate_vertex_envelope_mm
from protocol import analytic_invariants


class PlateEnvelopeTests(unittest.TestCase):
    def setUp(self):
        self.plate = {
            "width": 120, "depth": 80, "thickness": 8,
            "holes": [{"x": -30, "y": 0, "radius": 6},
                      {"x": 30, "y": 0, "radius": 6}],
        }
        self.bounds = {"minX": -60, "maxX": 60, "minY": -40,
                       "maxY": 40, "minZ": 0, "maxZ": 8}

    def test_intended_envelope_accepted(self):
        self.assertIsNone(require_plate_vertex_envelope_mm(self.plate, self.bounds))

    def test_reject_reshaped_width_and_depth(self):
        for axis in ("minX", "maxX", "minY", "maxY"):
            with self.subTest(axis=axis), self.assertRaisesRegex(ValueError, axis):
                wrong = dict(self.bounds)
                wrong[axis] += 0.001
                require_plate_vertex_envelope_mm(self.plate, wrong, "STEP")

    def test_reject_moved_or_thickened_plate(self):
        for axis in ("minZ", "maxZ"):
            with self.subTest(axis=axis), self.assertRaisesRegex(ValueError, axis):
                wrong = dict(self.bounds)
                wrong[axis] += 0.001
                require_plate_vertex_envelope_mm(self.plate, wrong, "source")

    def test_reject_nonfinite_boolean_missing_and_extra_fields(self):
        candidates = [
            {"maxX": float("nan")}, {"maxX": float("inf")},
            {"maxX": True}, {"minX": None}, {"maxZ": "8"}, {"extra": 1},
        ]
        for update in candidates:
            with self.subTest(update=update), self.assertRaises(ValueError):
                require_plate_vertex_envelope_mm(self.plate, dict(self.bounds, **update))
        missing = dict(self.bounds)
        del missing["minY"]
        with self.assertRaises(ValueError):
            require_plate_vertex_envelope_mm(self.plate, missing)
        with self.assertRaises(ValueError):
            require_plate_vertex_envelope_mm(self.plate, [])

    def test_coordinate_equivalence_gate_is_explicit_not_a_boolean_tolerance(self):
        within = dict(self.bounds, maxX=60 + 5e-8)
        self.assertIsNone(require_plate_vertex_envelope_mm(self.plate, within))
        outside = dict(self.bounds, maxX=60 + 2e-7)
        with self.assertRaisesRegex(ValueError, "maxX"):
            require_plate_vertex_envelope_mm(self.plate, outside)

    def test_same_volume_area_and_cylinders_do_not_prove_plate_dimensions(self):
        """Independent algebra constructs a positive alternative plate.

        With fixed hole radii the two scalar mass equations admit a different
        width/depth/thickness triple. All holes still fit. A mass-only verifier
        would accept this substitute as exact.
        """
        original_volume, original_area = analytic_invariants(self.plate)
        thickness = 8.1
        removed_area = math.fsum(math.pi * h["radius"] ** 2 for h in self.plate["holes"])
        cylindrical_perimeter = math.fsum(2 * math.pi * h["radius"] for h in self.plate["holes"])
        product = original_volume / thickness + removed_area
        total = (original_area - 2 * (product - removed_area)) / (2 * thickness) - cylindrical_perimeter / 2
        width = (total + math.sqrt(total * total - 4 * product)) / 2
        depth = product / width
        alternative = dict(self.plate, width=width, depth=depth, thickness=thickness)
        new_volume, new_area = analytic_invariants(alternative)
        self.assertAlmostEqual(original_volume, new_volume, places=8)
        self.assertAlmostEqual(original_area, new_area, places=8)
        self.assertGreater(width / 2, 30 + 6)
        self.assertGreater(depth / 2, 6)
        self.assertNotAlmostEqual(width, self.plate["width"])
        changed = {"minX": -width / 2, "maxX": width / 2,
                   "minY": -depth / 2, "maxY": depth / 2,
                   "minZ": 0, "maxZ": thickness}
        with self.assertRaisesRegex(ValueError, "vertex envelope"):
            require_plate_vertex_envelope_mm(self.plate, changed, "STEP")


if __name__ == "__main__":
    unittest.main()
