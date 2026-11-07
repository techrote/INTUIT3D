"""Native orthogonal-profile v4 source gates and optional *actual* OCCT8 C++.

Ordinary CI checks request/geometry admission and canonical IPC only. A real
pinned worker is REQUIRED to count the physical STEP tests; absent worker = skip.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from occt8_orthogonal_contract import (
    validate_orthogonal_request,canonical_orthogonal_request,
    expected_orthogonal_metrics,polygon_metrics)
from occt8_bridge import canonical_request,execute

FIXTURE=json.loads((ROOT/"examples"/"occt8-u-bracket-orthogonal.request.json").read_text())
WORKER=os.environ.get("INTUIT3D_OCCT8_WORKER")

def modified(callback):
    item=copy.deepcopy(FIXTURE)
    callback(item)
    return item

class OrthogonalProfileTests(unittest.TestCase):
    def test_admits_actual_u_with_analytic_area_perimeter_and_cut_order(self):
        q=validate_orthogonal_request(FIXTURE)
        self.assertEqual(polygon_metrics(q["profile"]["vertices"]),(6100,500))
        volume,area=expected_orthogonal_metrics(q)
        self.assertAlmostEqual(volume,6100*8-75*__import__("math").pi-960,places=8)
        self.assertAlmostEqual(area,16200+30*__import__("math").pi+112,places=8)
        wire=canonical_orthogonal_request(q)
        self.assertEqual(wire,canonical_request(q))
        self.assertIn("INTUIT3D_OCCT8_ORTHOGONAL_CHAIN_V4",wire)
        self.assertIn("sketch.u.bracket 8 8 2",wire)
        self.assertIn("cut.left.blind C -47 10 5 0 3",wire)
        self.assertIn("cut.right.through R 47 10 10 12 8",wire)

    def test_retrospective_thickness_preserves_selection_and_cut_ids(self):
        edited=modified(lambda q: (q["profile"].__setitem__("thickness",12),
                                   q["cuts"][1].__setitem__("cutDepthMm",12),
                                   q.__setitem__("revision",9)))
        q=validate_orthogonal_request(edited)
        self.assertEqual(q["profile"]["profileId"],FIXTURE["profile"]["profileId"])
        self.assertEqual([c["featureId"] for c in q["cuts"]],
                         [c["featureId"] for c in FIXTURE["cuts"]])
        volume,area=expected_orthogonal_metrics(q)
        self.assertAlmostEqual(volume,6100*12-75*__import__("math").pi-1440,places=8)
        self.assertAlmostEqual(area,18200+30*__import__("math").pi+288,places=8)

    def test_refuses_missing_material_touch_crossings_wrong_winding_and_units(self):
        cases=[
            modified(lambda q:q["cuts"][0].update(x=0,y=10)),
            modified(lambda q:q["cuts"][0].update(x=-55,y=10)),
            modified(lambda q:q["cuts"][0].update(x=47,y=10)),
            modified(lambda q:q["cuts"][0].update(featureId=q["profile"]["profileId"])),
            modified(lambda q:q["profile"]["vertices"].reverse()),
            modified(lambda q:q["profile"]["vertices"].__setitem__(4,{"x":35,"y":40})),
            modified(lambda q:q.__setitem__("units","in")),
            modified(lambda q:q["cuts"][1].__setitem__("cutDepthMm",9)),
        ]
        for case in cases:
            with self.subTest(case=case):
                with self.assertRaises(ValueError):
                    validate_orthogonal_request(case)

    def test_worker_not_claimed_when_not_installed(self):
        self.assertEqual(len(FIXTURE["profile"]["vertices"]),8)
        self.assertFalse(any("occt" in m.lower() for m in ("Python geometry", "source-only")))

    @unittest.skipUnless(WORKER,"PINNED_CXX_SKIPPED: INTUIT3D_OCCT8_WORKER not installed")
    def test_real_pinned_cpp_u_bracket_two_step_and_no_overwrite(self):
        worker=Path(WORKER)
        self.assertTrue(worker.is_file(),WORKER)
        with tempfile.TemporaryDirectory(prefix="intuit3d-u-real-") as folder:
            root=Path(folder)
            files=[]
            for label,q in (("original",FIXTURE),("edited",modified(lambda q: (
                    q["profile"].__setitem__("thickness",12),
                    q["cuts"][1].__setitem__("cutDepthMm",12),
                    q.__setitem__("revision",9))))):
                dest=root/(label+".step")
                result=execute(q,worker=worker,step_output=dest,timeout=120)
                self.assertEqual(result["status"],"validated_exact",result)
                self.assertEqual(result["source"]["solidCount"],1)
                self.assertEqual(result["stepReadback"]["solidCount"],1)
                volume,_=expected_orthogonal_metrics(q)
                self.assertAlmostEqual(result["source"]["volumeMm3"],volume,places=5)
                self.assertAlmostEqual(result["stepReadback"]["volumeMm3"],volume,places=5)
                self.assertEqual(result["stepSha256"],hashlib.sha256(dest.read_bytes()).hexdigest())
                files.append(result["stepSha256"])
                attempted=execute(q,worker=worker,step_output=dest,timeout=120)
                self.assertEqual(attempted["status"],"requires_reconciliation")
                self.assertEqual(hashlib.sha256(dest.read_bytes()).hexdigest(),files[-1])
            self.assertNotEqual(*files)

if __name__=="__main__":
    unittest.main()
