"""Real two-hole plate edge-notch STEP, including retrospective width editing.

Independent rectangle intersection math is checked against genuine B-rep and
OCP same-engine STEP. Not pinned C++ or external-CAD interoperability.
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


class PerimeterNotchNativeTest(unittest.TestCase):
    def test_real_node_native_notch_and_revised_width(self):
        with tempfile.TemporaryDirectory(prefix='intuit3d-notch-') as folder:
            env=dict(os.environ,INTUIT3D_OCP_PYTHON=os.environ.get(
                'INTUIT3D_OCP_PYTHON',sys.executable))
            p=subprocess.run(['node',str(ROOT/'packages/kernel-contract/examples/perimeter-notch-native.mjs'),folder],
                cwd=ROOT,env=env,capture_output=True,text=True,timeout=120)
            self.assertEqual(p.returncode,0,p.stdout[-2000:]+p.stderr[-3000:])
            root=Path(folder)
            manifest=json.loads((root/'manifest.json').read_text())
            self.assertEqual(manifest['execution'],
                             'real-OCP-7.9.3.1-experimental-perimeter-notch')
            self.assertFalse(manifest['qualifiedOCCT8Cxx'])
            self.assertFalse(manifest['independentCadInterop'])
            records=manifest['results']
            self.assertEqual([(v['plateWidthMm'],v['pocketDepthMm']) for v in records],
                             [(120,8),(130,8),(120,3)])
            self.assertEqual([v['footprintIntersectionMm2'] for v in records],
                             [200,300,200])
            self.assertEqual(len({r['bodyId'] for r in records}),1)
            self.assertEqual(len({r['stepSha256'] for r in records}),3)
            for r in records:
                expected=(r['plateWidthMm']*80-2*math.pi*36)*8-(
                    r['footprintIntersectionMm2']*r['pocketDepthMm'])
                self.assertAlmostEqual(r['volumeMm3'],expected,delta=1e-5)
                data=(root/(r['label']+'.step')).read_bytes()
                self.assertTrue(data.startswith(b'ISO-10303-21;'))
                self.assertGreater(len(data),1000)
                self.assertEqual(len(data),r['stepBytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(),r['stepSha256'])
            self.assertTrue((root/'120mm-8mm.request.json').exists())
            # Material old-provider failure: the whole cutter exceeds the
            # plate, so v2 incorrectly expects its entire volume removed.
            sys.path.insert(0,str(ROOT/'native'))
            from analytic_profile_cut import execute
            original=json.loads((root/'120mm-8mm.request.json').read_text())
            original['protocol']='intuit3d/kernel/profile-body-cut-v2'
            rejected=root/'legacy-incorrect.step'
            with self.assertRaisesRegex(ValueError,'full intended area'):
                execute(original,rejected)
            self.assertFalse(rejected.exists())
            # A tool completely outside the body must never publish STEP.
            outside=json.loads((root/'120mm-8mm.request.json').read_text())
            for edge in outside['cutTool']['profile']['boundary']:
                edge['start']['x']+=100
                edge['end']['x']+=100
            rejected=root/'outside.step'
            with self.assertRaisesRegex(ValueError,'partially cross plate perimeter'):
                execute(outside,rejected)
            self.assertFalse(rejected.exists())


if __name__=='__main__':
    unittest.main()
