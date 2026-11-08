"""Pinned v6 progressive selected profile: zero/one/two cut C++ physical cases."""
import copy
import hashlib
import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from occt8_linear_contract import (
    FLEX_SCHEMA,validate_flexible_linear_request,
    canonical_flexible_linear_request,expected_flexible_linear_metrics,
    validate_linear_request)
from occt8_bridge import canonical_request,execute

BASE=json.loads((ROOT/"examples"/"occt8-sloped-bracket-linear.request.json").read_text())
WORKER=os.environ.get("INTUIT3D_OCCT8_WORKER")

def request(cut_count,thickness=8):
    q=copy.deepcopy(BASE)
    q["protocol"]=FLEX_SCHEMA
    q["profile"]["thickness"]=thickness
    q["cuts"]=q["cuts"][:cut_count]
    if cut_count==2:q["cuts"][1]["cutDepthMm"]=thickness
    q["revision"]=20+cut_count*2+(thickness==12)
    q["requestId"]=f"native.progressive.v6.{cut_count}.{thickness}"
    return q

class ProgressiveV6Tests(unittest.TestCase):
    def test_progressive_geometry_and_canonical_wire(self):
        for n in range(3):
            for t in (8,12):
                with self.subTest(cuts=n,thickness=t):
                    q=request(n,t)
                    self.assertEqual(validate_flexible_linear_request(q),q)
                    self.assertEqual(canonical_request(q),canonical_flexible_linear_request(q))
                    self.assertIn(f"sketch.sloped.bracket {t} 6 {n}",canonical_request(q))
                    v,a=expected_flexible_linear_metrics(q)
                    removed=(75*3.141592653589793 if n>=1 else 0)+(
                        112*t if n==2 else 0)
                    self.assertAlmostEqual(v,5700*t-removed,places=7)
                    self.assertGreater(a,0)
                    v5=copy.deepcopy(q)
                    v5["protocol"]="intuit3d/kernel/linear-profile-cut-chain-v5"
                    if n<2:
                        with self.assertRaises(ValueError):
                            validate_linear_request(v5)
                    else:
                        self.assertEqual(validate_linear_request(v5),v5)

    def test_reject_bad_identity_units_orientation_and_overlap(self):
        for mutation in (
            lambda q:q.update(units="inch"),
            lambda q:q["cuts"][0].update(featureId=q["featureId"]),
            lambda q:q["profile"]["vertices"].reverse(),
            lambda q:q["cuts"].append(copy.deepcopy(BASE["cuts"][0])),
            lambda q:q["cuts"].__setitem__(0,{**q["cuts"][0],"x":55,"y":50}),
            lambda q:q["cuts"].extend(copy.deepcopy(BASE["cuts"])*9),
        ):
            q=request(2)
            mutation(q)
            with self.assertRaises(ValueError):
                validate_flexible_linear_request(q)

    @unittest.skipUnless(WORKER,"PINNED_CXX_SKIPPED: real OCCT 8.0.1 worker absent")
    def test_real_cpp_progressive_solid_and_six_step_artifacts(self):
        worker=Path(WORKER)
        self.assertTrue(worker.is_file(),WORKER)
        digests=set()
        with tempfile.TemporaryDirectory(prefix="intuit-v6-cxx-") as d:
            for n in range(3):
                for t in (8,12):
                    q=request(n,t)
                    output=Path(d)/f"progressive-{n}-{t}.step"
                    result=execute(q,worker=worker,step_output=output,timeout=120)
                    self.assertEqual(result["status"],"validated_exact",result)
                    volume,area=expected_flexible_linear_metrics(q)
                    for name in ("source","stepReadback"):
                        self.assertTrue(result[name]["valid"])
                        self.assertEqual(result[name]["solidCount"],1)
                        self.assertAlmostEqual(result[name]["volumeMm3"],volume,places=5)
                        self.assertAlmostEqual(result[name]["surfaceAreaMm2"],area,places=5)
                        self.assertEqual(len(result[name]["cylindricalHoles"]),int(n>0))
                    digest=hashlib.sha256(output.read_bytes()).hexdigest()
                    self.assertEqual(digest,result["stepSha256"])
                    self.assertNotIn(digest,digests)
                    digests.add(digest)
                    refused=execute(q,worker=worker,step_output=output,timeout=120)
                    self.assertEqual(refused["status"],"requires_reconciliation")
                    self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(),digest)
            self.assertEqual(len(digests),6)

    @unittest.skipUnless(WORKER,"PINNED_CXX_SKIPPED: real OCCT 8.0.1 worker absent")
    def test_real_cpp_refuses_bad_v6_canonical_wires_without_artifacts(self):
        """Exercise the compiled C++ parser directly, not Python's preflight.

        The ordinary bridge validates before spawning the C++ worker; these
        deliberately malformed canonical wires must instead be rejected by
        the *actual* pinned executable before STEP/report publication.
        """
        worker=Path(WORKER).resolve()
        self.assertTrue(worker.is_file(),WORKER)
        good=canonical_flexible_linear_request(request(2))

        def malformed(change):
            q=request(2)
            change(q)
            return canonical_flexible_linear_request(q)

        def reverse_vertices(q):
            q["profile"]["vertices"].reverse()

        def repeat_vertex(q):
            q["profile"]["vertices"][1]=dict(q["profile"]["vertices"][0])

        def move_cut_outside(q):
            q["cuts"][0]["x"]=130

        def overlap_cuts(q):
            q["cuts"][1]["x"]=q["cuts"][0]["x"]
            q["cuts"][1]["y"]=q["cuts"][0]["y"]

        def duplicate_cut_identity(q):
            q["cuts"][1]["featureId"]=q["cuts"][0]["featureId"]

        def alias_target_body(q):
            q["cuts"][0]["featureId"]=q["featureId"]

        bad_cases=(
            ("unknown-protocol",good.replace(
                "INTUIT3D_OCCT8_FLEX_LINEAR_CHAIN_V6",
                "INTUIT3D_OCCT8_FLEX_LINEAR_CHAIN_V7",1),
                "invalid canonical request protocol"),
            ("trailing-token",good+"UNEXPECTED_TOKEN\\n","trailing request data"),
            ("clockwise-wire",malformed(reverse_vertices),
                "linear contour needs CCW positive area"),
            ("zero-length-edge",malformed(repeat_vertex),
                "invalid linear contour coordinates or edge"),
            ("outside-cutter",malformed(move_cut_outside),
                "invalid ordered cut extent"),
            ("overlapping-cutters",malformed(overlap_cuts),
                "cut footprints overlap or touch"),
            ("duplicate-feature-id",malformed(duplicate_cut_identity),
                "duplicate cut feature identity"),
            ("cut-aliases-target-body",malformed(alias_target_body),
                "cut feature identity conflicts with target body"),
        )
        with tempfile.TemporaryDirectory(prefix="intuit-v6-native-refusal-") as d:
            directory=Path(d)
            for name,wire,diagnostic in bad_cases:
                with self.subTest(case=name):
                    request_path=directory/f"{name}.request"
                    report_path=directory/f"{name}.json"
                    step_path=directory/f"{name}.step"
                    request_path.write_text(wire,encoding="ascii")
                    completed=subprocess.run(
                        [str(worker),str(request_path),str(report_path),
                         str(step_path)],cwd=directory,
                        stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                        timeout=30,check=False)
                    self.assertEqual(completed.returncode,2,
                        (name,completed.stdout,completed.stderr))
                    self.assertIn(diagnostic,
                        completed.stderr.decode("utf-8","replace"),name)
                    self.assertFalse(report_path.exists(),
                        name+": rejected C++ request published a report")
                    self.assertFalse(step_path.exists(),
                        name+": rejected C++ request published STEP bytes")

if __name__=="__main__":
    unittest.main()
