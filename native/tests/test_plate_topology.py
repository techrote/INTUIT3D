"""Real OCCT regressions for hidden plate-v1 cavities below mass budgets.

The existing STEP structural gate rejects extra shells; source-only admission
must fail as well. All shapes here are constructed as genuine OCCT B-reps.
"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_protocol import plate
from plate_topology import require_plate_face_shell_topology


@unittest.skipUnless(importlib.util.find_spec('OCP'), 'experimental OCP binding unavailable')
class PlateTopologyTests(unittest.TestCase):
    def _cavity(self, kind):
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeSphere
        from OCP.gp import gp_Pnt
        from ocp_worker import build_plate
        original = build_plate(plate()['plate'])
        if kind == 'sphere':
            tool = BRepPrimAPI_MakeSphere(gp_Pnt(0, 20, 4), 1e-4).Shape()
        elif kind == 'box':
            tool = BRepPrimAPI_MakeBox(gp_Pnt(0, 20, 4), 2e-4, 2e-4, 2e-4).Shape()
        else:
            raise AssertionError('unknown fixture')
        operation = BRepAlgoAPI_Cut(original, tool)
        operation.Build()
        self.assertTrue(operation.IsDone())
        return operation.Shape()

    def _old_metrics(self, shape):
        """Legacy scalar/cylinder oracle without the new topology inventory."""
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        from OCP.BRepCheck import BRepCheck_Analyzer
        from OCP.BRepGProp import BRepGProp
        from OCP.GeomAbs import GeomAbs_Cylinder
        from OCP.GProp import GProp_GProps
        from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopoDS import TopoDS
        volume, area = GProp_GProps(), GProp_GProps()
        BRepGProp.VolumeProperties_s(shape, volume)
        BRepGProp.SurfaceProperties_s(shape, area)
        holes = []
        faces = TopExp_Explorer(shape, TopAbs_FACE)
        while faces.More():
            surface = BRepAdaptor_Surface(TopoDS.Face_s(faces.Current()))
            if surface.GetType() == GeomAbs_Cylinder:
                cylinder = surface.Cylinder()
                centre = cylinder.Position().Location()
                holes.append(dict(x=centre.X(), y=centre.Y(), radius=cylinder.Radius(),
                                  axisZ=cylinder.Position().Direction().Z()))
            faces.Next()
        holes.sort(key=lambda h: (h['x'], h['y'], h['radius']))
        solids, n = TopExp_Explorer(shape, TopAbs_SOLID), 0
        while solids.More():
            n += 1
            solids.Next()
        return dict(valid=bool(BRepCheck_Analyzer(shape).IsValid()), solidCount=n,
                    volumeMm3=volume.Mass(), surfaceAreaMm2=area.Mass(),
                    cylindricalHoles=holes)

    def test_canonical_zero_one_and_two_holes_source_and_step(self):
        from ocp_worker import build_plate, save_and_reopen
        with tempfile.TemporaryDirectory() as tmp:
            cases = ([], [{'x': -30, 'y': 0, 'radius': 1e-5}], plate()['plate']['holes'])
            for i, holes in enumerate(cases):
                with self.subTest(holes=len(holes)):
                    original = build_plate(plate(holes)['plate'])
                    self.assertEqual(require_plate_face_shell_topology(original), len(holes))
                    readback = save_and_reopen(original, Path(tmp, f'plate-{i}.step'))
                    self.assertEqual(require_plate_face_shell_topology(readback), len(holes))

    def test_real_microcavity_passes_previous_oracles_but_fails_shell_gate(self):
        from plate_envelope import require_plate_vertex_envelope_mm, vertex_envelope_mm
        from protocol import analytic_invariants, close, validate_result
        from through_hole_guard import require_through_cylindrical_faces
        request = plate()
        shape = self._cavity('sphere')
        metrics = self._old_metrics(shape)
        self.assertTrue(metrics['valid'])
        self.assertEqual(metrics['solidCount'], 1)
        self.assertEqual(len(metrics['cylindricalHoles']), 2)
        volume, area = analytic_invariants(request['plate'])
        self.assertTrue(close(metrics['volumeMm3'], volume))
        self.assertTrue(close(metrics['surfaceAreaMm2'], area))
        self.assertEqual(require_through_cylindrical_faces(shape), 2)
        require_plate_vertex_envelope_mm(request['plate'], vertex_envelope_mm(shape), 'cavity')
        old_response = dict(protocol=request['protocol'], requestId=request['requestId'],
                            featureId=request['featureId'], revision=request['revision'],
                            backend='OCP-python-prototype', occtVersion='7.9.3.1',
                            status='validated_exact', units='mm', source=metrics,
                            stepReadback=metrics, stepWritten=True)
        # This is a real, BRepCheck-valid OCCT shape accepted by the old public
        # metric oracle; STEP preflight already refuses its extra CLOSED_SHELL.
        self.assertIs(validate_result(request, old_response), old_response)
        with self.assertRaisesRegex(ValueError, 'one outer shell'):
            require_plate_face_shell_topology(shape)

    def test_spherical_and_all_planar_internal_voids_fail_source_and_step(self):
        from OCP.BRepCheck import BRepCheck_Analyzer
        from ocp_worker import save_and_reopen, solid_properties
        from protocol import analytic_invariants, close
        expected_volume, expected_area = analytic_invariants(plate()['plate'])
        with tempfile.TemporaryDirectory() as tmp:
            for kind in ('sphere', 'box'):
                with self.subTest(cavity=kind):
                    shape = self._cavity(kind)
                    self.assertTrue(BRepCheck_Analyzer(shape).IsValid())
                    metrics = self._old_metrics(shape)
                    self.assertTrue(close(metrics['volumeMm3'], expected_volume))
                    self.assertTrue(close(metrics['surfaceAreaMm2'], expected_area))
                    with self.assertRaisesRegex(ValueError, 'one outer shell'):
                        solid_properties(shape)
                    imported = save_and_reopen(shape, Path(tmp, f'{kind}.step'))
                    with self.assertRaisesRegex(ValueError, 'one outer shell'):
                        solid_properties(imported)

    def test_part_circumference_cylinder_cannot_masquerade_as_through_bore(self):
        """A real 180-degree cylindrical cut is one B-rep-valid solid/shell.

        Even if an upstream change tried to excuse its added planar faces,
        the actual curved sidewall does not span the authored full circle.
        """
        import math
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
        from OCP.BRepCheck import BRepCheck_Analyzer
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
        from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
        from ocp_worker import save_and_reopen
        base = BRepPrimAPI_MakeBox(gp_Pnt(-60, -40, 0), 120, 80, 8).Shape()
        half_cylinder = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(-30, 0, -8), gp_Dir(0, 0, 1)),
            6, 24, math.pi,
        ).Shape()
        operation = BRepAlgoAPI_Cut(base, half_cylinder)
        operation.Build()
        self.assertTrue(operation.IsDone())
        source = operation.Shape()
        self.assertTrue(BRepCheck_Analyzer(source).IsValid())
        with self.assertRaisesRegex(ValueError, 'incomplete cylindrical circumference'):
            require_plate_face_shell_topology(source)
        with tempfile.TemporaryDirectory() as folder:
            imported = save_and_reopen(source, Path(folder, 'half-bore.step'))
            with self.assertRaisesRegex(ValueError, 'incomplete cylindrical circumference'):
                require_plate_face_shell_topology(imported)

    def test_source_only_execution_never_admits_microcavity(self):
        from ocp_worker import execute
        request = plate()
        request['exportStep'] = False
        with tempfile.TemporaryDirectory() as tmp:
            with patch('ocp_worker.build_plate', return_value=self._cavity('sphere')):
                with self.assertRaisesRegex(ValueError, 'one outer shell'):
                    execute(request, Path(tmp, 'unused.step'))


if __name__ == '__main__':
    unittest.main()
