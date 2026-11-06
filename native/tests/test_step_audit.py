"""Actual OCP cross-process artifact audit, not an independent STEP importer."""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_isomass_isosurface_alternate_plate_step_is_not_published(self):
        """Real STEP with same cylinder positions, hole radii, mass and area.

        A different width/depth/thickness triple can have the same volume and
        surface area. STEP graph, cylinder counts/centres and mass-only gates
        accept the substitute; the new vertex envelope must refuse it.
        """
        import math
        from protocol import analytic_invariants
        from plate_envelope import require_plate_vertex_envelope_mm
        from ocp_worker import build_plate, save_and_reopen
        from step_preflight import verify_step_artifact
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / 'must-not-publish.step'
            intent = plate()['plate']
            v, a = analytic_invariants(intent)
            cut = sum(math.pi * h['radius'] ** 2 for h in intent['holes'])
            perimeter = sum(2 * math.pi * h['radius'] for h in intent['holes'])
            new_t = 8.1
            product = v / new_t + cut
            total = (a - 2 * (product - cut)) / (2 * new_t) - perimeter / 2
            new_w = (total + math.sqrt(total ** 2 - 4 * product)) / 2
            altered = dict(intent, width=new_w, depth=product / new_w, thickness=new_t)
            self.assertAlmostEqual(analytic_invariants(altered)[0], v, places=8)
            self.assertAlmostEqual(analytic_invariants(altered)[1], a, places=8)
            replacement = root / 'replacement.step'
            save_and_reopen(build_plate(altered), replacement)
            verify_step_artifact(replacement, expected_holes=2)
            independent_same_occt_reader = inspect_step(replacement)
            self.assertEqual(len(independent_same_occt_reader['metrics']['cylindricalHoles']), 2)
            self.assertLess(abs(independent_same_occt_reader['metrics']['volumeMm3'] - v), 1e-6)
            self.assertLess(abs(independent_same_occt_reader['metrics']['surfaceAreaMm2'] - a), 1e-6)
            # Prove the existing v1 scalar/cylinder validator ALONE would
            # falsely bless these alternate bytes. The supervisor must apply
            # the additional private coordinate oracle before publication.
            from protocol import validate_result
            request = plate()
            obsolete_gate_claim = {
                'protocol': request['protocol'], 'requestId': request['requestId'],
                'featureId': request['featureId'], 'revision': request['revision'],
                'backend': 'OCP-python-prototype', 'occtVersion': '7.9.3.1',
                'status': 'validated_exact', 'units': 'mm',
                'source': independent_same_occt_reader['metrics'],
                'stepReadback': independent_same_occt_reader['metrics'], 'stepWritten': True,
            }
            self.assertIs(validate_result(request, obsolete_gate_claim), obsolete_gate_claim)
            with self.assertRaisesRegex(ValueError, 'vertex envelope'):
                require_plate_vertex_envelope_mm(intent, independent_same_occt_reader['vertexEnvelopeMm'], 'STEP')
            wrapper = root / 'substitute_same_mass_and_area.py'
            native = str(Path(__file__).resolve().parents[1])
            wrapper.write_text(
                'import sys\nfrom pathlib import Path\n'
                f'sys.path.insert(0, {native!r})\n'
                'from ocp_worker import main\n'
                'main()\n'
                "Path(sys.argv[sys.argv.index('--step') + 1]).write_bytes("
                f"Path({str(replacement)!r}).read_bytes())\n",
                encoding='utf-8',
            )
            result = execute(plate(), step_output=target, worker=wrapper, timeout=35)
            self.assertEqual(result['status'], 'requires_reconciliation', result)
            self.assertIn('STEP vertex envelope', result['message'])
            self.assertFalse(target.exists())

    def test_parent_audit_timeout_reports_timeout_without_export(self):
        # The successful authoring worker cannot bless an export after the
        # second stage exceeds the shared operation deadline.
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp, 'not-published.step')
            with patch('run_plate._audit_step_bytes',
                       side_effect=subprocess.TimeoutExpired(['audit'], 0.01)):
                result = execute(plate(), step_output=destination, timeout=35)
            self.assertEqual(result['status'], 'timeout', result)
            self.assertFalse(destination.exists())

    def test_bad_step_does_not_produce_auditable_geometry(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, 'invalid.step')
            path.write_text('not a STEP model', encoding='ascii')
            with self.assertRaises(ValueError):
                inspect_step(path)


if __name__ == '__main__':
    unittest.main()
