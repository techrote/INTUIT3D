"""v5 arbitrary straight-edge selected C++ profile. Physical assertions require real pinned worker."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from occt8_linear_contract import (
    validate_linear_request,canonical_linear_request,expected_linear_metrics,
    polygon_metrics)
from occt8_bridge import canonical_request,execute

FIXTURE=json.loads((ROOT/"examples"/"occt8-sloped-bracket-linear.request.json").read_text())
WORKER=os.environ.get("INTUIT3D_OCCT8_WORKER")

def changed(fn):
    q=copy.deepcopy(FIXTURE)
    fn(q)
    return q

class LinearProfileTests(unittest.TestCase):
    def test_sloped_profile_analytic_and_canonical_v5(self):
        q=validate_linear_request(FIXTURE)
        area,perimeter=polygon_metrics(q["profile"]["vertices"],linear=True)
        self.assertEqual(area,5700)
        self.assertAlmostEqual(perimeter,320+math.sqrt(4000),places=9)
        volume,surface=expected_linear_metrics(q)
        self.assertAlmostEqual(volume,5700*8-75*math.pi-112*8,places=8)
        self.assertAlmostEqual(surface,11400+(320+math.sqrt(4000))*8+
                               30*math.pi+2*(14+8)*8-224,places=8)
        self.assertEqual(canonical_linear_request(q),canonical_request(q))
        self.assertIn("INTUIT3D_OCCT8_LINEAR_CHAIN_V5",canonical_request(q))
        self.assertIn("sketch.sloped.bracket 8 6 2",canonical_request(q))

    def test_reject_invalid_winding_sloped_touch_self_crossing_and_units(self):
        cases=[
            changed(lambda x:x["profile"]["vertices"].reverse()),
            changed(lambda x:x["cuts"][0].update(x=55,y=50)),
            changed(lambda x:x["cuts"][1].update(x=55,y=50)),
            changed(lambda x:x["cuts"][1].update(x=15,y=50)),
            changed(lambda x:x["profile"]["vertices"].__setitem__(4,{"x":130,"y":50})),
            changed(lambda x:x["profile"]["vertices"].__setitem__(3,{"x":120,"y":0})),
            changed(lambda x:x.__setitem__("units","inch")),
            changed(lambda x:x["cuts"][1].__setitem__("cutDepthMm",9)),
        ]
        for case in cases:
            with self.subTest(case=case):
                with self.assertRaises(ValueError):
                    validate_linear_request(case)

    @unittest.skipUnless(WORKER,"PINNED_CXX_SKIPPED: real OCCT 8.0.1 worker absent")
    def test_actual_pinned_cpp_sloped_two_step_and_no_overwrite(self):
        worker=Path(WORKER)
        self.assertTrue(worker.is_file(),WORKER)
        hashes=[]
        with tempfile.TemporaryDirectory(prefix="intuit-v5-physical-") as directory:
            for thickness in (8,12):
                q=copy.deepcopy(FIXTURE)
                q["profile"]["thickness"]=thickness
                q["cuts"][1]["cutDepthMm"]=thickness
                q["revision"]=FIXTURE["revision"]+(thickness==12)
                q["requestId"]=f"selected.sloped.bracket.{thickness}"
                self.assertEqual(validate_linear_request(q),q)
                dest=Path(directory)/f"sloped-{thickness}.step"
                result=execute(q,worker=worker,step_output=dest,timeout=120)
                self.assertEqual(result["status"],"validated_exact",result)
                target_area,target_surface=expected_linear_metrics(q)
                for name in ("source","stepReadback"):
                    self.assertEqual(result[name]["solidCount"],1)
                    self.assertTrue(result[name]["valid"])
                    self.assertAlmostEqual(result[name]["volumeMm3"],target_area,places=5)
                    self.assertAlmostEqual(result[name]["surfaceAreaMm2"],target_surface,places=5)
                digest=hashlib.sha256(dest.read_bytes()).hexdigest()
                self.assertEqual(digest,result["stepSha256"])
                hashes.append(digest)
                refused=execute(q,worker=worker,step_output=dest,timeout=120)
                self.assertEqual(refused["status"],"requires_reconciliation")
                self.assertEqual(hashlib.sha256(dest.read_bytes()).hexdigest(),digest)
            self.assertNotEqual(*hashes)

if __name__=="__main__":
    unittest.main()
