"""Mixed circular and rectangular OCCT8 plate pockets: deterministic real-run gate."""
from __future__ import annotations
import copy
import math
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from occt8_cut_contract import (
    MIXED_SCHEMA, validate_mixed_cut_request, canonical_mixed_cut_request,
    cut_metrics, validate_cut_result,
)
from occt8_bridge import execute

FIXTURE = {
    "protocol": MIXED_SCHEMA,
    "requestId": "fixture.mixed-round-pocket",
    "featureId": "body.plate",
    "revision": 8,
    "units": "mm",
    "plate": {"width": 120, "depth": 80, "thickness": 8,
              "holes": [{"x": -30, "y": 0, "radius": 6},
                        {"x": 30, "y": 0, "radius": 6}]},
    "cuts": [
        {"featureId": "cut.round-blind", "kind": "circle",
         "x": -10, "y": 20, "radius": 5, "cutDepthMm": 3},
        {"featureId": "cut.rect-through", "kind": "rectangle",
         "x": 5, "y": -20, "width": 10, "depth": 8, "cutDepthMm": 8},
    ],
    "exportStep": True,
}


class MixedCutContractTest(unittest.TestCase):
    def test_canonical_identity_mass_and_retrospective_rebuild(self):
        q = validate_mixed_cut_request(copy.deepcopy(FIXTURE))
        wire = canonical_mixed_cut_request(q)
        self.assertIn("INTUIT3D_OCCT8_MIXED_CUT_CHAIN_V2", wire)
        self.assertIn("cut.round-blind C -10 20 5 0 3", wire)
        self.assertAlmostEqual(cut_metrics(q)[0],
            (120*80-2*math.pi*36)*8 - math.pi*25*3 - 10*8*8)
        edited = copy.deepcopy(q)
        edited["plate"]["thickness"] = 12
        edited["cuts"][0]["cutDepthMm"] = 5
        edited["cuts"][1]["cutDepthMm"] = 12
        self.assertGreater(cut_metrics(edited)[0], cut_metrics(q)[0])
        self.assertEqual([c["featureId"] for c in edited["cuts"]],
                         [c["featureId"] for c in q["cuts"]])

    def test_real_disallowed_footprint_overlaps_and_depth(self):
        edits = [
            lambda q: q["cuts"][0].update({"x": -30, "y": 0}),
            lambda q: q["cuts"][0].update({"cutDepthMm": 9}),
            lambda q: q["cuts"][0].update({"radius": 23}),
            lambda q: q["cuts"][1].update({"x": -10, "y": 20}),
            lambda q: q["cuts"][1].update({"kind": "circle", "radius": 5}),
            lambda q: q["cuts"][1].update({"featureId": "cut.round-blind"}),
        ]
        for i, edit in enumerate(edits):
            with self.subTest(i=i):
                q = copy.deepcopy(FIXTURE)
                edit(q)
                with self.assertRaises(ValueError):
                    validate_mixed_cut_request(q)

    def test_unavailable_native_worker_never_publishes_step(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "not-a-step.step"
            result = execute(FIXTURE, worker=Path(d)/"absent", step_output=out)
            self.assertEqual(result["status"], "worker_crash", result)
            self.assertFalse(out.exists())

    @unittest.skipUnless(os.getenv("INTUIT3D_OCCT8_WORKER"),
                         "requires real pinned OCCT 8.0.1 C++ binary")
    def test_actual_pinned_cpp_round_blind_and_rect_through_step(self):
        with tempfile.TemporaryDirectory() as d:
            worker = Path(os.environ["INTUIT3D_OCCT8_WORKER"])
            results = []
            for thickness in (8, 12):
                q = copy.deepcopy(FIXTURE)
                q["plate"]["thickness"] = thickness
                q["cuts"][0]["cutDepthMm"] = 3 if thickness == 8 else 5
                q["cuts"][1]["cutDepthMm"] = thickness
                q["revision"] = thickness
                output = Path(d)/f"round-pocket-{thickness}.step"
                result = execute(q, worker=worker, step_output=output, timeout=120)
                self.assertEqual(result["status"], "validated_exact", result)
                validate_cut_result(q, {k:v for k,v in result.items() if k in (
                    "protocol","requestId","featureId","revision","backend","occtVersion",
                    "status","units","source","stepReadback","stepWritten")})
                self.assertGreater(output.stat().st_size, 256)
                self.assertEqual(len(result["source"]["cylindricalHoles"]), 3)
                results.append(result["stepSha256"])
            self.assertNotEqual(*results)


if __name__ == "__main__":
    unittest.main()
