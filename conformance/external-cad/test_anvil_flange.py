"""Regression tests for the original hosted AnvilCAD STEP acceptance gate.

These are receipt-parser tests, NOT a substitute for a real independent import.
The positive line shape was taken from the previously executed pinned OCCT8
8 mm STEP probe. Genuine physical acceptance must run the compiled Rust engine.
"""
from __future__ import annotations

import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from anvil_flange import NotQualified, checked_accept_receipt


CASE = {
    'widthMm': 120, 'depthMm': 80, 'thicknessMm': 8,
    'holes': [{'x': -30, 'y': 0, 'radius': 6},
              {'x': 30, 'y': 0, 'radius': 6}],
}
ACCEPT = (
    'ACCEPT solids=1 source_unit=millimetre imported_exact=true tris=1396 '
    'open_edges=0 volume_mm3=74998.026722331 '
    'expected_mm3=74990.442631532 warnings=0'
)


class AnvilExactImportGateTests(unittest.TestCase):
    def test_real_native_plate_receipt_shape_accepted(self):
        result, measured, theoretical = checked_accept_receipt([ACCEPT], CASE)
        self.assertEqual(result['imported_exact'], 'true')
        self.assertAlmostEqual(theoretical, (120 * 80 - 2 * math.pi * 36) * 8, places=6)
        self.assertAlmostEqual(measured, 74998.026722331, places=6)

    def test_nonexact_mesh_fallback_must_not_pass_cad_gate(self):
        with self.assertRaisesRegex(NotQualified, 'exact'):
            checked_accept_receipt([ACCEPT.replace('imported_exact=true',
                                                    'imported_exact=false')], CASE)

    def test_import_warnings_must_not_pass_cad_gate(self):
        with self.assertRaisesRegex(NotQualified, 'warning'):
            checked_accept_receipt([ACCEPT.replace('warnings=0', 'warnings=1')], CASE)

    def test_missing_exactness_or_warning_fields_fail_closed(self):
        for original in ('imported_exact=true ', 'warnings=0'):
            with self.subTest(field=original):
                with self.assertRaises(NotQualified):
                    checked_accept_receipt([ACCEPT.replace(original, '')], CASE)

    def test_duplicate_or_forged_acceptance_rejected(self):
        for lines in ([ACCEPT, ACCEPT],
                      [ACCEPT + ' imported_exact=false'],
                      [ACCEPT.replace('source_unit=millimetre',
                                      'source_unit=millimetre source_unit=inch')]):
            with self.subTest(lines=lines):
                with self.assertRaises(NotQualified):
                    checked_accept_receipt(lines, CASE)

    def test_wrong_volume_and_invalid_topology_fail_closed(self):
        for line in (ACCEPT.replace('open_edges=0', 'open_edges=2'),
                     ACCEPT.replace('solids=1', 'solids=2'),
                     ACCEPT.replace('tris=1396', 'tris=0'),
                     ACCEPT.replace('volume_mm3=74998.026722331', 'volume_mm3=80000.0'),
                     ACCEPT.replace('volume_mm3=74998.026722331', 'volume_mm3=nan'),
                     ACCEPT.replace('expected_mm3=74990.442631532', 'expected_mm3=78000')):
            with self.subTest(line=line):
                with self.assertRaises(NotQualified):
                    checked_accept_receipt([line], CASE)


if __name__ == '__main__':
    unittest.main()
