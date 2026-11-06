"""Actual OCP micro-blind-cut regression; not an external STEP consumer.

A 10-nanometre-radius blind hole can satisfy the old volume/area budget, carry
one correct cylinder and preserve the six plate extents while failing intent.
"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_protocol import plate
from through_hole_guard import require_through_cylindrical_faces


@unittest.skipUnless(importlib.util.find_spec('OCP'), 'pinned experimental OCP binding unavailable')
class ThroughHoleTests(unittest.TestCase):
    def _blind_step(self, target: Path):
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
        from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
        from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
        from OCP.IFSelect import IFSelect_RetDone
        base = BRepPrimAPI_MakeBox(gp_Pnt(-60, -40, 0), 120, 80, 8).Shape()
        # Real positive blind cut 0.01 mm shy of the bottom, not a fake
        # metrics object. The 1e-5 mm radius is allowed by plate-v1.
        tool = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(-30, 0, 0.01), gp_Dir(0, 0, 1)), 1e-5, 8.01
        ).Shape()
        operation = BRepAlgoAPI_Cut(base, tool)
        operation.Build()
        self.assertTrue(operation.IsDone())
        from OCP.BRepCheck import BRepCheck_Analyzer
        self.assertTrue(BRepCheck_Analyzer(operation.Shape()).IsValid())
        writer = STEPControl_Writer()
        self.assertEqual(writer.Transfer(operation.Shape(), STEPControl_AsIs), IFSelect_RetDone)
        self.assertEqual(writer.Write(str(target)), IFSelect_RetDone)

    def _old_metrics_from_actual_step(self, step: Path) -> tuple[object, dict]:
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        from OCP.BRepCheck import BRepCheck_Analyzer
        from OCP.BRepGProp import BRepGProp
        from OCP.GeomAbs import GeomAbs_Cylinder
        from OCP.GProp import GProp_GProps
        from OCP.IFSelect import IFSelect_RetDone
        from OCP.STEPControl import STEPControl_Reader
        from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopoDS import TopoDS
        reader = STEPControl_Reader()
        self.assertEqual(reader.ReadFile(str(step)), IFSelect_RetDone)
        self.assertEqual(reader.TransferRoots(), 1)
        shape = reader.OneShape()
        vp, ap = GProp_GProps(), GProp_GProps()
        BRepGProp.VolumeProperties_s(shape, vp)
        BRepGProp.SurfaceProperties_s(shape, ap)
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
        solids = TopExp_Explorer(shape, TopAbs_SOLID)
        nsolids = 0
        while solids.More():
            nsolids += 1
            solids.Next()
        metrics = dict(valid=bool(BRepCheck_Analyzer(shape).IsValid()), solidCount=nsolids,
                       volumeMm3=vp.Mass(), surfaceAreaMm2=ap.Mass(),
                       cylindricalHoles=holes)
        return shape, metrics

    def test_real_authored_plate_and_microhole_span_full_height(self):
        from ocp_worker import build_plate, save_and_reopen
        with tempfile.TemporaryDirectory() as tmp:
            for holes in ([{'x': -30, 'y': 0, 'radius': 1e-5}],
                          [{'x': -30, 'y': 0, 'radius': 6}, {'x': 30, 'y': 0, 'radius': 6}]):
                with self.subTest(holes=holes):
                    shape = build_plate(plate(holes)['plate'])
                    self.assertEqual(require_through_cylindrical_faces(shape), len(holes))
                    reimport = save_and_reopen(shape, Path(tmp, 'check.step'))
                    self.assertEqual(require_through_cylindrical_faces(reimport), len(holes))

    def test_real_blind_microhole_passes_previous_oracles_but_fails_depth(self):
        from plate_envelope import require_plate_vertex_envelope_mm, vertex_envelope_mm
        from protocol import validate_result, analytic_invariants
        from step_preflight import verify_step_artifact
        request = plate([{'x': -30, 'y': 0, 'radius': 1e-5}])
        with tempfile.TemporaryDirectory() as tmp:
            replacement = Path(tmp, 'blind.step')
            self._blind_step(replacement)
            verify_step_artifact(replacement, expected_holes=1)
            shape, metrics = self._old_metrics_from_actual_step(replacement)
            require_plate_vertex_envelope_mm(request['plate'], vertex_envelope_mm(shape), 'blind STEP')
            expected_v, expected_a = analytic_invariants(request['plate'])
            self.assertLess(abs(metrics['volumeMm3'] - expected_v), 1e-7)
            self.assertLess(abs(metrics['surfaceAreaMm2'] - expected_a), 2e-6)
            self.assertEqual(len(metrics['cylindricalHoles']), 1)
            previous_response = dict(protocol=request['protocol'], requestId=request['requestId'],
                                     featureId=request['featureId'], revision=request['revision'],
                                     backend='OCP-python-prototype', occtVersion='7.9.3.1',
                                     status='validated_exact', units='mm', source=metrics,
                                     stepReadback=metrics, stepWritten=True)
            # An actual STEP B-rep, not forged metadata, passed every previous
            # plate-v1 response, graph, extent and aggregate-mass gate.
            self.assertIs(validate_result(request, previous_response), previous_response)
            with self.assertRaisesRegex(ValueError, 'through-hole depth'):
                require_through_cylindrical_faces(shape)
            from step_audit_worker import inspect_step
            with self.assertRaisesRegex(ValueError, 'through-hole depth'):
                inspect_step(replacement)

    def test_supervisor_does_not_publish_valid_graph_blind_microhole(self):
        from run_plate import execute
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            replacement = root / 'blind.step'
            self._blind_step(replacement)
            native = str(Path(__file__).resolve().parents[1])
            wrapper = root / 'replace_step.py'
            wrapper.write_text(
                'import sys\nfrom pathlib import Path\n'
                f'sys.path.insert(0, {native!r})\n'
                'from ocp_worker import main\nmain()\n'
                f"Path(sys.argv[sys.argv.index('--step')+1]).write_bytes(Path({str(replacement)!r}).read_bytes())\n",
                encoding='utf-8',
            )
            destination = root / 'must-not-publish.step'
            result = execute(plate([{'x': -30, 'y': 0, 'radius': 1e-5}]),
                             step_output=destination, worker=wrapper, timeout=35)
            self.assertEqual(result['status'], 'requires_reconciliation', result)
            self.assertIn('STEP readback', result['message'])
            self.assertFalse(destination.exists())


if __name__ == '__main__':
    unittest.main()
