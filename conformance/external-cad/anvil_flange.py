#!/usr/bin/env python3
"""Execute the independent Rust AnvilCAD STEP reader on real immutable flange STEP bytes.

This is a distinct non-OCCT fallback, NOT a reinterpretation of BRL-CAD failure.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys

from brlcad_flange import digest, extract_verified, fixture_manifest, NotQualified, sample_rays

def qualify(args):
    if args.output_dir.exists():
        raise NotQualified('AnvilCAD evidence directory already exists')
    args.output_dir.mkdir(parents=True)
    report = {'schema':'intuit3d.anvilcad-independent-step/v1',
              'status':'BLOCKED_OR_REJECTED','independentCadInteroperability':False,
              'provider':'AnvilCAD anvil-step / independent Rust STEP B-rep and mesh importer',
              'pinnedSourceGitCommit': args.source_sha,
              'probeSha256':digest(args.probe),'cases':[]}
    try:
        cases=extract_verified(args.bundle,args.output_dir,fixture_manifest())
        for case in cases:
            holes=';'.join(f"{h['x']},{h['y']},{h['radius']}" for h in case['holes'])
            command=[str(args.probe.resolve()), str((args.output_dir/case['filename']).resolve()),
                     str(case['widthMm']),str(case['depthMm']),str(case['thicknessMm']),holes]
            try:
                proc=subprocess.run(command,text=True,capture_output=True,timeout=args.timeout,
                                    encoding='utf-8',errors='replace',check=False)
            except subprocess.TimeoutExpired as exc:
                raise NotQualified('AnvilCAD probe timed out: '+case['filename']) from exc
            log=args.output_dir/(case['filename']+'.anvil.log')
            log.write_text('COMMAND: '+json.dumps(command)+'\nEXIT: '+str(proc.returncode)+
                           '\n[stdout]\n'+proc.stdout+'\n[stderr]\n'+proc.stderr)
            if proc.returncode!=0:
                raise NotQualified(f"AnvilCAD returned {proc.returncode}: {case['filename']} (see {log.name})")
            lines=proc.stdout.splitlines()
            accepts=[x for x in lines if x.startswith('ACCEPT ')]
            if len(accepts)!=1:
                raise NotQualified('AnvilCAD did not print exactly one physical acceptance receipt')
            result=dict(t.split('=',1) for t in accepts[0].split()[1:])
            if (result.get('solids')!='1' or result.get('source_unit') not in ('millimetre','millimeter')
                or result.get('open_edges')!='0'):
                raise NotQualified('AnvilCAD receipt did not confirm one closed mm unit solid')
            measured=float(result['volume_mm3'])
            expected=float(result['expected_mm3'])
            theoretical=(case['widthMm']*case['depthMm']-
                         sum(math.pi*h['radius']**2 for h in case['holes']))*case['thicknessMm']
            if (not math.isfinite(measured) or not math.isfinite(expected) or theoretical<=0
                or abs(expected-theoretical)>1e-5 or abs(measured-theoretical)>theoretical*.01):
                raise NotQualified('AnvilCAD independently reconstructed wrong plate volume')
            rows=[x.split() for x in lines if x.startswith('RAY ')]
            probes=sample_rays(case)
            if len(rows)!=len(probes):
                raise NotQualified('AnvilCAD did not execute all independently specified physical rays')
            observations=[]
            for row,(name,x,y,z,kind) in zip(rows,probes):
                if len(row)!=7 or row[1]!=name:
                    raise NotQualified('AnvilCAD ray evidence missing or out of sequence')
                rx,ry=float(row[2]),float(row[3]); n=int(row[4])
                low,high=float(row[5]),float(row[6])
                if abs(rx-x)>1e-7 or abs(ry-y)>1e-7 or n!=(2 if kind=='solid' else 0):
                    raise NotQualified('AnvilCAD ray coordinate or occupancy mismatch: '+name)
                if kind=='solid' and (abs(low)>0.05 or abs(high-case['thicknessMm'])>0.05):
                    raise NotQualified('AnvilCAD misplaced material thickness or Z origin: '+name)
                observations.append({'probe':name,'xMm':rx,'yMm':ry,'hitCount':n,
                                     'entryZMm':low if n else None,'exitZMm':high if n else None})
            report['cases'].append({'filename':case['filename'],'sourceSha256':digest(args.output_dir/case['filename']),
                'measuredTriangleVolumeMm3':measured,'expectedAnalyticVolumeMm3':theoretical,
                'relativeVolumeError':abs(measured-theoretical)/theoretical,
                'importedExactBRep':result.get('imported_exact')=='true',
                'triangleCount':int(result['tris']),'oneSolid':True,'watertight':True,
                'rays':observations,'rawExecutionSha256':digest(log)})
        # Explicit post-edit and undo checks are based on actually imported CAD receipts.
        observations=report['cases']
        if not (observations[1]['measuredTriangleVolumeMm3']>observations[0]['measuredTriangleVolumeMm3']
                and observations[2]['measuredTriangleVolumeMm3']<observations[1]['measuredTriangleVolumeMm3']
                and abs(observations[3]['measuredTriangleVolumeMm3']-
                        observations[1]['measuredTriangleVolumeMm3'])<=observations[1]['measuredTriangleVolumeMm3']*.01):
            raise NotQualified('Independent post-edit thickness/add-hole/undo changes were not recovered')
        report['status']='NON_OCCT_ANVILCAD_SAMPLED_GEOMETRY_ACCEPTED'
        report['independentCadInteroperability']=True
        return 0
    except (OSError,ValueError,KeyError,NotQualified) as e:
        report['error']=str(e)
        return 3
    finally:
        (args.output_dir/'qualification.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
        print(json.dumps({'status':report['status'],'evidence':str(args.output_dir/'qualification.json'),
                          'error':report.get('error')},sort_keys=True))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--bundle',required=True,type=Path)
    p.add_argument('--output-dir',required=True,type=Path)
    p.add_argument('--probe',required=True,type=Path)
    p.add_argument('--source-sha',required=True)
    p.add_argument('--timeout',type=float,default=90)
    args=p.parse_args()
    sys.exit(qualify(args))
