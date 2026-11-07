"""Acceptance smoke for the actual operator-facing local OCP demo command.

Executed only after native/ci.sh provisions pinned experimental OCP on Linux.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(shutil.which('node'), 'Node 22 executable unavailable')
class LocalPlateDemoCliTest(unittest.TestCase):
    def test_demo_builds_and_rebuilds_brep_then_exports_real_step(self):
        with tempfile.TemporaryDirectory(prefix='intuit3d-native-demo-') as folder:
            destination = Path(folder) / 'fresh-plate.step'
            env = dict(os.environ, PYTHON=sys.executable)
            completed = subprocess.run(
                ['node', 'native/examples/local-plate-demo.mjs', str(destination), '12'],
                cwd=ROOT, capture_output=True, text=True, env=env, timeout=90,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            output = json.loads(completed.stdout)
            self.assertEqual(output['evidence'],
                             'experimental_OCP_7.9.3.1_same_engine_STEP_readback')
            self.assertIs(output['exactAuthority'], False)
            self.assertIs(output['independentInteroperability'], False)
            self.assertEqual(output['initial']['solidCount'], 1)
            self.assertEqual(output['initial']['holes'], 2)
            self.assertEqual(output['edited']['solidCount'], 1)
            self.assertEqual(output['edited']['holes'], 2)
            self.assertEqual(output['initial']['thicknessMm'], 8)
            self.assertEqual(output['edited']['thicknessMm'], 12)
            self.assertAlmostEqual(output['initial']['volumeMm3'],
                                   74990.44263153228, places=5)
            self.assertAlmostEqual(output['edited']['volumeMm3'],
                                   112485.66394729842, places=5)
            step = output['initial']['step']
            self.assertEqual(step['path'], str(destination))
            self.assertEqual(step['verification'], 'same_engine_step_readback')
            self.assertEqual(step['sha256'],
                             hashlib.sha256(destination.read_bytes()).hexdigest())
            # Repeating against the same destination must fail, not overwrite.
            retry = subprocess.run(
                ['node', 'native/examples/local-plate-demo.mjs', str(destination), '12'],
                cwd=ROOT, capture_output=True, text=True, env=env, timeout=90,
            )
            self.assertNotEqual(retry.returncode, 0)
            self.assertEqual(step['sha256'],
                             hashlib.sha256(destination.read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
