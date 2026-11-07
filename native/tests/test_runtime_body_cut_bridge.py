"""Native physical smoke: actual accepted semantic two-sketch cut -> OCP STEP.

Not a pinned OCCT 8.0.1 or independent CAD test. This intentionally invokes
the real Node producer rather than a synthetic request/response fake.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "packages/kernel-contract/examples/runtime-body-cut-native.mjs"


class RuntimeBodyCutPhysicalTest(unittest.TestCase):
    def test_authored_two_sketch_cut_and_retrospective_edit_to_step(self):
        with tempfile.TemporaryDirectory(prefix="intuit3d-runtime-bodycut-") as folder:
            env = dict(os.environ, INTUIT3D_OCP_PYTHON=os.environ.get(
                "INTUIT3D_OCP_PYTHON", sys.executable))
            result = subprocess.run(
                ["node", str(DEMO), folder], cwd=ROOT, env=env,
                capture_output=True, text=True, timeout=120, check=False
            )
            self.assertEqual(result.returncode, 0, result.stdout[-2000:] + result.stderr[-3000:])
            manifest = json.loads((Path(folder) / "manifest.json").read_text())
            self.assertEqual(manifest["execution"], "real-OCP-7.9.3.1-experimental")
            self.assertFalse(manifest["qualifiedOCCT8Cxx"])
            self.assertFalse(manifest["independentCadInterop"])
            changes = manifest["invalidation"]["invalidatedFeatureIds"]
            self.assertIn("extrude.bracket", changes)
            self.assertIn("cut.window", changes)
            self.assertNotIn("sketch.window", changes)
            records = manifest["results"]
            self.assertEqual(len(records), 2)
            self.assertEqual([v["extrusionDepthMm"] for v in records], [8, 14])
            self.assertEqual(records[0]["bodyId"], records[1]["bodyId"])
            self.assertNotEqual(records[0]["stepSha256"], records[1]["stepSha256"])
            for record in records:
                expected = (11800 - 36 * 3.141592653589793 - 192) * record["extrusionDepthMm"]
                self.assertAlmostEqual(record["volumeMm3"], expected, delta=1e-6)
                data = (Path(folder) / (record["label"] + ".step")).read_bytes()
                self.assertTrue(data.startswith(b"ISO-10303-21;"))
                self.assertGreater(len(data), 1000)
                self.assertEqual(record["stepBytes"], len(data))
                self.assertEqual(record["stepSha256"], hashlib.sha256(data).hexdigest())
            restored = json.loads((Path(folder) / "history.json").read_text())
            self.assertIn("history", restored)


if __name__ == "__main__":
    unittest.main()
