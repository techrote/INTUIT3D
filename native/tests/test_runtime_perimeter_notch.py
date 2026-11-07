"""End-to-end authoritative saved CAD history -> true OCP edge cut -> STEP.

Executed in the Linux native CI stage with the experimental pinned OCP venv.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
DEMO=ROOT/'packages/kernel-contract/examples/runtime-perimeter-notch-native.mjs'


class NativeRuntimeNotchTest(unittest.TestCase):
    def test_real_saved_sketch_feature_cut_edit_reopen_and_step(self):
        with tempfile.TemporaryDirectory(prefix='intuit3d-runtime-notch-') as folder:
            env=dict(os.environ,INTUIT3D_OCP_PYTHON=os.environ.get(
                'INTUIT3D_OCP_PYTHON',sys.executable))
            p=subprocess.run(['node',str(DEMO),folder],cwd=ROOT,env=env,
                capture_output=True,text=True,timeout=120)
            self.assertEqual(p.returncode,0,p.stdout[-2000:]+p.stderr[-3000:])
            root=Path(folder)
            m=json.loads((root/'manifest.json').read_text())
            self.assertEqual(m['execution'],'real-authored-runtime-edge-notch-OCP-7.9.3.1')
            self.assertFalse(m['qualifiedOCCT8Cxx'])
            self.assertFalse(m['independentCadInterop'])
            changes=m['invalidation']['invalidatedFeatureIds']
            self.assertIn('extrude.plate',changes)
            self.assertIn('cut.notch',changes)
            self.assertNotIn('sketch.notch',changes)
            records=m['results']
            self.assertEqual([r['thicknessMm'] for r in records],[8,12])
            self.assertEqual(len({r['bodyId'] for r in records}),1)
            self.assertNotEqual(records[0]['stepSha256'],records[1]['stepSha256'])
            for record in records:
                wanted=(9600-2*math.pi*36-200)*record['thicknessMm']
                self.assertAlmostEqual(record['volumeMm3'],wanted,delta=1e-6)
                data=(root/(record['label']+'.step')).read_bytes()
                self.assertTrue(data.startswith(b'ISO-10303-21;'))
                self.assertGreater(len(data),1000)
                self.assertEqual(len(data),record['stepBytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(),record['stepSha256'])
            self.assertIn('history',json.loads((root/'history.json').read_text()))


if __name__=='__main__':
    unittest.main()
