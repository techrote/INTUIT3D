"""Executed OCP line/arc B-rep + STEP regressions, not pinned C++ or independent CAD."""
import copy
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from analytic_profile_extrude import execute, SCHEMA


def rounded_plate(width=120,depth=80,radius=8,thickness=8,hole_radius=6):
    x=width/2;y=depth/2;r=radius
    points=[(-x+r,-y),(x-r,-y),(x,-y+r),(x,y-r),
            (x-r,y),(-x+r,y),(-x,y-r),(-x,-y+r)]
    centers=[(x-r,-y+r),(x-r,y-r),(-x+r,y-r),(-x+r,-y+r)]
    curves=[]
    for i in range(8):
        a=points[i];b=points[(i+1)%8]
        c={'kind':'line' if i%2==0 else 'arc',
           'id':f'profile:curve{i}', 'start':dict(zip(('x','y'),a)),
           'end':dict(zip(('x','y'),b))}
        if i%2:
            j=(i-1)//2
            c.update(center=dict(zip(('x','y'),centers[j])),radiusMm=r,
                     startAngleRad=-math.pi/2+j*math.pi/2,sweepRad=math.pi/2)
        curves.append(c)
    holes=[{'id':'holeA','centerId':'p.holeA','x':-30,'y':0,'radiusMm':hole_radius},
           {'id':'holeB','centerId':'p.holeB','x':30,'y':0,'radiusMm':6}]
    bound_area=width*depth-(4-math.pi)*radius**2
    p={'format':'intuit3d.analytic-arc-profile','version':1,'id':'plate:outer',
       'units':'mm','status':'analytic_2d_validated_pending_native',
       'sourceSignature':'solved-profile-revision',
       'boundary':curves,'holes':holes,
       'signedBoundaryAreaMm2':bound_area,
       'materialAreaMm2':bound_area-math.pi*(hole_radius**2+36),
       'providerSubmissionReady':True,'globalSelfIntersectionChecked':True,
       'holeContainmentChecked':True,'nativeProfileAdmissible':False,
       'exactBrepAvailable':False,'stepQualified':False,
       'numericalPolicy':{'contactUncertaintyMm':1e-6,
         'action':'reject_ambiguous_contact_no_geometry_healing'}}
    return {'protocol':SCHEMA,'requestId':'plate.arc.profile','featureId':'feature.extrude',
      'revision':8,'units':'mm','thicknessMm':thickness,'profile':p,'exportStep':True}


class ArcExtrusionTests(unittest.TestCase):
    def test_real_roundtrip_8_to_12_and_edited_arc_radius(self):
        with tempfile.TemporaryDirectory() as d:
            records=[]
            for i, dims in enumerate([(120,80,8,8,6),(120,80,8,12,6),(150,80,14,12,7)]):
                req=rounded_plate(*dims)
                req['revision']=8+i
                req['requestId']=f'plate.arc.revision{i}'
                path=Path(d)/f'plate-{i}.step'
                result=execute(req,path)
                self.assertEqual(result['status'],'experimental_brep')
                self.assertFalse(result['exactAuthority'])
                self.assertFalse(result['independentInteroperability'])
                self.assertTrue(result['source']['valid'])
                self.assertEqual(result['source']['solidCount'],1)
                self.assertEqual(result['source']['cylindricalFaceCount'],6)
                self.assertEqual(result['stepReadback']['solidCount'],1)
                self.assertEqual(result['sourceSignature'],req['profile']['sourceSignature'])
                self.assertEqual(result['artifact']['sha256'],hashlib.sha256(path.read_bytes()).hexdigest())
                self.assertGreater(path.stat().st_size,1000)
                records.append((result,path.read_bytes()))
            self.assertNotEqual(records[0][1],records[1][1])
            self.assertLess(records[0][0]['source']['volumeMm3'],records[1][0]['source']['volumeMm3'])
            self.assertGreater(records[2][0]['source']['volumeMm3'],records[1][0]['source']['volumeMm3'])

    def test_broken_profile_and_unsupported_geometry_fail_without_step(self):
        with tempfile.TemporaryDirectory() as d:
            req=rounded_plate()
            for label, mutation in [
                ('area',lambda q:q['profile'].update(materialAreaMm2=100)),
                ('gap',lambda q:q['profile']['boundary'][3]['start'].update(y=0)),
                ('end',lambda q:q['profile']['boundary'][1].update(sweepRad=1.4)),
                ('units',lambda q:q.update(units='inch')),
                ('draft',lambda q:q['profile'].update(providerSubmissionReady=False))]:
                with self.subTest(label=label):
                    altered=copy.deepcopy(req);mutation(altered)
                    path=Path(d)/f'{label}.step'
                    with self.assertRaises(ValueError):execute(altered,path)
                    self.assertFalse(path.exists())

    def test_exclusive_publication_and_native_subprocess(self):
        with tempfile.TemporaryDirectory() as d:
            req=rounded_plate()
            path=Path(d)/'plate.step'
            command=[sys.executable,str(Path(__file__).resolve().parents[1]/'analytic_profile_extrude.py'),
                     '--step-output',str(path)]
            p=subprocess.run(command,input=json.dumps(req),capture_output=True,text=True,timeout=30)
            self.assertEqual(p.returncode,0,p.stdout+p.stderr)
            result=json.loads(p.stdout)
            self.assertEqual(result['status'],'experimental_brep')
            original=path.read_bytes()
            again=subprocess.run(command,input=json.dumps(req),capture_output=True,text=True,timeout=30)
            self.assertEqual(again.returncode,2)
            self.assertEqual(json.loads(again.stdout)['status'],'requires_reconciliation')
            self.assertEqual(path.read_bytes(),original)

if __name__=='__main__': unittest.main()
