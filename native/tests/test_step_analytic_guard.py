"""OCP-generated STEP positive and adversarial independent numeric surface tests."""
from __future__ import annotations

import importlib.util
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from step_analytic_guard import verify_step_analytic_plate


@unittest.skipUnless(importlib.util.find_spec('OCP'), 'experimental OCP unavailable')
class AnalyticStepReaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
        from OCP.gp import gp_Pnt, gp_Dir, gp_Ax2
        from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
        from OCP.IFSelect import IFSelect_RetDone
        import tempfile
        cls.temp = tempfile.TemporaryDirectory()
        cls.plate = dict(width=120, depth=80, thickness=8,
                         holes=[{'x': -30, 'y': 0, 'radius': 6}, {'x': 30, 'y': 0, 'radius': 6}])
        cls.bodies = {}
        for n in (0, 1, 2):
            shape = BRepPrimAPI_MakeBox(gp_Pnt(-60, -40, 0), 120, 80, 8).Shape()
            for hole in cls.plate['holes'][:n]:
                tool = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(hole['x'], hole['y'], -8), gp_Dir(0, 0, 1)), 6, 24).Shape()
                cut = BRepAlgoAPI_Cut(shape, tool)
                cut.Build()
                assert cut.IsDone()
                shape = cut.Shape()
            writer = STEPControl_Writer()
            assert writer.Transfer(shape, STEPControl_AsIs) == IFSelect_RetDone
            dest = Path(cls.temp.name, f'plate-{n}.step')
            assert writer.Write(str(dest)) == IFSelect_RetDone
            cls.bodies[n] = dest.read_text('ascii').split('DATA;', 1)[1].rsplit('ENDSEC;', 1)[0]

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_actual_zero_one_two_hole_exports_have_correct_analytic_surfaces(self):
        for n in (0, 1, 2):
            with self.subTest(n=n):
                verify_step_analytic_plate(self.bodies[n], {**self.plate, 'holes': self.plate['holes'][:n]})

    def test_wrong_requested_radius_fails(self):
        wrong = {**self.plate, 'holes': [dict(self.plate['holes'][0], radius=6.001), self.plate['holes'][1]]}
        with self.assertRaisesRegex(ValueError, 'bore centre/radius'):
            verify_step_analytic_plate(self.bodies[2], wrong)

    def test_actual_step_coordinate_edit_is_detected_without_occt_reader(self):
        body = self.bodies[2]
        cylinder = re.search(r'CYLINDRICAL_SURFACE\(\x27\x27,#(\d+),6\.\)', body)
        self.assertIsNotNone(cylinder)
        placement = re.search(r'#' + cylinder[1] + r'\s*=\s*AXIS2_PLACEMENT_3D\(\x27\x27,#(\d+),', body)
        self.assertIsNotNone(placement)
        point = re.search(r'(#' + placement[1] + r'\s*=\s*CARTESIAN_POINT\(\x27\x27,\()(-30\.)(,0\.,-8\.\)\);)', body)
        self.assertIsNotNone(point)
        altered = body[:point.start(2)] + '-29.' + body[point.end(2):]
        with self.assertRaisesRegex(ValueError, 'bore centre/radius'):
            verify_step_analytic_plate(altered, self.plate)

    def test_shifted_plane_support_is_detected(self):
        body = self.bodies[0]
        shifted = body.replace("CARTESIAN_POINT('',(-60.,-40.,0.))", "CARTESIAN_POINT('',(-59.999,-40.,0.))")
        self.assertNotEqual(body, shifted)
        with self.assertRaisesRegex(ValueError, 'X support planes'):
            verify_step_analytic_plate(shifted, {**self.plate, 'holes': []})

    def test_hole_radius_entity_mutation_is_detected(self):
        changed = self.bodies[2].replace("CYLINDRICAL_SURFACE('',", "CYLINDRICAL_SURFACE('',", 1)
        match = re.search(r'(CYLINDRICAL_SURFACE\(\x27\x27,#\d+,)6\.(\);)', changed)
        self.assertIsNotNone(match)
        altered = changed[:match.end(1)] + '6.001' + changed[match.start(2):]
        with self.assertRaisesRegex(ValueError, 'bore centre/radius'):
            verify_step_analytic_plate(altered, self.plate)

    def test_placement_axis_swapped_to_nonorthogonal_reference_is_rejected(self):
        body = self.bodies[2]
        cylinder = re.search(r'CYLINDRICAL_SURFACE\(\x27\x27,#(\d+),6\.\)', body)
        self.assertIsNotNone(cylinder)
        placement = re.search(r'(#' + cylinder[1] + r'\s*=\s*AXIS2_PLACEMENT_3D\(\x27\x27,#\d+,#)(\d+)(,#\d+\);)', body)
        self.assertIsNotNone(placement)
        altered = body[:placement.start(3)] + ',#' + placement[2] + ');' + body[placement.end(3):]
        with self.assertRaisesRegex(ValueError, 'not orthogonal'):
            verify_step_analytic_plate(altered, self.plate)

    def test_bogus_injected_literal_does_not_change_actual_surface(self):
        injected = self.bodies[2] + "\n/* #999999=CYLINDRICAL_SURFACE('',#1,6.); */\n"
        verify_step_analytic_plate(injected, self.plate)


if __name__ == '__main__':
    unittest.main()
