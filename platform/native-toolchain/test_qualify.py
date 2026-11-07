"""Standard-library adversarial tests; synthetic prefix is NEVER native evidence."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("platform_qualify", Path(__file__).with_name("qualify.py"))
q = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(q)

class QualificationTests(unittest.TestCase):
    def prefix(self, root):
        root = Path(root)
        h = root / "include/opencascade/Standard_Version.hxx"
        h.parent.mkdir(parents=True)
        h.write_text('#define OCC_VERSION_COMPLETE "8.0.1"\n')
        config = root / "lib/cmake/opencascade/OpenCASCADEConfig.cmake"
        config.parent.mkdir(parents=True)
        config.write_text("# synthetic test-only fixture\n")
        (root / "RCS006_SOURCE_PIN.txt").write_text(
            "".join(f"{k}={v}\n" for k, v in q.PIN.items()))
        for name in q.TOOLKITS:
            (root / "lib" / f"lib{name}.so").write_bytes(b"\x7fELF-test-only")
        return root

    def request(self, thickness=8):
        return {"requestId": "test.plate", "featureId": "f.plate", "revision": thickness,
                "plate": {"width": 120, "depth": 80, "thickness": thickness,
                          "holes": [{"x": -30, "y": 0, "radius": 6},
                                    {"x": 30, "y": 0, "radius": 6}]}}

    def result(self, req, step):
        p = req["plate"]
        import math
        a = 120 * 80 - 2 * math.pi * 6**2
        v = a * p["thickness"]
        surface = 2 * a + (2 * (120 + 80) + 2 * 2 * math.pi * 6) * p["thickness"]
        holes = [{**h, "axisZ": 1} for h in p["holes"]]
        metric = {"valid": True, "solidCount": 1, "volumeMm3": v,
                  "surfaceAreaMm2": surface, "cylindricalHoles": holes}
        digest = q.sha256(step)
        return {"status": "validated_exact", "backend": "OCCT-cxx-8.0.1",
                "occtVersion": "8.0.1", "requestId": req["requestId"],
                "featureId": req["featureId"], "revision": req["revision"],
                "source": metric, "stepReadback": metric,
                "stepSha256": digest, "part21Audit": {"sha256": digest}}

    def test_preflight_rejects_wrong_commit(self):
        with tempfile.TemporaryDirectory() as d:
            prefix = self.prefix(d)
            pin = prefix / "RCS006_SOURCE_PIN.txt"
            pin.write_text(pin.read_text().replace(q.COMMIT, "0" * 40))
            with self.assertRaisesRegex(q.Blocked, "commit"):
                q.verify_prefix(prefix)

    def test_preflight_rejects_wrong_abi_and_missing_library(self):
        with tempfile.TemporaryDirectory() as d:
            prefix = self.prefix(d)
            (prefix / "lib/libTKDESTEP.so").unlink()
            with self.assertRaisesRegex(q.Blocked, "TKDESTEP"):
                q.verify_prefix(prefix)
            (prefix / "lib/libTKDESTEP.so").write_bytes(b"not an ELF")
            with self.assertRaisesRegex(q.Blocked, "not a Linux ELF"):
                q.verify_prefix(prefix)

    def test_preflight_does_not_qualify_native_execution(self):
        with tempfile.TemporaryDirectory() as d:
            record = q.verify_prefix(self.prefix(d))
            self.assertEqual(record["status"], "structural_preflight_only")
            self.assertEqual(len(record["libraries"]), 14)

    def test_source_pin_checked_before_build(self):
        with tempfile.TemporaryDirectory() as d:
            source = Path(d)
            (source / "CMakeLists.txt").write_text("fake source")
            def fake_run(argv, *, capture=False):
                self.assertTrue(capture)
                return "0" * 40 if "rev-parse" in argv else ""
            with self.assertRaisesRegex(q.Blocked, "does not match"):
                q.verify_source(source, fake_run)

    def test_geometry_and_step_integrity(self):
        with tempfile.TemporaryDirectory() as d:
            step = Path(d) / "real-cad-must-not-infer-from-test.step"
            step.write_bytes(b"ISO-10303-21;" * 32)
            req = self.request()
            report = self.result(req, step)
            checked = q.compare_geometry(report, req, step)
            self.assertEqual(checked["thicknessMm"], 8)
            self.assertEqual(checked["holes"], 2)
            report["source"]["cylindricalHoles"][0]["x"] = -25
            with self.assertRaisesRegex(q.Blocked, "misplaced"):
                q.compare_geometry(report, req, step)

    def test_wrong_digest_and_identity_refused(self):
        with tempfile.TemporaryDirectory() as d:
            step = Path(d) / "synthetic.step"
            step.write_bytes(b"ISO-10303-21;" * 32)
            req = self.request(12)
            r = self.result(req, step)
            r["revision"] -= 1
            with self.assertRaisesRegex(q.Blocked, "identity"):
                q.compare_geometry(r, req, step)
            r["revision"] += 1
            r["stepSha256"] = "0" * 64
            with self.assertRaisesRegex(q.Blocked, "sha256"):
                q.compare_geometry(r, req, step)

    def test_offline_missing_kernel_emits_blocked_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            command = [sys.executable, str(Path(__file__).with_name("qualify.py")),
                       "--kernel-tree", str(root / "kernel"),
                       "--prefix", str(root / "prefix"),
                       "--output", str(root / "evidence")]
            p = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(p.returncode, 2)
            report = json.loads((root / "evidence/qualification.json").read_text())
            self.assertEqual(report["status"], "BLOCKED")
            self.assertFalse(report["nativeCppExecuted"])
            self.assertFalse(report["independentCadInteroperability"])
            self.assertIn("Kernel PR #67", report["failure"])

if __name__ == "__main__":
    unittest.main()
