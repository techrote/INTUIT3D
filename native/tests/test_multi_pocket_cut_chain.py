"""Physical two-operation bracket STEP with independent per-feature mass receipts."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'native'))
from analytic_profile_cut import execute_chain


class CutChainPhysicalTest(unittest.TestCase):
    def test_real_node_provider_reopen_rebuild_and_step(self):
        demo = ROOT / 'packages/kernel-contract/examples/multi-pocket-cut-native.mjs'
        with tempfile.TemporaryDirectory(prefix='intuit3d-two-cuts-') as folder:
            env = dict(os.environ, INTUIT3D_OCP_PYTHON=os.environ.get(
                'INTUIT3D_OCP_PYTHON', sys.executable))
            proc = subprocess.run(['node', str(demo), folder], cwd=ROOT, env=env,
                                  capture_output=True, text=True, timeout=120)
            self.assertEqual(proc.returncode, 0, proc.stdout[-2000:] + proc.stderr[-3000:])
            manifest = json.loads((Path(folder) / 'manifest.json').read_text())
            self.assertEqual(manifest['evidence'],
                             'real-OCP-7.9.3.1-physical-cut-chain-same-engine-STEP')
            self.assertFalse(manifest['pinnedOCCT8Cxx'])
            self.assertFalse(manifest['independentExternalCad'])
            cases = manifest['results']
            self.assertEqual([r['thicknessMm'] for r in cases], [8, 12])
            self.assertEqual([r['blindPocketMm'] for r in cases], [3, 5])
            self.assertEqual(cases[0]['bodyId'], cases[1]['bodyId'])
            self.assertNotEqual(cases[0]['stepSha256'], cases[1]['stepSha256'])
            for case in cases:
                volume = ((11800 - math.pi * 36) * case['thicknessMm']
                          - (240 + math.pi * 36) * case['blindPocketMm']
                          - 400 * case['thicknessMm'])
                self.assertAlmostEqual(case['volumeMm3'], volume, places=5)
                self.assertEqual([c['kind'] for c in case['cuts']],
                                 ['blind_pocket', 'through'])
                step = (Path(folder) / f"{case['thicknessMm']}mm.step").read_bytes()
                self.assertTrue(step.startswith(b'ISO-10303-21;'))
                self.assertGreater(len(step), 1000)
                self.assertEqual(hashlib.sha256(step).hexdigest(), case['stepSha256'])
                self.assertEqual(len(step), case['stepBytes'])
            # Reused/overlapping cut region is a real material error, not a
            # topology micro-residual: the second cut fails to remove its own
            # declared full area and must not produce a false STEP success.
            bad = json.loads((Path(folder) / '8mm-request.json').read_text())
            cut = bad['cuts'][1]
            cut['cutTool']['profile'] = copy.deepcopy(
                bad['cuts'][0]['cutTool']['profile'])
            cut['cutTool']['profile']['id'] = 'overlapping.window'
            cut['cutTool']['profile']['sourceSignature'] = 'sketch.overlap'
            with self.assertRaisesRegex(ValueError, 'full analytic material not removed'):
                execute_chain(bad, Path(folder) / 'rejected.step')
            self.assertFalse((Path(folder) / 'rejected.step').exists())


if __name__ == '__main__':
    unittest.main()
