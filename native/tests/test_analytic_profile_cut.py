"""Real experimental OCP separate FEATUREOPS cut on L bracket, retrospective edit."""
import hashlib
import math
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analytic_profile_cut import execute, SCHEMA


def profile(feature, coords, thickness, *, holes=()):
    boundary = []
    area = 0
    for i, (x, y) in enumerate(coords):
        nx, ny = coords[(i + 1) % len(coords)]
        boundary.append({'id': f'edge{i}', 'kind': 'line',
                         'start': {'x': x, 'y': y}, 'end': {'x': nx, 'y': ny}})
        area += (x * ny - nx * y) / 2
    hole_area = sum(math.pi * r*r for x, y, r in holes)
    return {'protocol': 'intuit3d/kernel/arc-extrude-v1', 'requestId':feature+'.source',
            'featureId':feature, 'revision':7, 'units':'mm',
            'thicknessMm':thickness, 'exportStep':False,
            'profile': {'format':'intuit3d.analytic-arc-profile','version':1,
                        'id':feature,'units':'mm',
                        'status':'analytic_2d_validated_pending_native',
                        'sourceSignature':'sketch.'+feature,
                        'providerSubmissionReady':True, 'globalSelfIntersectionChecked':True,
                        'holeContainmentChecked':True, 'nativeProfileAdmissible':False,
                        'stepQualified':False, 'boundary':boundary,
                        'holes':[{'id':f'hole{i}', 'centerId':f'center{i}',
                                  'x':x,'y':y,'radiusMm':r} for i,(x,y,r) in enumerate(holes)],
                        'signedBoundaryAreaMm2':area,'materialAreaMm2':area-hole_area}}

L=[(-80,-50),(80,-50),(80,-10),(10,-10),(10,50),(-80,50)]

def cut_request(thickness=8, cut_width=16, cut_center=-34):
    base=profile('extrude.bracket',L,thickness,holes=[(-50,0,6)])
    x=cut_center;w=cut_width/2
    cutter=profile('tool.window',[(x-w,-34),(x+w,-34),(x+w,-22),(x-w,-22)],thickness)
    return {'protocol':SCHEMA,'requestId':'cut.window', 'cutFeatureId':'cut.window',
            'targetBodyId':'body.bracket','revision':7,'units':'mm',
            'baseExtrude':base,'cutTool':cutter,'exportStep':True}

class ActualSeparateCutTest(unittest.TestCase):
    def test_real_l_shape_explicit_boolean_cut_8_to_14_then_resize(self):
        with tempfile.TemporaryDirectory() as folder:
            digests=[]; volumes=[]
            for i,(thickness,width) in enumerate([(8,16),(14,16),(14,22)]):
                q=cut_request(thickness,width)
                dest=Path(folder)/f'cut-{i}.step'
                r=execute(q,dest)
                expected=(11800-math.pi*36-width*12)*thickness
                self.assertEqual(r['status'],'experimental_body_cut_brep')
                self.assertFalse(r['exactAuthority'])
                self.assertFalse(r['independentInteroperability'])
                self.assertEqual(r['targetBodyId'],'body.bracket')
                self.assertEqual(r['source']['solidCount'],1)
                self.assertEqual(r['stepReadback']['solidCount'],1)
                self.assertAlmostEqual(r['source']['volumeMm3'],expected,places=5)
                self.assertAlmostEqual(r['stepReadback']['volumeMm3'],expected,places=5)
                raw=dest.read_bytes()
                self.assertGreater(len(raw),1024)
                self.assertEqual(r['artifact']['sha256'],hashlib.sha256(raw).hexdigest())
                volumes.append(r['source']['volumeMm3'])
                digests.append(r['artifact']['sha256'])
            self.assertGreater(volumes[1],volumes[0])
            self.assertLess(volumes[2],volumes[1])
            self.assertEqual(len(set(digests)),3)

    def test_external_or_overlapping_tool_is_refused_without_step(self):
        with tempfile.TemporaryDirectory() as folder:
            q=cut_request(cut_center=82)
            dest=Path(folder)/'outside.step'
            with self.assertRaises(ValueError):execute(q,dest)
            self.assertFalse(dest.exists())
            q=cut_request()
            q['cutTool']['revision']=8
            with self.assertRaises(ValueError):execute(q,dest)
            self.assertFalse(dest.exists())

    def test_exclusive_step_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            dest=Path(folder)/'keep.step';dest.write_bytes(b'previous export')
            with self.assertRaises(ValueError):execute(cut_request(),dest)
            self.assertEqual(dest.read_bytes(),b'previous export')

if __name__=='__main__':
    unittest.main()
