#!/usr/bin/env python3
"""Verify a genuine pinned OCCT8 two-plate Actions artifact using independent AnvilCAD.

SOURCE-only manifest validation is never external CAD acceptance. The standalone
probe must execute against the original STEP bytes and pass physical predicates.
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
import zipfile

from bore_probe import bore_wall_probes

PINNED_OCCT = 'b8f597c677811d1f9f4d8a97f5ae2825c0353a42'
SHA = re.compile(r'^[0-9a-f]{64}$')
GIT = re.compile(r'^[0-9a-f]{40}$')

class Rejected(ValueError):
    pass

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def verify_native_artifact(z: zipfile.ZipFile, kernel_sha: str) -> tuple[dict, dict[str, bytes]]:
    """Verify provenance, original native worker and both physical STEP artifacts."""
    if not GIT.fullmatch(kernel_sha):
        raise Rejected('required --kernel-sha must be a full immutable commit')
    names = z.namelist()
    if len(names) != len(set(names)):
        raise Rejected('duplicate archive paths')
    required = ('versions.txt', 'qualification/qualification.json',
                'qualification/worker-build/intuit3d_occt8_plate',
                'qualification/plate-8mm.step', 'qualification/plate-12mm.step')
    if any(names.count(name) != 1 for name in required):
        raise Rejected('missing or duplicated original native artifact files')
    versions = z.read('versions.txt').decode('utf-8')
    assignments = dict(line.split('=', 1) for line in versions.splitlines() if '=' in line)
    if assignments.get('kernel') != kernel_sha or not GIT.fullmatch(assignments.get('platform', '')):
        raise Rejected('C++ producer kernel SHA does not match requested immutable source')
    report = json.loads(z.read('qualification/qualification.json'))
    if (report.get('nativeCppExecuted') is not True
        or report.get('status') != 'NATIVE_EXPERIMENTAL_PASS'
        or report.get('occtInstall', {}).get('commit') != PINNED_OCCT):
        raise Rejected('producer did not execute and qualify the pinned OCCT8 C++ worker')
    worker_sha = report.get('worker', {}).get('sha256', '')
    worker = z.read('qualification/worker-build/intuit3d_occt8_plate')
    if not SHA.fullmatch(worker_sha) or digest(worker) != worker_sha:
        raise Rejected('producer C++ worker SHA mismatch')
    artifacts = report.get('artifacts')
    if not isinstance(artifacts, list) or len(artifacts) != 2:
        raise Rejected('producer must have exactly the 8mm and 12mm plates')
    steps: dict[str, bytes] = {}
    for thickness in (8, 12):
        filename = f'plate-{thickness}mm.step'
        candidates = [a for a in artifacts if isinstance(a, dict)
                      and Path(a.get('step', '')).name == filename]
        if len(candidates) != 1:
            raise Rejected(f'missing or duplicated producer {filename} receipt')
        a = candidates[0]
        expected = (120 * 80 - 2 * math.pi * 6 ** 2) * thickness
        if (a.get('widthMm') != 120 or a.get('depthMm') != 80
            or a.get('thicknessMm') != thickness or a.get('holes') != 2
            or a.get('proof') != 'actual_worker_plus_same_engine_and_part21_subset'
            or not math.isclose(a.get('analyticVolumeMm3', float('nan')), expected,
                                rel_tol=0, abs_tol=0.00001)):
            raise Rejected(f'producer {filename} geometry declaration mismatch')
        original = z.read(f'qualification/{filename}')
        if (not SHA.fullmatch(a.get('stepSha256', ''))
            or a['stepSha256'] != digest(original) or a.get('stepBytes') != len(original)):
            raise Rejected(f'producer {filename} STEP byte hash/size mismatch')
        steps[filename] = original
    if digest(steps['plate-8mm.step']) == digest(steps['plate-12mm.step']):
        raise Rejected('changed thickness did not produce distinct STEP bytes')
    return {'kernelSha': kernel_sha, 'platformSha': assignments['platform'],
            'occtSha': PINNED_OCCT, 'workerSha256': worker_sha}, steps

def parse_probe(stdout: str, thickness: int) -> dict:
    """Inspect exactly the independent engine's actual physical ray/volume receipt."""
    lines = stdout.splitlines()
    accepts = [x for x in lines if x.startswith('ACCEPT ')]
    if len(accepts) != 1:
        raise Rejected('independent probe did not emit one ACCEPT receipt')
    try:
        result = dict(token.split('=', 1) for token in accepts[0].split()[1:])
        measured = float(result['volume_mm3'])
        claimed = float(result['expected_mm3'])
        triangles = int(result['tris'])
    except (KeyError, ValueError) as exc:
        raise Rejected('malformed independent CAD numeric receipt') from exc
    expected = (120 * 80 - 2 * math.pi * 6 ** 2) * thickness
    if (result.get('solids') != '1' or result.get('source_unit') not in ('millimetre', 'millimeter')
        or result.get('imported_exact') != 'true' or result.get('open_edges') != '0'
        or result.get('warnings') != '0' or triangles < 8
        or not all(math.isfinite(x) for x in (measured, claimed))
        or abs(claimed - expected) > 0.00001
        or abs(measured - expected) > expected * 0.01):
        raise Rejected('independent reconstruction lacks exact B-rep, closed solid, or volume')
    probes = [('hole.0', -30, 0, False), ('hole.1', 30, 0, False),
              ('solid.nw', -20, -80/6, True), ('solid.ne', 20, -80/6, True),
              ('solid.sw', -20, 80/6, True), ('solid.se', 20, 80/6, True),
              ('exterior', 70, 0, False), ('central.material', 0, 0, True)]
    case = {'widthMm': 120, 'depthMm': 80, 'thicknessMm': thickness,
            'holes': [{'x': -30, 'y': 0, 'radius': 6},
                      {'x': 30, 'y': 0, 'radius': 6}]}
    probes.extend((name, x, y, expected == 'solid')
                  for name, x, y, _, expected in bore_wall_probes(case))
    lines = [line.split() for line in lines if line.startswith('RAY ')]
    if len(lines) != len(probes):
        raise Rejected('independent CAD missing coordinate-anchored probes')
    ray_evidence = []
    for row, (name, x, y, solid) in zip(lines, probes):
        try:
            if len(row) != 7 or row[1] != name:
                raise ValueError('ray name/field count')
            rx, ry, count, low, high = (float(row[2]), float(row[3]),
                                       int(row[4]), float(row[5]), float(row[6]))
        except ValueError as exc:
            raise Rejected('invalid independent ray receipt') from exc
        if (not all(math.isfinite(v) for v in (rx, ry, low, high))
            or abs(rx - x) > 0.000001 or abs(ry - y) > 0.000001
            or count != (2 if solid else 0)
            or (solid and (abs(low) > 0.05 or abs(high - thickness) > 0.05))
            or (not solid and (low != -1.0 or high != -1.0))):
            raise Rejected(f'independent CAD ray failed at {name}')
        ray_evidence.append({'name': name, 'xMm': rx, 'yMm': ry,
                             'hits': count, 'entryZMm': low if count else None,
                             'exitZMm': high if count else None})
    return {'measuredTriangleVolumeMm3': measured, 'expectedAnalyticVolumeMm3': expected,
            'relativeVolumeError': abs(measured - expected) / expected,
            'triangleCount': triangles, 'importedExactBRep': True,
            'boreWallRaysPerHole': 8, 'rays': ray_evidence}

