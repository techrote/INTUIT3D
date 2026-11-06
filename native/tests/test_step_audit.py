"""Actual OCP cross-process artifact audit, not an independent STEP importer."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_protocol import plate
from run_plate import execute
from step_audit_worker import inspect_step


@unittest.skipUnless(importlib.util.find_spec('OCP'), 'experimental OCP binding unavailable')
class StepAuditTests(unittest.TestCase):
    def test_actual_published_step_is_readable_and_matches_parent_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp, 'published.step')
            result = execute(plate(), step_output=destination, timeout=35)
            self.assertEqual(result['status'], 'validated_exact', result)
            audited = inspect_step(destination)
            self.assertEqual(result['stepReadback'], audited['metrics'])
            self.assertEqual(len(audited['sha256']), 64)
            self.assertEqual([hole['x'] for hole in audited['metrics']['cylindricalHoles']], [-30, 30])

    def test_structurally_valid_displaced_holes_are_not_published(self):
        """Same hole radii/mass/STEP topology, but different XY positions.

        The authoring worker's JSON remains truthful about its *original*
        shape, while its STEP bytes are replaced with a different real OCCT
        solid before parent inspection. Lexical/graph preflight alone passes.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            destination = root / 'must-not-publish.step'
            wrapper = root / 'substitute_actual_occt_step.py'
            native = str(Path(__file__).resolve().parents[1])
            wrapper.write_text(
                'import sys\n'
                f'sys.path.insert(0, {native!r})\n'
                'from pathlib import Path\n'
                'from ocp_worker import main, build_plate, save_and_reopen\n'
                'from step_preflight import verify_step_artifact\n'
                'main()\n'
                "candidate=Path(sys.argv[sys.argv.index('--step')+1])\n"
                "other={'width':120,'depth':80,'thickness':8,'holes':"
                "[{'x':-29,'y':0,'radius':6},{'x':31,'y':0,'radius':6}]}\n"
                'save_and_reopen(build_plate(other),candidate)\n'
                'verify_step_artifact(candidate,expected_holes=2)\n',
                encoding='utf-8',
            )
            result = execute(plate(), step_output=destination, worker=wrapper, timeout=35)
            self.assertEqual(result['status'], 'requires_reconciliation', result)
            self.assertIn('cylinder', result['message'])
            self.assertIn('wrong x', result['message'])
            self.assertFalse(destination.exists())

    def test_structurally_valid_wrong_radius_is_not_published(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            destination = root / 'must-not-publish.step'
            wrapper = root / 'substitute_different_radius.py'
            native = str(Path(__file__).resolve().parents[1])
            wrapper.write_text(
                'import sys\n'
                f'sys.path.insert(0, {native!r})\n'
                'from pathlib import Path\n'
                'from ocp_worker import main, build_plate, save_and_reopen\n'
                'main()\n'
                "candidate=Path(sys.argv[sys.argv.index('--step')+1])\n"
                "other={'width':120,'depth':80,'thickness':8,'holes':"
                "[{'x':-30,'y':0,'radius':6.1},{'x':30,'y':0,'radius':6}]}\n"
                'save_and_reopen(build_plate(other),candidate)\n',
                encoding='utf-8',
            )
            result = execute(plate(), step_output=destination, worker=wrapper, timeout=35)
            self.assertEqual(result['status'], 'requires_reconciliation', result)
            self.assertTrue('analytic oracle' in result['message'] or 'cylinder' in result['message'], result)
            self.assertFalse(destination.exists())

    def test_bad_step_does_not_produce_auditable_geometry(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, 'invalid.step')
            path.write_text('not a STEP model', encoding='ascii')
            with self.assertRaises(ValueError):
                inspect_step(path)


if __name__ == '__main__':
    unittest.main()
