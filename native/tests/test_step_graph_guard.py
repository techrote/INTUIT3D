"""Adversarial STEP graph checks against actual OCP-generated export bytes."""
from __future__ import annotations

import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from step_graph_guard import verify_step_graph


def extract_data(text: str) -> str:
    return text.split('DATA;\n', 1)[1].rsplit('ENDSEC;', 1)[0]


class ParserNegatives(unittest.TestCase):
    def test_strings_and_comments_cannot_forge_entity_definitions(self):
        with self.assertRaisesRegex(ValueError, 'empty DATA'):
            verify_step_graph("/* #1=MANIFOLD_SOLID_BREP('',#2); */", expected_holes=0)
        with self.assertRaisesRegex(ValueError, 'empty DATA'):
            verify_step_graph("'fake #9 = CYLINDRICAL_SURFACE(1);';", expected_holes=0)

    def test_unterminated_literal_and_comment_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unterminated string'):
            verify_step_graph("#1=ANY('invalid);", expected_holes=0)
        with self.assertRaisesRegex(ValueError, 'unterminated comment'):
            verify_step_graph("/* invalid", expected_holes=0)


@unittest.skipUnless(importlib.util.find_spec('OCP'), 'real OCP runtime unavailable')
class RealOCCTGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
        from OCP.gp import gp_Pnt, gp_Dir, gp_Ax2
        from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
        from OCP.IFSelect import IFSelect_RetDone
        cls.dir = tempfile.TemporaryDirectory()
        cls.file = Path(cls.dir.name, 'real.step')
        shape = BRepPrimAPI_MakeBox(gp_Pnt(-60, -40, 0), 120, 80, 8).Shape()
        for x in (-30, 30):
            tool = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, 0, -8), gp_Dir(0, 0, 1)), 6, 24).Shape()
            op = BRepAlgoAPI_Cut(shape, tool)
            op.Build()
            assert op.IsDone()
            shape = op.Shape()
        writer = STEPControl_Writer()
        assert writer.Transfer(shape, STEPControl_AsIs) == IFSelect_RetDone
        assert writer.Write(str(cls.file)) == IFSelect_RetDone
        cls.body = extract_data(cls.file.read_text('ascii'))

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def test_real_two_hole_step_passes(self):
        verify_step_graph(self.body, expected_holes=2)

    def test_unbound_cylinder_after_face_surface_repoint_is_rejected(self):
        body = re.sub(r'(#\d+ = ADVANCED_FACE\([^;]*?,)#(\d+)(,\.[TF]\.\);)',
                      lambda m: m.group(1) + '#32' + m.group(3) if '#282' in m.group(0) else m.group(0),
                      self.body, count=0, flags=re.S)
        self.assertNotEqual(body, self.body)
        with self.assertRaisesRegex(ValueError, 'cylindrical'):
            verify_step_graph(body, expected_holes=2)

    def test_dangling_reference_is_rejected(self):
        bad = re.sub(r'(#\d+ = MANIFOLD_SOLID_BREP\([^;]*?)#\d+', r'\g<1>#999999', self.body, count=1)
        self.assertNotEqual(bad, self.body)
        with self.assertRaisesRegex(ValueError, 'dangling'):
            verify_step_graph(bad, expected_holes=2)

    def test_extra_orphan_face_is_rejected(self):
        bad = self.body + "\n#99999 = ADVANCED_FACE('',(#18),#32,.T.);\n"
        with self.assertRaisesRegex(ValueError, 'orphan advanced face'):
            verify_step_graph(bad, expected_holes=2)

    def test_mm_unit_declaration_not_sufficient_if_unbound(self):
        match = re.search(r'(#\d+ = \( GEOMETRIC_REPRESENTATION_CONTEXT\(3\)[^;]*?GLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\()#(\d+)', self.body, re.S)
        self.assertIsNotNone(match)
        bad = self.body[:match.start(2)] + '515' + self.body[match.end(2):]
        with self.assertRaisesRegex(ValueError, 'length unit'):
            verify_step_graph(bad, expected_holes=2)

    def test_orphan_cylinder_entity_rejected(self):
        bad = self.body + "\n#99999 = CYLINDRICAL_SURFACE('',#283,6.);\n"
        with self.assertRaisesRegex(ValueError, 'cylindrical'):
            verify_step_graph(bad, expected_holes=2)


if __name__ == '__main__':
    unittest.main()
