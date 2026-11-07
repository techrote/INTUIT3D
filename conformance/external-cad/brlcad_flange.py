#!/usr/bin/env python3
"""Fail-closed independent STEP import and ray geometry acceptance using BRL-CAD.

Strictly requires an installed, non-OCCT BRL-CAD STEP importer and ray engine.
The built-in bundle check is not external CAD acceptance.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

HERE = Path(__file__).resolve().parent
FLOAT = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"
PARTITION = re.compile(rf"^\s*(?!Origin\b|Direction\b)(\S+)\s+\(\s*{FLOAT}\s+{FLOAT}\s+{FLOAT}\s*\)\s+({FLOAT})(?:\s|$)", re.M)
VOLUME = re.compile(rf"^\s*(\S+)\s+({FLOAT})\s+mm\^3\s*$", re.M | re.I)
MISS = re.compile(r"\b(?:miss(?:ed)?(?: the target)?|no (?:hits?|intersections?|partitions?))\b", re.I)
MAX_STEP = 2 * 1024 * 1024

class NotQualified(RuntimeError):
    pass

def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(262144), b''):
            h.update(chunk)
    return h.hexdigest()

def fixture_manifest(path=HERE / 'flange-cases.json'):
    d = json.loads(Path(path).read_text())
    if d.get('schema') != 'intuit3d.external-cad-flange/v1' or len(d.get('cases', [])) != 4:
        raise NotQualified('Unexpected or incomplete independent flange fixture manifest')
    return d

def extract_verified(bundle: Path, directory: Path, manifest: dict) -> list[dict]:
    if not bundle.is_file():
        raise NotQualified(f'Expected real CI artifact ZIP is missing: {bundle}')
    cases = manifest['cases']
    required = [c['filename'] for c in cases]
    if len(set(required)) != len(required):
        raise NotQualified('Duplicate manifest STEP names')
    try:
        with zipfile.ZipFile(bundle) as z:
            names = z.namelist()
            if len(names) != len(set(names)):
                raise NotQualified('ZIP has duplicate archive entries')
            for name in names:
                if name.startswith('/') or '..' in Path(name).parts or '\\' in name:
                    raise NotQualified('Unsafe ZIP member path')
            for c in cases:
                name = c['filename']
                if name not in names:
                    raise NotQualified(f'Missing real STEP fixture {name}')
                info = z.getinfo(name)
                if info.file_size != c['bytes'] or info.file_size > MAX_STEP:
                    raise NotQualified(f'Wrong real STEP fixture size: {name}')
                # Read bounded actual input; no unchecked ZipFile.extract() path traversal.
                data = z.read(name)
                if hashlib.sha256(data).hexdigest() != c['sha256']:
                    raise NotQualified(f'STEP SHA-256 mismatch: {name}')
                if not data.startswith(b'ISO-10303-21;') or b'END-ISO-10303-21;' not in data[-100:]:
                    raise NotQualified(f'Not a complete STEP Part 21 fixture: {name}')
                (directory / name).write_bytes(data)
    except (zipfile.BadZipFile, EOFError, OSError, RuntimeError) as e:
        raise NotQualified(f'Invalid ZIP evidence: {e}') from e
    return cases

def tool(name: str) -> tuple[str, str]:
    path = shutil.which(name)
    if not path or not Path(path).is_file():
        raise NotQualified(f'Missing non-OCCT BRL-CAD executable {name}; install a real BRL-CAD distribution')
    p = Path(path).resolve()
    if p.stat().st_size > 500 * 1024 * 1024:
        raise NotQualified('Tool file unexpectedly large')
    return str(p), digest(p)

def run(command: list[str], record: Path, timeout: float) -> str:
    try:
        p = subprocess.run(command, capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=timeout, check=False)
    except subprocess.TimeoutExpired as e:
        record.write_text(f'TIMEOUT: {command[0]} {timeout}s\n')
        raise NotQualified(f'Timeout: {Path(command[0]).name}') from e
    except OSError as e:
        record.write_text(f'EXECUTION ERROR: {e}\n')
        raise NotQualified(f'BRL-CAD execution failed: {e}') from e
    result = p.stdout + '\n[stderr]\n' + p.stderr
    record.write_text('COMMAND: ' + json.dumps(command) + '\nEXIT: ' + str(p.returncode) + '\n' + result)
    if p.returncode != 0:
        raise NotQualified(f'{Path(command[0]).name} returned {p.returncode}: {record.name}')
    return result

def parse_volume(output: str, object_name: str, expected: float, rel_tolerance: float) -> float:
    volume_lines = [(n, float(v)) for n, v in VOLUME.findall(output)]
    exact = [v for n, v in volume_lines if n == object_name]
    if len(exact) != 1 or not math.isfinite(exact[0]) or exact[0] <= 0:
        raise NotQualified('BRL-CAD gqa did not report one finite selected-object volume in mm^3')
    measured = exact[0]
    if abs(measured-expected) > expected*rel_tolerance:
        raise NotQualified(f'Independent ray volume {measured} differs from {expected} mm^3')
    return measured

def parse_ray(output: str, *, expected: str, thickness: float, tolerance: float = 0.05) -> dict:
    # A missed ray must carry an explicit BRL-CAD miss indication. Empty stdout is not a miss.
    hits = [(name, float(los)) for name, los in PARTITION.findall(output)]
    if expected == 'empty':
        if hits or not MISS.search(output):
            raise NotQualified(f'Expected through-hole/outside ray miss, got {hits or "unrecognized output"}')
    elif expected == 'solid':
        if len(hits) != 1 or not math.isfinite(hits[0][1]) or abs(hits[0][1] - thickness) > tolerance:
            raise NotQualified(f'Expected one {thickness}mm solid ray partition, got {hits}')
    else:
        raise ValueError(expected)
    return {'expected': expected, 'hitCount':len(hits), 'lineOfSightMm':[h[1] for h in hits]}

ROOT_TOKEN = re.compile(r"[A-Za-z_][A-Za-z0-9_.:+-]*(?:/(?:R)?)?")

def top_objects(output: str) -> tuple[str, ...]:
    """Parse mged -c database.g tops; refuse ambiguous or unrecognized listings.

    BRL-CAD can mark combinations with '/' and regions with '/R', and may
    print several top-level names on one line. Only stdout is authoritative.
    """
    stdout = output.partition('[stderr]')[0]
    roots = []
    for raw_line in stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith('mged> '):
            line = line[len('mged> '):].strip()
            if line == 'tops':
                continue
        columns = line.split()
        if not columns or not all(ROOT_TOKEN.fullmatch(token) for token in columns):
            raise NotQualified(f'Unrecognized mged tops output: {raw_line[:160]!r}')
        for item in columns:
            name = item.removesuffix('/R') if item.endswith('/R') else item.removesuffix('/')
            if name in roots:
                raise NotQualified(f'Duplicate mged top-level object {name!r}')
            roots.append(name)
    if not roots:
        raise NotQualified('mged tops yielded no unambiguous geometry object')
    return tuple(roots)

def selected_top_object(output: str, specified: str | None) -> str:
    """Auto-select only a unique root; explicit names must match exactly."""
    names = top_objects(output)
    if specified:
        if specified not in names:
            raise NotQualified(f'Selected object {specified!r} is not an exact top-level object: {names!r}')
        return specified
    if len(names) != 1:
        raise NotQualified(f'Import has {len(names)} top-level objects; supply exact --object: {names!r}')
    return names[0]

def sample_rays(c: dict):
    t = float(c['thicknessMm'])
    x = float(c['widthMm']) / 2
    y = float(c['depthMm']) / 2
    # All points are away from tangent boundaries; topological displacement changes these hits.
    probes = [(f'hole.{i}',float(h['x']),float(h['y']),'empty') for i,h in enumerate(c['holes'])]
    probes += [('solid.nw',-x/3,-y/3,'solid'),('solid.ne',x/3,-y/3,'solid'),
               ('solid.sw',-x/3,y/3,'solid'),('solid.se',x/3,y/3,'solid'),
               ('exterior',x+10,0,'empty')]
    # Deliberately detect the fifth central bore independently of total mass.
    if not any(abs(h['x']) < 1e-9 and abs(h['y']) < 1e-9 for h in c['holes']):
        probes.append(('central.material',0,0,'solid'))
    return [(name,px,py,t+5,ex) for name,px,py,ex in probes]

def execute(case: dict, root: Path, args, exe: dict) -> dict:
    name = case['filename']
    target = root / name
    output = root / ('external-' + name)
    output.mkdir()
    database = output / 'imported.g'
    imp = output / 'step-g-report.json'
    # Strict, source-faithful import. Exit 1 means partial and MUST NOT pass.
    run([exe['step-g'][0], '--strict','--exact','--repair','none','--report',str(imp),
         '-o',str(database),str(target)],output/'step-g.log',args.timeout)
    if not database.is_file() or not database.stat().st_size or not imp.is_file():
        raise NotQualified(f'Strict import did not produce database and report: {name}')
    imp_json = json.loads(imp.read_text())  # retained for independent coverage review
    roots = run([exe['mged'][0],'-c',str(database),'tops'],output/'mged-tops.log',args.timeout)
    selected_root = selected_top_object(roots, args.object)
    expected_vol = (case['widthMm']*case['depthMm'] - sum(math.pi*h['radius']**2 for h in case['holes']))*case['thicknessMm']
    vol = run([exe['gqa'][0],'-Av',str(database),selected_root],output/'gqa-volume.log',args.timeout)
    measured = parse_volume(vol,selected_root,expected_vol,args.volume_tolerance)
    rays = []
    for probe,px,py,pz,expected in sample_rays(case):
        script = f'xyz {px:.12g} {py:.12g} {pz:.12g}; dir 0 0 -1; s; q'
        report = run([exe['nirt'][0],'-b','-s','-e',script,str(database),selected_root],
                     output / ('nirt-'+probe+'.log'),args.timeout)
        rays.append({'probe':probe,'xyzMm':[px,py,pz],**parse_ray(report,expected=expected,thickness=case['thicknessMm'])})
    return {'filename':name,'selectedRoot':selected_root,'topLevelObjects':list(top_objects(roots)),
            'sha256':digest(target),'importDatabaseSha256':digest(database),
            'importReportSha256':digest(imp),'importReport':imp_json,
            'expectedVolumeMm3':expected_vol,'measuredRayVolumeMm3':measured,
            'volumeRelativeError':abs(measured-expected_vol)/expected_vol,
            'rayProbes':rays,'classification':'non-OCCT-BRL-CAD-import-and-ray-sampling'}

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--bundle', type=Path, required=True,help='Original GitHub Actions ZIP, e.g. artifact 13563062028')
    ap.add_argument('--output-dir', type=Path, required=True,help='A fresh evidence directory; existing paths rejected')
    ap.add_argument('--object',default=None,help='Optional exact imported root name; automatically selected if sole top-level object')
    ap.add_argument('--step-g',default='step-g')
    ap.add_argument('--mged',default='mged')
    ap.add_argument('--gqa',default='gqa')
    ap.add_argument('--nirt',default='nirt')
    ap.add_argument('--timeout',type=float,default=90)
    ap.add_argument('--volume-tolerance',type=float,default=.01,help='Explicit relative ray-volume sampling budget; default 1%%')
    ap.add_argument('--verify-input-only',action='store_true',help='Verify genuine CI bytes but do NOT claim any external import')
    args=ap.parse_args(argv)
    if args.timeout<=0 or not 0<args.volume_tolerance<=.02:
        ap.error('timeout must be positive, volume tolerance must be (0,2%]')
    if args.output_dir.exists():
        ap.error('output directory must not exist (immutable evidence policy)')
    args.output_dir.mkdir(parents=True)
    report={'schema':'intuit3d.external-cad-qualification/v1','status':'BLOCKED',
            'independentCadInteroperability':False,'sourceArtifact':'GitHub Actions 13563062028',
            'toolchain':{},'cases':[],'limitations':['gqa volume is sampled, not exact analytic mass','bounded known plate fixture only']}
    code=3
    try:
        manifest=fixture_manifest()
        cases=extract_verified(args.bundle,args.output_dir,manifest)
        report['cases']=[{'filename':c['filename'],'sha256':c['sha256'],'inputVerified':True} for c in cases]
        report['status']='INPUT_VERIFIED_NOT_EXTERNAL_CAD'
        code=0
        if not args.verify_input_only:
            if args.object is not None and not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.:+-]{0,127}',args.object):
                raise NotQualified('Invalid exact --object name; refuse unsafe/ambiguous selection')
            exe={}
            for flag in ('step-g','mged','gqa','nirt'):
                exe[flag]=tool(getattr(args,flag.replace('-','_')))
            report['toolchain']={k:{'path':v[0],'sha256':v[1]} for k,v in exe.items()}
            report['cases']=[]
            for c in cases:
                report['cases'].append(execute(c,args.output_dir,args,exe))
            report['status']='NON_OCCT_SAMPLE_ACCEPTED'
            report['independentCadInteroperability']=True
    except (NotQualified, OSError, ValueError, json.JSONDecodeError) as e:
        report['status']='BLOCKED_OR_REJECTED'
        report['error']=str(e)
        code=3
    finally:
        (args.output_dir/'qualification.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'status':report['status'],'error':report.get('error'),'evidence':str(args.output_dir/'qualification.json')},sort_keys=True))
    return code

if __name__ == '__main__':
    sys.exit(main())
