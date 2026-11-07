"""Independent STEP plate-subset oracle exercised against real exported B-reps."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from occt8.part21_oracle import Step, UnsupportedStep, _fields, verify_plate_part21

PLATE = {"width":120, "depth":80, "thickness":8,
         "holes":[{"x":-30,"y":0,"radius":6},{"x":30,"y":0,"radius":6}]}


class IndependentPart21Tests(unittest.TestCase):
    def test_nested_express_fields_and_escaped_string(self):
        self.assertEqual(_fields("'O''Brien',(1.,2.),#7"), ["'O''Brien'", "(1.,2.)", "#7"])
        with self.assertRaises(UnsupportedStep):
            _fields("'unterminated")

    def test_wrong_part21_envelope_is_not_assumed_valid(self):
        with self.assertRaises(UnsupportedStep):
            Step(b"not a STEP artifact" * 15)

    @unittest.skipUnless(importlib.util.find_spec("OCP"), "real OCP STEP fixture unavailable")
    def test_actual_step_eight_and_twelve_mm_and_material_mutations(self):
        import OCP
        if OCP.__version__ != "7.9.3.1":
            self.skipTest("requires pinned 7.9.3.1 fixture producer")
        from ocp_worker import build_plate, save_and_reopen
        with tempfile.TemporaryDirectory() as tmp:
            for thickness in (8, 12):
                plate = json.loads(json.dumps(PLATE))
                plate["thickness"] = thickness
                step_file = Path(tmp) / f"actual-{thickness}.step"
                save_and_reopen(build_plate(plate), step_file)
                data = step_file.read_bytes()
                result = verify_plate_part21(data, plate)
                self.assertEqual(result["readback"], "independent-part21-plate-subset-v1")
                self.assertEqual(result["solidCount"], 1)
                self.assertEqual(result["faceCount"], 8)
                self.assertEqual(len(result["cylindricalHoles"]), 2)
                self.assertEqual(result["vertexEnvelopeMm"][2], [0, thickness])
                self.assertAlmostEqual(result["analyticPlateVolumeMm3"],
                    (120*80-2*3.141592653589793*6*6)*thickness, delta=1e-6)
                changed = json.loads(json.dumps(plate))
                changed["holes"][0]["x"] += 5
                with self.assertRaisesRegex(UnsupportedStep, "bore differs"):
                    verify_plate_part21(data, changed)
                text = data.decode("ascii")
                self.assertIn("SI_UNIT(.MILLI.,.METRE.)", text)
                with self.assertRaisesRegex(UnsupportedStep, "millimetres"):
                    verify_plate_part21(text.replace("SI_UNIT(.MILLI.,.METRE.)",
                                                   "SI_UNIT($,.METRE.)").encode("ascii"), plate)
                corrupt = re.sub(r"(CYLINDRICAL_SURFACE\('',#\d+,)6\.\)",
                                 r"\g<1>7.)", text, count=1)
                self.assertNotEqual(corrupt, text)
                with self.assertRaisesRegex(UnsupportedStep, "bore differs"):
                    verify_plate_part21(corrupt.encode("ascii"), plate)
                # Reversing one oriented edge without changing its adjacent
                # face is a real shell closure failure, not a numeric epsilon.
                wrong_winding = re.sub(r"(ORIENTED_EDGE\('',\*,\*,#\d+,)\.T\.\)",
                                       r"\g<1>.F.)", text, count=1)
                self.assertNotEqual(wrong_winding, text)
                with self.assertRaisesRegex(UnsupportedStep, "shell edge"):
                    verify_plate_part21(wrong_winding.encode("ascii"), plate)


if __name__ == "__main__":
    unittest.main()
