"""Real-OCP regressions: tiny plate rotations hidden by scalar/envelope gates."""
from __future__ import annotations

import importlib.util
import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from plate_axes import classify_cardinal_normal, require_plate_axis_aligned_planes


class PureCardinalPredicateTests(unittest.TestCase):
    def test_all_six_oriented_axes(self):
        for index, axis in enumerate('XYZ'):
            for sign in (-1, 1):
                value = [0.0, 0.0, 0.0]
                value[index] = float(sign)
                with self.subTest(axis=axis, sign=sign):
                    self.assertEqual(classify_cardinal_normal(tuple(value)), axis)

    def test_off_axis_component_not_cosine_rounding(self):
        # At 1e-9 rad, abs(dot(normal, X)) rounds to exactly 1.0.
        angle = 1e-9
        self.assertEqual(math.cos(angle), 1.0)
        with self.assertRaisesRegex(ValueError, 'non-cardinal'):
            classify_cardinal_normal((math.cos(angle), math.sin(angle), 0.0))

    def test_small_measured_angular_drift_remains_within_explicit_gate(self):
        self.assertEqual(classify_cardinal_normal((1, 5e-11, 0)), 'X')

    def test_invalid_normals_fail_closed(self):
        for value in ((1, 1, 0), (0, 0, 0), (2, 0, 0), (1, float('nan'), 0),
                      (1, float('inf'), 0), (1, True, 0), (1, '0', 0),
                      [1, 0], {0: 1, 1: 0, 2: 0}, None):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'plate axes'):
                classify_cardinal_normal(value)


@unittest.skipUnless(importlib.util.find_spec('OCP'), 'experimental OCP binding unavailable')
class RealOcpPlateAxisTests(unittest.TestCase):
    def _rotation(self, angle=1e-9):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
        from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf
        from ocp_worker import build_plate
        shape = build_plate(self._request()['plate'])
        transform = gp_Trsf()
        transform.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), angle)
        return BRepBuilderAPI_Transform(shape, transform, True).Shape()

    def _request(self):
        from test_protocol import plate
        return plate([])

    def test_zero_one_two_hole_plates_and_same_occt_step_are_admitted(self):
        from ocp_worker import build_plate, save_and_reopen
        from test_protocol import plate
        with tempfile.TemporaryDirectory() as tmp:
            fixtures = ([], [{'x': 0, 'y': 0, 'radius': 1e-5}], plate()['plate']['holes'])
            for n, holes in enumerate(fixtures):
                with self.subTest(holes=len(holes)):
                    shape = build_plate(plate(holes)['plate'])
                    self.assertIsNone(require_plate_axis_aligned_planes(shape))
                    reopened = save_and_reopen(shape, Path(tmp, f'plate-{n}.step'))
                    self.assertIsNone(require_plate_axis_aligned_planes(reopened))

    def test_real_rotation_passes_legacy_gates_but_new_oracle_rejects(self):
        from OCP.BRepCheck import BRepCheck_Analyzer
        from OCP.BRepGProp import BRepGProp
        from OCP.GProp import GProp_GProps
        from OCP.TopAbs import TopAbs_SOLID
        from OCP.TopExp import TopExp_Explorer
        from plate_envelope import require_plate_vertex_envelope_mm, vertex_envelope_mm
        from plate_topology import require_plate_face_shell_topology
        from protocol import analytic_invariants, close, validate_result
        from through_hole_guard import require_through_cylindrical_faces

        request = self._request()
        rotated = self._rotation()
        self.assertTrue(BRepCheck_Analyzer(rotated).IsValid())
        self.assertEqual(require_plate_face_shell_topology(rotated), 0)
        self.assertEqual(require_through_cylindrical_faces(rotated), 0)
        bounds = vertex_envelope_mm(rotated)
        require_plate_vertex_envelope_mm(request['plate'], bounds, 'rotated')
        volume, area = GProp_GProps(), GProp_GProps()
        BRepGProp.VolumeProperties_s(rotated, volume)
        BRepGProp.SurfaceProperties_s(rotated, area)
        expected_volume, expected_area = analytic_invariants(request['plate'])
        self.assertTrue(close(volume.Mass(), expected_volume))
        self.assertTrue(close(area.Mass(), expected_area))
        solids = TopExp_Explorer(rotated, TopAbs_SOLID)
        self.assertTrue(solids.More())
        solids.Next()
        self.assertFalse(solids.More())
        # The old response-only oracle also says this rotated, nonconforming
        # shape is 'exact' because it has no holes and all scalars match.
        metrics = dict(valid=True, solidCount=1, volumeMm3=volume.Mass(),
                       surfaceAreaMm2=area.Mass(), cylindricalHoles=[])
        response = dict(protocol=request['protocol'], requestId=request['requestId'],
                        featureId=request['featureId'], revision=request['revision'],
                        backend='OCP-python-prototype', occtVersion='7.9.3.1',
                        status='validated_exact', units='mm', source=metrics,
                        stepReadback=None, stepWritten=False)
        no_export = dict(request, exportStep=False)
        self.assertIs(validate_result(no_export, response), response)
        with self.assertRaisesRegex(ValueError, 'non-cardinal'):
            require_plate_axis_aligned_planes(rotated)

    def test_rotated_source_and_step_readback_fail_at_authoritative_gate(self):
        from ocp_worker import execute, save_and_reopen, solid_properties
        rotated = self._rotation()
        request = self._request()
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder, 'rotated.step')
            with patch('ocp_worker.build_plate', return_value=rotated):
                request['exportStep'] = False
                with self.assertRaisesRegex(ValueError, 'non-cardinal'):
                    execute(request, destination)
            reopened = save_and_reopen(rotated, destination)
            with self.assertRaisesRegex(ValueError, 'non-cardinal'):
                solid_properties(reopened)

    def test_canonical_geometry_still_produces_exact_metrics(self):
        from ocp_worker import build_plate, solid_properties
        from test_protocol import plate
        for holes in ([], [{'x': 0, 'y': 0, 'radius': 1e-5}], plate()['plate']['holes']):
            with self.subTest(holes=len(holes)):
                metrics = solid_properties(build_plate(plate(holes)['plate']))
                self.assertTrue(metrics['valid'])
                self.assertEqual(metrics['solidCount'], 1)
                self.assertEqual(len(metrics['cylindricalHoles']), len(holes))


if __name__ == '__main__':
    unittest.main()
