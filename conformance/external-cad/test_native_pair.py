"""Unit-only negative controls; genuine CAD evidence requires the executable probe."""
from __future__ import annotations
import hashlib
import io
import json
import math
from pathlib import Path
import unittest
import zipfile

from native_pair import PINNED_OCCT, Rejected, parse_probe, verify_native_artifact

KERNEL = 'c46d02847468b69a106fbfa6fad715c10399ff2c'
PLATFORM = 'd5c2c3f54466479bf5bec3b04c3b66ed00549ec4'


def source_bundle(*, tamper=False, exact=True):
    worker = b'actual worker bytes in a synthetic test fixture, not native CAD'
    steps = {8: b'synthetic test bytes 8', 12: b'synthetic test bytes 12'}
    report = {
        'nativeCppExecuted': True, 'status': 'NATIVE_EXPERIMENTAL_PASS',
        'occtInstall': {'commit': PINNED_OCCT},
        'worker': {'sha256': hashlib.sha256(worker).hexdigest()},
        'artifacts': [
            {'step': f'/runner/plate-{t}mm.step', 'stepSha256': hashlib.sha256(steps[t]).hexdigest(),
             'stepBytes': len(steps[t]), 'widthMm': 120, 'depthMm': 80,
             'thicknessMm': t, 'holes': 2,
             'proof': 'actual_worker_plus_same_engine_and_part21_subset',
             'analyticVolumeMm3': (120*80-2*math.pi*6*6)*t}
            for t in (8, 12)]
    }
    if not exact:
        report['nativeCppExecuted'] = False
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as z:
        z.writestr('versions.txt', f'platform={PLATFORM}\nkernel={KERNEL}\n')
        z.writestr('qualification/qualification.json', json.dumps(report))
        z.writestr('qualification/worker-build/intuit3d_occt8_plate', worker)
        for t, data in steps.items():
            z.writestr(f'qualification/plate-{t}mm.step', data + (b' tampered' if tamper and t == 12 else b''))
    return io.BytesIO(buffer.getvalue())


def good_receipt(thickness=8):
    wanted = (120*80 - 2*math.pi*6*6)*thickness
    rays = []
    for name,x,y,solid in [
        ('hole.0', -30, 0, False), ('hole.1',30,0,False),
        ('solid.nw',-20,-80/6,True), ('solid.ne',20,-80/6,True),
        ('solid.sw',-20,80/6,True), ('solid.se',20,80/6,True),
        ('exterior',70,0,False), ('central.material',0,0,True)]:
        rays.append(f'RAY {name} {x:.9f} {y:.9f} {2 if solid else 0} '
                    f'{0 if solid else -1:.9f} {thickness if solid else -1:.9f}')
    rays.append(f'ACCEPT solids=1 source_unit=millimetre imported_exact=true tris=1396 '
                f'open_edges=0 volume_mm3={wanted*1.0001:.9f} '
                f'expected_mm3={wanted:.9f} warnings=0')
    return '\n'.join(rays)

class SourceAndPredicateTests(unittest.TestCase):
    def test_source_artifact_manifest_verification_only(self):
        with zipfile.ZipFile(source_bundle()) as z:
            source, steps = verify_native_artifact(z, KERNEL)
        self.assertEqual(source['kernelSha'], KERNEL)
        self.assertEqual(len(steps), 2)

    def test_explicit_source_mismatch_rejected(self):
        with zipfile.ZipFile(source_bundle()) as z:
            with self.assertRaisesRegex(Rejected, 'kernel SHA'):
                verify_native_artifact(z, '0'*40)

    def test_step_mutation_rejected_despite_same_source_receipt(self):
        with zipfile.ZipFile(source_bundle(tamper=True)) as z:
            with self.assertRaisesRegex(Rejected, 'hash/size'):
                verify_native_artifact(z, KERNEL)

    def test_no_native_execution_rejected(self):
        with zipfile.ZipFile(source_bundle(exact=False)) as z:
            with self.assertRaisesRegex(Rejected, 'execute'):
                verify_native_artifact(z, KERNEL)

    def test_sampled_receipt_requires_actual_predicates(self):
        valid = parse_probe(good_receipt(), 8)
        self.assertEqual(valid['triangleCount'], 1396)
        self.assertEqual(len(valid['rays']), 8)
        for changed in (
            good_receipt().replace('imported_exact=true', 'imported_exact=false'),
            good_receipt().replace('warnings=0', 'warnings=1'),
            good_receipt().replace('open_edges=0', 'open_edges=1'),
            good_receipt().replace('RAY hole.0 -30.000000000', 'RAY hole.0 -29.000000000'),
            good_receipt().replace('RAY hole.0 -30.000000000 0.000000000 0',
                                   'RAY hole.0 -30.000000000 0.000000000 2'),
            good_receipt().replace('8.000000000', '7.000000000'),
        ):
            with self.subTest(changed=changed[-110:]):
                with self.assertRaises(Rejected):
                    parse_probe(changed, 8)

    def test_wrong_expected_thickness_rejected(self):
        with self.assertRaises(Rejected):
            parse_probe(good_receipt(), 12)

if __name__ == '__main__':
    unittest.main()
