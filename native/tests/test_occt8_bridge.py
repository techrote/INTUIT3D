"""Versioned C++ bridge contract; actual native tests gated on provisioned 8.0.1."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from occt8_bridge import canonical_request, execute
from protocol import validate_request

FIXTURE = {
 "protocol":"intuit3d/kernel/plate-v1","requestId":"fixture.cxx",
 "featureId":"plate.fixture","revision":7,"units":"mm",
 "plate":{"width":120,"depth":80,"thickness":8,
          "holes":[{"x":-30,"y":0,"radius":6},{"x":30,"y":0,"radius":6}]},
 "exportStep":True
}
class Occt8BridgeTests(unittest.TestCase):
    def test_canonical_wire_and_retrospective_thickness_change(self):
        original=canonical_request(validate_request(FIXTURE))
        edited=json.loads(json.dumps(FIXTURE));edited["plate"]["thickness"]=12
        self.assertIn("120 80 8 2",original)
        self.assertIn("120 80 12 2",canonical_request(validate_request(edited)))
        self.assertNotEqual(original,canonical_request(validate_request(edited)))

    def test_mismatched_destination_fails_before_native(self):
        with self.assertRaisesRegex(ValueError,"step_output"):
            execute(FIXTURE,worker=Path("/missing"))

    def test_missing_worker_is_crash_without_step_publication(self):
        with tempfile.TemporaryDirectory() as d:
            output=Path(d)/"missing.step"
            response=execute(FIXTURE,worker=Path(d)/"unavailable",step_output=output)
            self.assertEqual(response["status"],"worker_crash")
            self.assertFalse(output.exists())

    def test_timeout_has_no_published_file(self):
        with tempfile.TemporaryDirectory() as d:
            output=Path(d)/"timeout.step"
            with patch("occt8_bridge.run_isolated_worker",side_effect=subprocess.TimeoutExpired(["worker"],0.001)):
                response=execute(FIXTURE,worker=Path(d)/"worker",step_output=output)
            self.assertEqual(response["status"],"timeout")
            self.assertFalse(output.exists())

    def test_claimed_success_from_other_engine_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            output=Path(d)/"untrusted.step"
            def bogus(args, *, cwd, timeout):
                Path(args[2]).write_text(json.dumps({
                  "protocol":FIXTURE["protocol"],"requestId":FIXTURE["requestId"],
                  "featureId":FIXTURE["featureId"],"revision":FIXTURE["revision"],
                  "backend":"OCP-python-prototype","occtVersion":"7.9.3.1",
                  "status":"validated_exact","units":"mm","source":None,
                  "stepReadback":None,"stepWritten":True}))
                Path(args[3]).write_bytes(b"ISO-10303-21;"*40)
                return subprocess.CompletedProcess(args,0,b"",b"")
            with patch("occt8_bridge.run_isolated_worker",side_effect=bogus):
                response=execute(FIXTURE,worker=Path(d)/"worker",step_output=output)
            self.assertEqual(response["status"],"requires_reconciliation")
            self.assertFalse(output.exists())

    @unittest.skipUnless(importlib.util.find_spec("OCP"), "actual OCP STEP fixture unavailable")
    def test_actual_step_bytes_publication_and_separate_reader(self):
        """Real STEP bytes, fake C++ producer report, real supervised OCP reader.

        Does NOT claim that the OCCT 8.0.1 C++ executable was compiled.
        Exercises the successful bridge publication path, missed by failure tests.
        """
        import OCP
        if OCP.__version__ != "7.9.3.1":
            self.skipTest("cross-version reader version is not pinned")
        from ocp_worker import build_plate, save_and_reopen, solid_properties
        from process_supervision import run_isolated_worker as actual_run
        with tempfile.TemporaryDirectory() as d:
            worker=Path(d)/"mock-cxx-producer"
            for thickness in (8,12):
                request=json.loads(json.dumps(FIXTURE))
                request["plate"]["thickness"]=thickness
                request["revision"]=thickness
                destination=Path(d)/f"plate-{thickness}.step"
                def run(args, *, cwd, timeout):
                    if args[0] != str(worker.resolve()):
                        return actual_run(args,cwd=cwd,timeout=timeout)
                    shape=build_plate(request["plate"])
                    metrics=solid_properties(shape)
                    save_and_reopen(shape,Path(args[3]))
                    Path(args[2]).write_text(json.dumps({
                        "protocol":request["protocol"],"requestId":request["requestId"],
                        "featureId":request["featureId"],"revision":request["revision"],
                        "backend":"OCCT-cxx-8.0.1","occtVersion":"8.0.1",
                        "status":"validated_exact","units":"mm",
                        "source":metrics,"stepReadback":metrics,"stepWritten":True,
                    }),encoding="utf-8")
                    return subprocess.CompletedProcess(args,0,b"",b"")
                with patch("occt8_bridge.run_isolated_worker",side_effect=run):
                    result=execute(request,worker=worker,step_output=destination,
                                   cross_version_audit=True,part21_audit=True,timeout=25)
                self.assertEqual(result["status"],"validated_exact",result)
                self.assertEqual(result["stepVerification"],"occt-7.9.3.1-separate-process")
                self.assertEqual(result["part21Audit"]["kind"],"part21-plate-structural-v1")
                self.assertEqual(result["part21Audit"]["sha256"],result["stepSha256"])
                self.assertGreater(destination.stat().st_size,256)
                self.assertEqual(result["stepSha256"],
                                 hashlib.sha256(destination.read_bytes()).hexdigest())
                # Durable export is immutable, not silently overwritten.
                before=destination.read_bytes()
                with patch("occt8_bridge.run_isolated_worker",side_effect=run):
                    duplicate=execute(request,worker=worker,step_output=destination,timeout=25)
                self.assertEqual(duplicate["status"],"requires_reconciliation",duplicate)
                self.assertEqual(destination.read_bytes(),before)

    @unittest.skipUnless(importlib.util.find_spec("OCP"), "actual OCP STEP fixture unavailable")
    def test_displaced_real_step_bytes_are_rejected_before_publication(self):
        """Reject a material 5 mm hole movement absent from the C++ report."""
        import OCP
        if OCP.__version__ != "7.9.3.1":
            self.skipTest("cross-version reader version is not pinned")
        from ocp_worker import build_plate, save_and_reopen, solid_properties
        from process_supervision import run_isolated_worker as actual_run
        with tempfile.TemporaryDirectory() as d:
            worker=Path(d)/"mock-cxx-producer"
            destination=Path(d)/"must-not-publish.step"
            def run(args, *, cwd, timeout):
                if args[0] != str(worker.resolve()):
                    return actual_run(args,cwd=cwd,timeout=timeout)
                original=solid_properties(build_plate(FIXTURE["plate"]))
                altered=json.loads(json.dumps(FIXTURE["plate"]))
                altered["holes"][0]["x"]+=5
                save_and_reopen(build_plate(altered),Path(args[3]))
                Path(args[2]).write_text(json.dumps({
                    "protocol":FIXTURE["protocol"],"requestId":FIXTURE["requestId"],
                    "featureId":FIXTURE["featureId"],"revision":FIXTURE["revision"],
                    "backend":"OCCT-cxx-8.0.1","occtVersion":"8.0.1",
                    "status":"validated_exact","units":"mm",
                    "source":original,"stepReadback":original,"stepWritten":True,
                }),encoding="utf-8")
                return subprocess.CompletedProcess(args,0,b"",b"")
            with patch("occt8_bridge.run_isolated_worker",side_effect=run):
                result=execute(FIXTURE,worker=worker,step_output=destination,
                               cross_version_audit=True,part21_audit=True,timeout=25)
            self.assertEqual(result["status"],"requires_reconciliation",result)
            self.assertFalse(destination.exists())

    @unittest.skipUnless(os.environ.get("INTUIT3D_OCCT8_WORKER"),
                         "OCCT 8.0.1 C++ worker not built/provisioned")
    def test_real_cpp_build_edit_and_step(self):
        worker=Path(os.environ["INTUIT3D_OCCT8_WORKER"])
        with tempfile.TemporaryDirectory() as d:
            results=[]
            for thickness in (8,12):
                request=json.loads(json.dumps(FIXTURE))
                request["plate"]["thickness"]=thickness
                request["revision"]=thickness
                path=Path(d)/f"plate-{thickness}.step"
                result=execute(request,worker=worker,step_output=path)
                self.assertEqual(result["status"],"validated_exact",result)
                self.assertEqual(result["backend"],"OCCT-cxx-8.0.1")
                self.assertGreater(path.stat().st_size,256)
                results.append(result["source"]["volumeMm3"])
            self.assertGreater(results[1],results[0])
    @unittest.skipUnless(os.environ.get("INTUIT3D_OCCT8_WORKER"),
                         "genuine pinned OCCT8 C++ binary required for ordered cuts")
    def test_real_cpp_ordered_blind_pocket_and_through_window(self):
        """Run on the hosted OCCT8 C++ qualification job, never a mock."""
        from occt8_cut_contract import validate_cut_request, cut_metrics
        worker=Path(os.environ["INTUIT3D_OCCT8_WORKER"])
        fixture=Path(__file__).resolve().parents[1]/"examples"/"occt8-ordered-rect-cuts.request.json"
        authored=json.loads(fixture.read_text("utf-8"))
        volumes=[]
        hashes=[]
        with tempfile.TemporaryDirectory() as d:
            for thickness in (8,12):
                request=json.loads(json.dumps(authored))
                request["revision"]=thickness
                request["plate"]["thickness"]=thickness
                request["cuts"][1]["cutDepthMm"]=thickness
                if thickness==12:
                    request["cuts"][0]["cutDepthMm"]=5
                validate_cut_request(request)
                destination=Path(d)/f"ordered-{thickness}.step"
                response=execute(request,worker=worker,step_output=destination,timeout=120)
                self.assertEqual(response["status"],"validated_exact",response)
                self.assertEqual(response["backend"],"OCCT-cxx-8.0.1")
                self.assertEqual(response["stepVerification"],"occt-8.0.1-same-engine")
                self.assertTrue(destination.is_file())
                self.assertGreater(destination.stat().st_size,256)
                self.assertEqual(response["stepSha256"],hashlib.sha256(destination.read_bytes()).hexdigest())
                expected_volume,_=cut_metrics(request)
                self.assertAlmostEqual(response["source"]["volumeMm3"],expected_volume,places=5)
                volumes.append(response["source"]["volumeMm3"])
                hashes.append(response["stepSha256"])
        self.assertGreater(volumes[1],volumes[0])
        self.assertNotEqual(hashes[0],hashes[1])


    @unittest.skipUnless(os.environ.get("INTUIT3D_OCCT8_WORKER"),
                         "genuine pinned OCCT8 C++ binary required for mixed pockets")
    def test_real_cpp_circular_blind_pocket_and_rectangle_step(self):
        """Hosted pinned C++ qualification: actual circular and planar cutter B-reps."""
        from occt8_cut_contract import (
            validate_mixed_cut_request, cut_metrics, MIXED_SCHEMA,
        )
        fixture=Path(__file__).resolve().parents[1]/"examples"/"occt8-mixed-round-pockets.request.json"
        authored=json.loads(fixture.read_text("utf-8"))
        self.assertEqual(authored["protocol"], MIXED_SCHEMA)
        worker=Path(os.environ["INTUIT3D_OCCT8_WORKER"])
        with tempfile.TemporaryDirectory() as d:
            hashes=[]
            for thickness in (8, 12):
                request=json.loads(json.dumps(authored))
                request["revision"]=thickness
                request["plate"]["thickness"]=thickness
                request["cuts"][0]["cutDepthMm"]=3 if thickness==8 else 5
                request["cuts"][1]["cutDepthMm"]=thickness
                validate_mixed_cut_request(request)
                output=Path(d)/f"mixed-round-{thickness}.step"
                result=execute(request,worker=worker,step_output=output,timeout=120)
                self.assertEqual(result["status"], "validated_exact",result)
                self.assertEqual(result["backend"], "OCCT-cxx-8.0.1")
                self.assertTrue(output.is_file())
                self.assertGreater(output.stat().st_size,256)
                self.assertEqual(result["stepSha256"],hashlib.sha256(output.read_bytes()).hexdigest())
                self.assertEqual(len(result["source"]["cylindricalHoles"]),3)
                expected_volume,_=cut_metrics(request)
                self.assertAlmostEqual(result["source"]["volumeMm3"],expected_volume,places=5)
                hashes.append(result["stepSha256"])
            self.assertNotEqual(*hashes)


if __name__ == "__main__": unittest.main()
