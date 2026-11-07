"""End-to-end Node -> isolated experimental OCP -> two physical STEP pockets."""
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
DEMO=ROOT/'packages/kernel-contract/examples/obround-pocket-native.mjs'

@unittest.skipUnless(shutil.which('node'), 'Node 22 unavailable')
class NodeObroundPocketPhysicalTest(unittest.TestCase):
    def test_slot_blind_and_through_cut_step_artifacts(self):
        with tempfile.TemporaryDirectory(prefix='intuit3d-slot-pocket-') as folder:
            env=dict(os.environ,INTUIT3D_OCP_PYTHON=os.environ.get(
                'INTUIT3D_OCP_PYTHON',sys.executable))
            finished=subprocess.run(['node',str(DEMO),folder],cwd=ROOT,
                env=env,capture_output=True,text=True,timeout=120,check=False)
            self.assertEqual(finished.returncode,0,
                finished.stdout[-2000:]+finished.stderr[-2500:])
            manifest=json.loads((Path(folder)/'manifest.json').read_text())
            self.assertEqual(manifest['evidence'],
                'actual-experimental-OCP-7.9.3.1-BRep-and-same-engine-STEP')
            self.assertFalse(manifest['pinnedOCCT8Cxx'])
            self.assertFalse(manifest['independentExternalCad'])
            records=manifest['results']
            self.assertEqual([row['depthMm'] for row in records],[3,8])
            self.assertEqual([row['kind'] for row in records],
                ['blind_pocket','through'])
            self.assertEqual(records[0]['bodyId'],records[1]['bodyId'])
            self.assertNotEqual(records[0]['stepSha256'],records[1]['stepSha256'])
            for record in records:
                depth=record['depthMm']
                expected=(11800-math.pi*36)*8-(240+math.pi*36)*depth
                self.assertAlmostEqual(record['volumeMm3'],expected,delta=1e-6)
                data=(Path(folder)/f'{depth}mm.step').read_bytes()
                self.assertGreater(len(data),1000)
                self.assertTrue(data.startswith(b'ISO-10303-21;'))
                self.assertEqual(record['stepBytes'],len(data))
                self.assertEqual(record['stepSha256'],
                    hashlib.sha256(data).hexdigest())

if __name__=='__main__':
    unittest.main()
