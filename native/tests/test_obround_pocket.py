"""True B-rep obround mounting slot with adjustable blind/through pocket depth."""
import hashlib
import math
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analytic_profile_cut import execute, POCKET_SCHEMA
from test_analytic_profile_cut import cut_request

def pocket_request(depth, thickness=8):
    request=cut_request(thickness)
    request['protocol']=POCKET_SCHEMA
    request['cutDepthMm']=depth
    r=6
    x0,x1,y=-36,-16,-30
    boundary=[
        {'id':'slot.lower','kind':'line',
         'start':{'x':x0,'y':y-r},'end':{'x':x1,'y':y-r}},
        {'id':'slot.right','kind':'arc',
         'start':{'x':x1,'y':y-r},'end':{'x':x1,'y':y+r},
         'center':{'x':x1,'y':y},'radiusMm':r,
         'startAngleRad':-math.pi/2,'sweepRad':math.pi},
        {'id':'slot.upper','kind':'line',
         'start':{'x':x1,'y':y+r},'end':{'x':x0,'y':y+r}},
        {'id':'slot.left','kind':'arc',
         'start':{'x':x0,'y':y+r},'end':{'x':x0,'y':y-r},
         'center':{'x':x0,'y':y},'radiusMm':r,
         'startAngleRad':math.pi/2,'sweepRad':math.pi}
    ]
    area=20*12+math.pi*r*r
    p=request['cutTool']['profile']
    p['boundary']=boundary
    p['signedBoundaryAreaMm2']=area
    p['materialAreaMm2']=area
    return request

class ObroundPocketBrepTest(unittest.TestCase):
    def test_real_blind_and_through_slot_step_readback(self):
        with tempfile.TemporaryDirectory() as tmp:
            digests=[]
            for depth in (3,8):
                request=pocket_request(depth)
                step=Path(tmp)/f'slot-{depth}mm.step'
                result=execute(request,step)
                expected=(11800-math.pi*36)*8-(240+math.pi*36)*depth
                self.assertEqual(result['protocol'],POCKET_SCHEMA)
                self.assertEqual(result['cutKind'],
                                 'blind_pocket' if depth<8 else 'through')
                self.assertEqual(result['targetBodyId'],'body.bracket')
                self.assertEqual(result['source']['solidCount'],1)
                self.assertEqual(result['stepReadback']['solidCount'],1)
                self.assertAlmostEqual(result['source']['volumeMm3'],expected,places=5)
                self.assertAlmostEqual(result['stepReadback']['volumeMm3'],expected,places=5)
                self.assertAlmostEqual(result['removedVolumeMm3'],
                                       (240+math.pi*36)*depth,places=5)
                contents=step.read_bytes()
                self.assertTrue(contents.startswith(b'ISO-10303-21;'))
                self.assertEqual(hashlib.sha256(contents).hexdigest(),
                                 result['artifact']['sha256'])
                self.assertFalse(result['exactAuthority'])
                self.assertFalse(result['independentInteroperability'])
                digests.append(result['artifact']['sha256'])
            self.assertNotEqual(digests[0],digests[1])

    def test_unusable_depth_and_output_collision_fail_without_publication(self):
        with tempfile.TemporaryDirectory() as tmp:
            step=Path(tmp)/'pocket.step'
            for depth in (0,-1,9,float('nan'),True):
                with self.subTest(depth=depth):
                    with self.assertRaises(ValueError):
                        execute(pocket_request(depth),step)
                    self.assertFalse(step.exists())
            step.write_bytes(b'original')
            with self.assertRaises(ValueError):
                execute(pocket_request(3),step)
            self.assertEqual(step.read_bytes(),b'original')

if __name__=='__main__':
    unittest.main()