def execute(args: argparse.Namespace) -> int:
    if args.output_dir.exists():
        raise Rejected('evidence directory must not already exist')
    args.output_dir.mkdir(parents=True)
    report = {'schema': 'intuit3d.source-matched-native-nonocct/v1',
              'status': 'REJECTED', 'independentCadInteroperability': False,
              'nativeArtifactSha256': digest(args.native_zip.read_bytes()),
              'probeSha256': digest(args.probe.read_bytes()), 'cases': []}
    try:
        with zipfile.ZipFile(args.native_zip) as z:
            provenance, steps = verify_native_artifact(z, args.kernel_sha)
        report.update(provenance)
        for thickness in (8, 12):
            name = f'plate-{thickness}mm.step'
            path = args.output_dir / name
            path.write_bytes(steps[name])
            command = [str(args.probe.resolve()), str(path.resolve()),
                       '120', '80', str(thickness), '-30,0,6;30,0,6']
            process = subprocess.run(command, text=True, capture_output=True,
                                     timeout=args.timeout, check=False)
            log = args.output_dir / f'{name}.anvil.log'
            log.write_text('COMMAND: ' + json.dumps(command) + '\nEXIT: ' +
                           str(process.returncode) + '\n[stdout]\n' + process.stdout +
                           '\n[stderr]\n' + process.stderr)
            if process.returncode != 0:
                raise Rejected(f'actual non-OCCT probe failed on {name} (see {log.name})')
            result = parse_probe(process.stdout, thickness)
            result.update({'filename': name, 'sourceSha256': digest(steps[name]),
                           'rawExecutionSha256': digest(log.read_bytes())})
            report['cases'].append(result)
        volumes = [x['measuredTriangleVolumeMm3'] for x in report['cases']]
        if not volumes[1] > volumes[0] + 35000:
            raise Rejected('independent physical thickness edit not reproduced')
        report['status'] = 'NON_OCCT_SOURCE_MATCHED_NATIVE_PAIR_ACCEPTED'
        report['independentCadInteroperability'] = True
        return 0
    except (Rejected, OSError, ValueError, KeyError, zipfile.BadZipFile,
            subprocess.TimeoutExpired) as exc:
        report['error'] = str(exc)
        return 3
    finally:
        (args.output_dir / 'qualification.json').write_text(json.dumps(report, sort_keys=True, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'evidence':
                          str(args.output_dir / 'qualification.json'),
                          'error': report.get('error')}))

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native-zip', type=Path, required=True,
                        help='Original GitHub-hosted OCCT8 C++ Actions evidence ZIP')
    parser.add_argument('--kernel-sha', required=True,
                        help='Full expected immutable KERNEL producer source commit')
    parser.add_argument('--probe', type=Path, required=True,
                        help='Actually compiled, pinned independent AnvilCAD STEP probe')
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--timeout', type=float, default=90)
    args = parser.parse_args()
    try:
        return execute(args)
    except (OSError, ValueError) as exc:
        print(f'REJECTED: {exc}', file=sys.stderr)
        return 3

if __name__ == '__main__':
    sys.exit(main())
