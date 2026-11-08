"""Real subprocess regression tests for ambient process-hook isolation.

These tests establish admission process custody, NOT physical OCCT8 geometry.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from execution_environment import sealed_env
from install_offline import run_gate


class HermeticEnvironmentTests(unittest.TestCase):
    def test_host_preloads_and_provider_overrides_are_dropped(self):
        hostile = {
            "NODE_OPTIONS": "--import=/tmp/hook.mjs",
            "NODE_PATH": "/tmp/foreign",
            "PYTHONPATH": "/tmp/foreign",
            "PYTHONHOME": "/tmp/foreign",
            "LD_PRELOAD": "/tmp/foreign.so",
            "LD_LIBRARY_PATH": "/tmp/foreign",
            "BASH_ENV": "/tmp/hook.sh",
            "ENV": "/tmp/hook.sh",
            "INTUIT3D_ANVIL_STEP_PROBE": "/tmp/foreign",
            "INTUIT3D_OCCT8_WORKER": "/tmp/foreign",
        }
        with mock.patch.dict(os.environ, hostile):
            safe = sealed_env()
        for key in hostile:
            self.assertNotIn(key, safe)
        self.assertEqual(safe["PYTHONDONTWRITEBYTECODE"], "1")
        self.assertEqual(safe["PATH"], os.environ["PATH"])

    @unittest.skipUnless(shutil.which("node"), "Node.js required")
    def test_real_node_startup_preload_forges_stdout_but_sealed_run_does_not(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            real = root / "real.mjs"
            spoof = root / "spoof.mjs"
            real.write_text("console.log('GENUINE_EXECUTION');\n")
            spoof.write_text("console.log('FORGED_RECEIPT'); process.exit(0);\n")
            ambient = dict(os.environ, NODE_OPTIONS="--import=" + str(spoof))
            compromised = subprocess.run(["node", str(real)], env=ambient,
                                         capture_output=True, text=True, timeout=15)
            self.assertEqual(compromised.returncode, 0)
            self.assertEqual(compromised.stdout.strip(), "FORGED_RECEIPT")
            sealed = subprocess.run(["node", str(real)], env=sealed_env(),
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(sealed.returncode, 0, sealed.stderr)
            self.assertEqual(sealed.stdout.strip(), "GENUINE_EXECUTION")

    def test_offline_verifier_does_not_import_foreign_python_module(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            foreign = root / "foreign"
            foreign.mkdir()
            marker = root / "injected"
            (foreign / "json.py").write_text(
                "from pathlib import Path\n"
                + f"Path({str(marker)!r}).write_text('injected')\n"
                + "raise RuntimeError('foreign module loaded')\n")
            with mock.patch.dict(os.environ, {"PYTHONPATH": str(foreign)}):
                output = run_gate(
                    [sys.executable, "-c",
                     "import json; print(json.dumps({'genuine': True}))"],
                    root, "offline JSON verifier", 15)
            self.assertEqual(output.strip(), '{"genuine": true}')
            self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
