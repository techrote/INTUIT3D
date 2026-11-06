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
        cylinders = set(re.findall(r'#(\d+)\s*=\s*CYLINDRICAL_SURFACE\(', self.body))
        plane = re.search(r'#(\d+)\s*=\s*PLANE\(', self.body).group(1)
        faces = re.finditer(r'(#\d+\s*=\s*ADVANCED_FACE\([^;]*?,)#(\d+)(,\.[TF]\.\);)', self.body, re.S)
        matched = next(face for face in faces if face.group(2) in cylinders)
        bad = self.body[:matched.start(2)] + plane + self.body[matched.end(2):]
        with self.assertRaisesRegex(ValueError, 'cylindrical'):
            verify_step_graph(bad, expected_holes=2)

        def test_dangling_reference_is_rejected(self):
        bad = re.sub(r'(#\d+ = MANIFOLD_SOLID_BREP\([^;]*?)#\d+', r'\g<1>#999999', self.body, count=1)
        self.assertNotEqual(bad, self.body)
        with self.assertRaisesRegex(ValueError, 'dangling'):
            verify_step_graph(bad, expected_holes=2)

    def test_extra_orphan_face_is_rejected(self):
        face = re.search(r'#\d+\s*=\s*ADVANCED_FACE\([^;]+;', self.body, re.S).group(0)
        bad = self.body + "\n" + re.sub(r'^#\d+', '#99999', face)
        with self.assertRaisesRegex(ValueError, 'orphan advanced face'):
            verify_step_graph(bad, expected_holes=2)

        def test_mm_unit_declaration_not_sufficient_if_unbound(self):
        match = re.search(r'GLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\(#(\d+),#(\d+)', self.body, re.S)
        self.assertIsNotNone(match)
        bad = self.body[:match.start(1)] + match.group(2) + self.body[match.end(1):]
        with self.assertRaisesRegex(ValueError, 'length unit'):
            verify_step_graph(bad, expected_holes=2)

        def test_orphan_cylinder_entity_rejected(self):
        cylinder = re.search(r'#\d+\s*=\s*CYLINDRICAL_SURFACE\([^;]+;', self.body, re.S).group(0)
        bad = self.body + "\n" + re.sub(r'^#\d+', '#99999', cylinder)
        with self.assertRaisesRegex(ValueError, 'cylindrical'):
            verify_step_graph(bad, expected_holes=2)


if __name__ == '__main__':
    unittest.main()
