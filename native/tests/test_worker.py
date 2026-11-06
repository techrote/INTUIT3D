from __future__ import annotations

import importlib.util
import json
import os
import time
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from protocol import InvalidRequest
from run_plate import execute
from test_protocol import plate


class SupervisorTests(unittest.TestCase):
    def test_step_export_requires_durable_path(self):
        with self.assertRaisesRegex(InvalidRequest, 'durable'):
            execute(plate())

    def test_worker_crash_cannot_be_reported_as_geometry_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp, 'crash.py'); fake.write_text('import sys\nsys.exit(23)\n')
            req = plate(); req['exportStep'] = False
            result = execute(req, worker=fake)
            self.assertEqual(result['status'], 'worker_crash')
            self.assertNotIn('source', result)

    def test_worker_timeout_cannot_be_reported_as_geometry_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp, 'sleep.py'); fake.write_text('import time\ntime.sleep(5)\n')
            req = plate(); req['exportStep'] = False
            result = execute(req, worker=fake, timeout=0.12)
            self.assertEqual(result['status'], 'timeout')
            self.assertNotIn('source', result)

    @unittest.skipUnless(os.name == 'posix', 'POSIX worker tree isolation test')
    def test_plate_supervisor_timeout_cannot_leave_descendant_export_writer(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker, ready = Path(tmp, 'escaped.step'), Path(tmp, 'spawned.txt')
            fake = Path(tmp, 'orphan.py')
            payload = f"import pathlib,time; time.sleep(1.5); pathlib.Path({str(marker)!r}).write_text('escaped')"
            fake.write_text(
                "import subprocess,sys,time,pathlib\n"
                "p=subprocess.Popen([sys.executable, '-c', " + repr(payload) + "], "
                "stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
                "pathlib.Path(" + repr(str(ready)) + ").write_text(str(p.pid))\n"
                "time.sleep(8)\n", encoding='utf-8')
            req = plate(); req['exportStep'] = False
            result = execute(req, worker=fake, timeout=2.2)
            self.assertEqual(result['status'], 'timeout')
            self.assertNotIn('source', result)
            self.assertTrue(ready.exists(), 'worker never spawned the external writer')
            time.sleep(2.8)
            self.assertFalse(marker.exists(), 'post-timeout worker descendant survived')

    def test_plate_supervisor_limits_crash_diagnostic_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp, 'noise.py')
            fake.write_text("import sys\nsys.stderr.write('x'*200000+'TAIL')\nsys.exit(23)\n")
            req = plate(); req['exportStep'] = False
            result = execute(req, worker=fake, timeout=5)
            self.assertEqual(result['status'], 'worker_crash')
            self.assertTrue(result['diagnostic'].endswith('TAIL'))
            self.assertLessEqual(len(result['diagnostic']), 600)

    def test_worker_zero_exit_without_response_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp, 'noresult.py'); fake.write_text('print("done")\n')
            req = plate(); req['exportStep'] = False
            result = execute(req, worker=fake)
            self.assertEqual(result['status'], 'requires_reconciliation')

    def test_invalid_intent_never_reaches_backend(self):
        invalid = plate(); invalid['plate']['holes'][1]['x'] = -18
        with self.assertRaises(InvalidRequest):
            execute(invalid, worker=Path('/does/not/exist'))


@unittest.skipUnless(importlib.util.find_spec('OCP'), 'real OCCT OCP binding unavailable')
class ActualOCCTTests(unittest.TestCase):
    def test_analytic_plate_exact_brep_and_internal_step_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp, 'plate.step')
            result = execute(plate(), step_output=target, timeout=35)
            self.assertEqual(result['status'], 'validated_exact', result)
            self.assertEqual(result['occtVersion'], '7.9.3.1')
            self.assertEqual(result['source']['solidCount'], 1)
            self.assertEqual(result['stepReadback']['solidCount'], 1)
            self.assertGreater(target.stat().st_size, 1000)
            self.assertIn('ISO-10303-21', target.read_text(encoding='utf-8')[:200])

    def test_rejection_prevents_overwriting_previous_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp, 'existing.step'); target.write_text('existing sentinel', encoding='utf-8')
            result = execute(plate(), step_output=target, timeout=35)
            self.assertEqual(result['status'], 'requires_reconciliation', result)
            self.assertEqual(target.read_text(encoding='utf-8'), 'existing sentinel')

    def test_no_holes_is_single_closed_solid(self):
        blank = plate([]); blank['exportStep'] = False
        result = execute(blank, timeout=30)
        self.assertEqual(result['status'], 'validated_exact', result)
        self.assertFalse(result['stepWritten'])
        self.assertIsNone(result['stepReadback'])
        self.assertAlmostEqual(result['source']['volumeMm3'], 120 * 80 * 8, places=6)

    def test_microhole_preserves_cylindrical_topology(self):
        tiny = plate([{'x': 0, 'y': 0, 'radius': 1e-5}]);tiny['exportStep'] = False
        result = execute(tiny, timeout=35)
        self.assertEqual(result['status'], 'validated_exact', result)
        self.assertEqual(len(result['source']['cylindricalHoles']), 1)
        self.assertAlmostEqual(result['source']['cylindricalHoles'][0]['radius'], 1e-5, places=11)

    def test_one_hole_requires_real_material_removal(self):
        p = plate([{'x': 0, 'y': 0, 'radius': 6}]);p['exportStep'] = False
        result = execute(p, timeout=30)
        self.assertEqual(result['status'], 'validated_exact', result)
        self.assertLess(result['source']['volumeMm3'], 120 * 80 * 8)


if __name__ == '__main__':
    unittest.main()
