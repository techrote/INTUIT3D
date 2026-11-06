"""Actual OCP-export fixture plus independent structural negative STEP checks."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from step_preflight import MAX_STEP_BYTES, verify_step_artifact


@unittest.skipUnless(importlib.util.find_spec('OCP'), 'experimental OCP runtime unavailable')
class StepPreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from ocp_worker import build_plate, save_and_reopen
        cls.temp = tempfile.TemporaryDirectory()
        cls.file = Path(cls.temp.name, 'real.step')
        shape = build_plate({'width': 120, 'depth': 80, 'thickness': 8,
                             'holes': [{'x': -30, 'y': 0, 'radius': 6}, {'x': 30, 'y': 0, 'radius': 6}]})
        save_and_reopen(shape, cls.file)
        cls.contents = cls.file.read_text(encoding='ascii')

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def assert_rejected(self, data: str, message: str):
        candidate = self.file.with_name('corrupt.step')
        candidate.write_text(data, encoding='ascii')
        with self.assertRaisesRegex(ValueError, message):
            verify_step_artifact(candidate, expected_holes=2)

    def test_actual_occt_ap214_mm_step_is_admitted(self):
        verify_step_artifact(self.file, expected_holes=2)

    def test_wrong_expected_hole_count_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'cylindrical'):
            verify_step_artifact(self.file, expected_holes=1)

    def test_truncation_is_rejected(self):
        self.assert_rejected(self.contents[:-50], 'truncated')

    def test_wrong_unit_is_rejected(self):
        self.assert_rejected(self.contents.replace('SI_UNIT(.MILLI.,.METRE.)', 'SI_UNIT($,.METRE.)'), 'length unit')

    def test_wrong_schema_is_rejected(self):
        self.assert_rejected(self.contents.replace('AUTOMOTIVE_DESIGN', 'UNSUPPORTED_SCHEMA'), 'AP214')

    def test_duplicate_entity_id_is_rejected(self):
        self.assert_rejected(self.contents.replace('#2 = APPLICATION_CONTEXT', '#1 = APPLICATION_CONTEXT'), 'duplicate')

    def test_cylinder_removed_is_rejected(self):
        self.assert_rejected(self.contents.replace('CYLINDRICAL_SURFACE', 'CONICAL_SURFACE', 1), 'cylindrical')

    def test_extra_solid_is_rejected(self):
        candidate = self.contents.replace('DATA;', "DATA;\n#99999 = MANIFOLD_SOLID_BREP('',#16);", 1)
        self.assert_rejected(candidate, 'single-solid')

    def test_size_limit_is_rejected(self):
        candidate = self.file.with_name('oversized.step')
        with candidate.open('wb') as output:
            output.seek(MAX_STEP_BYTES)
            output.write(b'x')
        with self.assertRaisesRegex(ValueError, 'file size'):
            verify_step_artifact(candidate, expected_holes=2)

    def test_supervisor_refuses_substituted_step_after_real_occt_validation(self):
        """Actual worker's valid JSON must not bless a replaced STEP artifact."""
        from run_plate import execute
        from test_protocol import plate
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / 'should-not-exist.step'
            wrapper = root / 'tamper_after_worker.py'
            native = str(Path(__file__).resolve().parents[1])
            wrapper.write_text(
                'import sys\nfrom pathlib import Path\n'
                f'sys.path.insert(0, {native!r})\n'
                'from ocp_worker import main\n'
                'main()\n'
                'args = sys.argv\n'
                "Path(args[args.index('--step')+1]).write_text('not a STEP file' * 100)\n",
                encoding='utf-8',
            )
            result = execute(plate(), step_output=target, timeout=35, worker=wrapper)
            self.assertEqual(result['status'], 'requires_reconciliation', result)
            self.assertIn('STEP preflight', result['message'])
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
