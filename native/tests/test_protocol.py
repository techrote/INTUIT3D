from __future__ import annotations
import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from protocol import SCHEMA, InvalidRequest, analytic_invariants, validate_request, validate_result


def plate(holes=None):
    return {
        'protocol': SCHEMA, 'requestId': 'req.1', 'featureId': 'plate.1', 'revision': 7, 'units': 'mm', 'exportStep': True,
        'plate': {'width': 120, 'depth': 80, 'thickness': 8, 'holes': holes if holes is not None else [{'x': -30, 'y': 0, 'radius': 6}, {'x': 30, 'y': 0, 'radius': 6}]},
    }


class ContractTests(unittest.TestCase):
    def test_expected_analytic_oracle(self):
        self.assertEqual(validate_request(plate())['revision'], 7)
        volume, area = analytic_invariants(plate()['plate'])
        self.assertAlmostEqual(volume, 74990.44263153228, places=8)
        self.assertAlmostEqual(area, 22550.79644737231, places=8)

    def test_roundtrippable_intent(self):
        original = plate()
        self.assertEqual(validate_request(json.loads(json.dumps(original))), original)

    def test_reject_tangent_plate_boundary(self):
        with self.assertRaisesRegex(InvalidRequest, 'tangent'):
            validate_request(plate([{'x': 54, 'y': 0, 'radius': 6}]))

    def test_reject_overlapping_and_tangent_holes(self):
        for x in (-30, -18, -20):
            with self.subTest(x=x), self.assertRaisesRegex(InvalidRequest, 'overlapping or tangent'):
                validate_request(plate([{'x': -30, 'y': 0, 'radius': 6}, {'x': x, 'y': 0, 'radius': 6}]))

    def test_reject_nan_boolean_and_unknown_fields(self):
        tests = [
            ('dimension NaN', lambda x: x['plate'].update(width=float('nan'))),
            ('dimension boolean', lambda x: x['plate'].update(width=True)),
            ('invalid revision', lambda x: x.update(revision=1.5)),
            ('unsupported units', lambda x: x.update(units='in')),
            ('unversioned protocol', lambda x: x.update(protocol='1')),
            ('unknown field', lambda x: x.update(backend='guess')),
            ('semantic id injection', lambda x: x.update(requestId='../secret')),
            ('too many holes', lambda x: x['plate'].update(holes=[{'x': 0, 'y': 0, 'radius': 1}] * 65)),
        ]
        for label, mutation in tests:
            with self.subTest(label=label):
                obj = plate(); mutation(obj)
                with self.assertRaises(InvalidRequest):
                    validate_request(obj)

    def test_reject_forged_approximate_or_stale_exact(self):
        request = plate()
        source = {'valid': True, 'solidCount': 1, 'volumeMm3': 74990.44263153228, 'surfaceAreaMm2': 22550.79644737231,
                  'cylindricalHoles': [{'x': -30, 'y': 0, 'radius': 6, 'axisZ': 1}, {'x': 30, 'y': 0, 'radius': 6, 'axisZ': 1}]}
        valid = dict(protocol=SCHEMA, requestId='req.1', featureId='plate.1', revision=7, backend='OCP-python-prototype', occtVersion='7.9.3.1', status='validated_exact', units='mm', source=source, stepReadback=source, stepWritten=True)
        self.assertEqual(validate_result(request, valid), valid)
        cases = [
            lambda x: x.update(status='approximate_preview'),
            lambda x: x.update(occtVersion='8.0.1'),
            lambda x: x.update(occtVersion=''),
            lambda x: x.update(revision=6),
            lambda x: x['source'].update(solidCount=2),
            lambda x: x['source'].update(volumeMm3=0),
            lambda x: x['stepReadback'].update(surfaceAreaMm2=20000),
            lambda x: x.update(stepWritten=False),
            lambda x: x['source'].update(cylindricalHoles=[]),
            lambda x: x['stepReadback']['cylindricalHoles'][0].update(radius=5.99),
        ]
        for mutation in cases:
            candidate = json.loads(json.dumps(valid)); mutation(candidate)
            with self.assertRaises(ValueError):
                validate_result(request, candidate)
        no_export_request = plate(); no_export_request['exportStep'] = False
        no_export_response = json.loads(json.dumps(valid))
        no_export_response['stepWritten'] = False
        no_export_response['stepReadback'] = None
        self.assertIs(validate_result(no_export_request, no_export_response), no_export_response)
        no_export_response['stepReadback'] = source
        with self.assertRaisesRegex(ValueError, 'unexpected STEP readback'):
            validate_result(no_export_request, no_export_response)


if __name__ == '__main__':
    unittest.main()
