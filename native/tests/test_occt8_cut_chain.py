"""Real OCCT8 C++ ordered plate/cut contract and executable fixture.

The native geometry test is conditional on the actual pinned binary; all other
tests execute on Ubuntu and Windows without inventing a C++ run.
"""
from __future__ import annotations
import copy
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from occt8_cut_contract import (
    canonical_cut_request, cut_metrics, validate_cut_request, validate_cut_result,
)
from occt8_bridge import execute

FIXTURE = {
    "protocol":"intuit3d/kernel/plate-cut-chain-v1",
    "requestId":"fixture.ordered-pocket",
    "featureId":"body.plate",
    "revision":8,
    "units":"mm",
    "plate":{"width":120,"depth":80,"thickness":8,
             "holes":[{"x":-30,"y":0,"radius":6},{"x":30,"y":0,"radius":6}]},
    "cuts":[
        {"featureId":"cut.blind","x":-10,"y":20,"width":12,"depth":10,"cutDepthMm":3},
        {"featureId":"cut.through","x":5,"y":-20,"width":10,"depth":8,"cutDepthMm":8},
    ],
    "exportStep":True
}


class CutChainContractTest(unittest.TestCase):
    def test_validated_ordered_blind_and_through_rectangles(self):
        req = validate_cut_request(copy.deepcopy(FIXTURE))
        wire = canonical_cut_request(req)
        self.assertIn("INTUIT3D_OCCT8_CUT_CHAIN_V1", wire)
        self.assertIn("120 80 8 2 2", wire)
        self.assertLess(wire.index("cut.blind"), wire.index("cut.through"))
        volume, area = cut_metrics(req)
        self.assertAlmostEqual(volume, (120*80 - 2*math.pi*36)*8 - 12*10*3 - 10*8*8)
        self.assertGreater(area, 0)

    def test_retroactive_dimension_edit_changes_physical_oracle(self):
        edited = copy.deepcopy(FIXTURE)
        edited["revision"] += 1
        edited["plate"]["width"] = 130
        edited["plate"]["thickness"] = 12
        edited["cuts"][0]["cutDepthMm"] = 5
        edited["cuts"][1]["cutDepthMm"] = 12
        validate_cut_request(edited)
        self.assertNotEqual(cut_metrics(FIXTURE), cut_metrics(edited))
        self.assertEqual([c["featureId"] for c in edited["cuts"]],
                         ["cut.blind", "cut.through"])

    def test_invalid_overlap_depth_and_lost_identity_rejected(self):
        for key, modifier in [
            ("overlap", lambda c: c["cuts"][1].update({"x": -10,"y":20})),
            ("bore", lambda c: c["cuts"][0].update({"x":-30,"y":0})),
            ("depth", lambda c: c["cuts"][0].update({"cutDepthMm":9})),
            ("id", lambda c: c["cuts"][1].update({"featureId":"cut.blind"})),
            ("escape", lambda c: c["cuts"][1].update({"x":59})),
        ]:
            with self.subTest(key=key):
                bad = copy.deepcopy(FIXTURE)
                modifier(bad)
                with self.assertRaises(ValueError):
                    validate_cut_request(bad)

    def test_missing_actual_worker_fails_without_step(self):
        with tempfile.TemporaryDirectory() as folder:
            step = Path(folder)/"must-not-appear.step"
            result = execute(FIXTURE,worker=Path(folder)/"nonexistent",step_output=step)
            self.assertEqual(result["status"],"worker_crash",result)
            self.assertFalse(step.exists())

    def test_subset_audit_cannot_mislabel_cut_geometry(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError,"plate-subset"):
                execute(FIXTURE,worker=Path(folder)/"nonexistent",
                        step_output=Path(folder)/"invalid.step",part21_audit=True)

    @unittest.skipUnless(os.getenv("INTUIT3D_OCCT8_WORKER"),
                         "genuine pinned OCCT 8.0.1 C++ worker not provisioned")
    def test_actual_cpp_two_pockets_thickness_edit_step(self):
        """This test must never be counted as real C++ unless binary is present."""
        with tempfile.TemporaryDirectory() as folder:
            worker = Path(os.environ["INTUIT3D_OCCT8_WORKER"])
            observed = []
            for thickness in (8, 12):
                request = copy.deepcopy(FIXTURE)
                request["plate"]["thickness"] = thickness
                request["cuts"][1]["cutDepthMm"] = thickness
                request["revision"] = thickness
                path = Path(folder)/f"native-{thickness}.step"
                response = execute(request,worker=worker,step_output=path,timeout=120)
                self.assertEqual(response["status"],"validated_exact",response)
                self.assertEqual(response["backend"],"OCCT-cxx-8.0.1")
                validate_cut_result(request, {k:v for k,v in response.items()
                    if k in ("protocol","requestId","featureId","revision","backend",
                             "occtVersion","status","units","source","stepReadback","stepWritten")})
                self.assertGreater(path.stat().st_size,256)
                observed.append((response["source"]["volumeMm3"],response["stepSha256"]))
            self.assertGreater(observed[1][0],observed[0][0])
            self.assertNotEqual(observed[0][1],observed[1][1])


if __name__ == "__main__":
    unittest.main()
