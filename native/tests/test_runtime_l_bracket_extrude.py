"""Executed native nonrectangular RUNTIME profile extrusion: real OCP/STEP.

This tests actual six-sided L geometry already supported by the analytic
line/arc worker, rather than creating another native geometry implementation.
No pinned OCCT 8.0.1 C++ or independent external CAD is claimed.
"""
import hashlib
import math
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from analytic_profile_extrude import execute,SCHEMA


def l_bracket(depth=8):
    coords=[(-80,-50),(80,-50),(80,-10),(10,-10),(10,50),(-80,50)]
    lines=[]
    for i,(x,y) in enumerate(coords):
        nx,ny=coords[(i+1)%len(coords)]
        lines.append({'id':f'edge{i}','kind':'line',
                      'start':{'x':x,'y':y},'end':{'x':nx,'y':ny}})
    outer=11800.0
    return {'protocol':SCHEMA,'requestId':'l.bracket.depth',
        'featureId':'extrude.bracket','revision':5,'units':'mm',
        'thicknessMm':depth,'exportStep':True,
        'profile':{'format':'intuit3d.analytic-arc-profile','version':1,
           'id':'extrude.bracket','units':'mm',
           'status':'analytic_2d_validated_pending_native',
           'sourceSignature':'runtime-admitted-sketch-signature',
           'providerSubmissionReady':True,'globalSelfIntersectionChecked':True,
           'holeContainmentChecked':True,'nativeProfileAdmissible':False,
           'stepQualified':False,'boundary':lines,
           'holes':[{'id':'bolt.circle','centerId':'bolt.center',
                     'x':-50,'y':0,'radiusMm':6}],
           'signedBoundaryAreaMm2':outer,
           'materialAreaMm2':outer-math.pi*36}}


class GeneralProfileSolidTests(unittest.TestCase):
    def test_l_bracket_8_to_14_mm_real_brep_and_step(self):
        with tempfile.TemporaryDirectory() as folder:
            volumes=[];digests=[]
            for i,depth in enumerate((8,14)):
                request=l_bracket(depth)
                request['revision']=5+i
                target=Path(folder)/f'bracket-{depth}.step'
                result=execute(request,target)
                self.assertEqual(result['status'],'experimental_brep')
                self.assertFalse(result['exactAuthority'])
                self.assertFalse(result['independentInteroperability'])
                self.assertTrue(result['source']['valid'])
                self.assertEqual(result['source']['solidCount'],1)
                self.assertEqual(result['source']['cylindricalFaceCount'],1)
                self.assertEqual(result['stepReadback']['solidCount'],1)
                volume=(11800-math.pi*36)*depth
                self.assertAlmostEqual(result['source']['volumeMm3'],volume,places=5)
                self.assertAlmostEqual(result['stepReadback']['volumeMm3'],volume,places=5)
                digest=hashlib.sha256(target.read_bytes()).hexdigest()
                self.assertEqual(result['artifact']['sha256'],digest)
                self.assertGreater(target.stat().st_size,1024)
                volumes.append(result['source']['volumeMm3']);digests.append(digest)
            self.assertGreater(volumes[1],volumes[0])
            self.assertNotEqual(digests[0],digests[1])

    def test_reject_mismatched_area_without_step_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            q=l_bracket();q['profile']['materialAreaMm2']=1
            path=Path(folder)/'invalid.step'
            with self.assertRaises(ValueError):
                execute(q,path)
            self.assertFalse(path.exists())

if __name__=='__main__':
    unittest.main()
