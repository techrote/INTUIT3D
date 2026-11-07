"""Versioned C++ bridge contract; actual native tests gated on provisioned 8.0.1."""
from __future__ import annotations
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
if __name__ == "__main__": unittest.main()
