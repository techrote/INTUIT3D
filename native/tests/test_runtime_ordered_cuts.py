"""Executable real INTENT/SKETCH -> two ordered OCP Booleans -> STEP -> edit.
This is OCP 7.9.3.1 experimental evidence, not pinned OCCT8 C++ or external CAD.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
DEMO=ROOT/'packages/kernel-contract/examples/runtime-ordered-cuts-native.mjs'

class RuntimeOrderedCutsPhysicalTest(unittest.TestCase):
    def test_two_authored_cut_features_blind_pocket_and_retroactive_edit(self):
        with tempfile.TemporaryDirectory(prefix='intuit3d-ordered-cut-') as folder:
            env=dict(os.environ,INTUIT3D_OCP_PYTHON=os.environ.get(
                'INTUIT3D_OCP_PYTHON',sys.executable))
            p=subprocess.run(['node',str(DEMO),folder],cwd=ROOT,env=env,
                capture_output=True,text=True,timeout=120)
            self.assertEqual(p.returncode,0,p.stdout[-2000:]+p.stderr[-3000:])
            root=Path(folder)
            m=json.loads((root/'manifest.json').read_text())
            self.assertEqual(m['provider'],'real-experimental-OCP-7.9.3.1')
            self.assertFalse(m['exactAuthority'])
            self.assertFalse(m['independentCadInterop'])
            self.assertFalse(m['pinnedOcct8Cxx'])
            self.assertEqual(m['bodyId'],'body.bracket')
            self.assertEqual(m['independentBodyId'],'body.spacer')
            self.assertIn('extrude.bracket',m['invalidated'])
            self.assertIn('cut.slot',m['invalidated'])
            self.assertIn('cut.pocket',m['invalidated'])
            self.assertNotIn('extrude.spacer',m['invalidated'])
            records=m['generated']
            self.assertEqual([r['cutDepths'] for r in records],[[8,3],[12,3]])
            self.assertEqual([r['label'] for r in records],['initial-8mm','edited-12mm'])
            self.assertNotEqual(records[0]['sha256'],records[1]['sha256'])
            for record,expected in zip(records,[33825,51225]):
                self.assertAlmostEqual(record['volumeMm3'],expected,delta=1e-6)
                data=(root/(record['label']+'.step')).read_bytes()
                self.assertTrue(data.startswith(b'ISO-10303-21;'))
                self.assertGreater(len(data),1000)
                self.assertEqual(len(data),record['bytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(),record['sha256'])
            self.assertIn('history',json.loads((root/'history.json').read_text()))
if __name__=='__main__':
    unittest.main()
