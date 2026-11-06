"""Real export integration: optional structural-only vs intent-bound independent preflight."""
from __future__ import annotations

import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from step_preflight import verify_step_artifact


@unittest.skipUnless(importlib.util.find_spec('OCP'), 'experimental OCP unavailable')
class BoundPreflightTests(unittest.TestCase):
    def setUp(self):
        from ocp_worker import build_plate, save_and_reopen
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.plate = {
            'width': 120, 'depth': 80, 'thickness': 8,
            'holes': [{'x': -30, 'y': 0, 'radius': 6}, {'x': 30, 'y': 0, 'radius': 6}],
        }
        self.step = Path(self.temp.name, 'real.step')
        save_and_reopen(build_plate(self.plate), self.step)
        self.original = self.step.read_text('ascii')

    def test_intent_bound_preflight_accepts_actual_occt_plate(self):
        verify_step_artifact(self.step, expected_holes=2, plate=self.plate)

    def test_malformed_radius_is_rejected_before_same_engine_readback(self):
        pattern = r"(CYLINDRICAL_SURFACE\('',#\d+,)6\.(\);)"
        corrupted, count = re.subn(pattern, r'\g<1>6.001\2', self.original, count=1)
        self.assertEqual(count, 1)
        self.step.write_text(corrupted, encoding='ascii')
        # Legacy caller checked structure only; new supervisor requires intent.
        verify_step_artifact(self.step, expected_holes=2)
        with self.assertRaisesRegex(ValueError, 'STEP analytic: cylindrical bore centre/radius'):
            verify_step_artifact(self.step, expected_holes=2, plate=self.plate)

    def test_missing_or_relocated_support_plane_rejected(self):
        corrupted = self.original.replace(
            "CARTESIAN_POINT('',(-60.,-40.,0.))",
            "CARTESIAN_POINT('',(-59.999,-40.,0.))",
        )
        self.assertNotEqual(corrupted, self.original)
        self.step.write_text(corrupted, encoding='ascii')
        with self.assertRaisesRegex(ValueError, 'STEP analytic: X support planes'):
            verify_step_artifact(self.step, expected_holes=2, plate=self.plate)


if __name__ == '__main__':
    unittest.main()
