"""Real subprocess regression tests for ambient process-hook isolation.

These tests establish admission process custody, NOT physical OCCT8 geometry.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from execution_environment import sealed_env
from bundle_offline import launcher
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
        self.assertEqual(safe["PYTHONNOUSERSITE"], "1")
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


    @unittest.skipUnless(sys.platform.startswith("linux"),
                         "HOME-based Python user-site repro requires Linux")
    def test_home_usercustomize_is_not_executed_by_sealed_python(self):
        # Removing PYTHONPATH alone does not prevent usercustomize.py in the
        # caller's HOME from running before the trusted Python script.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / "home"
            home.mkdir()
            marker = root / "user-site-hook-executed"
            python = getattr(sys, "_base_executable", sys.executable)
            ambient = dict(os.environ, HOME=str(home),
                           PYTHONDONTWRITEBYTECODE="1")
            for key in ("PYTHONNOUSERSITE", "PYTHONUSERBASE",
                        "PYTHONPATH", "PYTHONHOME"):
                ambient.pop(key, None)
            probe = subprocess.run(
                [python, "-c",
                 "import json,site; print(json.dumps({"
                 "'enabled': site.ENABLE_USER_SITE, "
                 "'path': site.getusersitepackages()}))"],
                env=ambient, capture_output=True, text=True, timeout=15,
                check=True)
            details = json.loads(probe.stdout)
            if details["enabled"] is not True:
                self.skipTest("base Python interpreter disables user site")
            user_site = Path(details["path"])
            user_site.mkdir(parents=True, exist_ok=True)
            (user_site / "usercustomize.py").write_text(
                "from pathlib import Path\n"
                + f"Path({str(marker)!r}).write_text('injected')\n")
            command = [python, "-c", "print('GENUINE_PYTHON')"]
            compromised = subprocess.run(command, env=ambient,
                                         capture_output=True, text=True,
                                         timeout=15, check=True)
            self.assertIn("GENUINE_PYTHON", compromised.stdout)
            self.assertTrue(marker.exists(), "negative startup hook did not execute")
            marker.unlink()
            with mock.patch.dict(os.environ, ambient, clear=True):
                protected = subprocess.run(command, env=sealed_env(),
                                           capture_output=True, text=True,
                                           timeout=15, check=True)
            self.assertEqual(protected.stdout.strip(), "GENUINE_PYTHON")
            self.assertFalse(marker.exists())

    @unittest.skipUnless(shutil.which("bash") and shutil.which("python3"),
                         "offline launcher requires Bash and Python 3")
    def test_standalone_offline_launcher_ignores_foreign_pythonpath(self):
        # The self-test installer is sealed, but a consumer can later invoke
        # run.sh directly. Exercise the actual launcher with a tiny bridge,
        # not a synthetic assessment of the string contents.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "native").mkdir()
            (root / "bin").mkdir()
            (root / "native/occt8_bridge.py").write_text(
                "import json; print(json.dumps({'source': 'bundle'}))\n")
            foreign = root / "foreign"
            foreign.mkdir()
            marker = root / "foreign-module-executed"
            (foreign / "json.py").write_text(
                "from pathlib import Path\n"
                + f"Path({str(marker)!r}).write_text('imported')\n"
                + "raise RuntimeError('host module shadowed bundled code')\n")
            launcher(root)
            hostile = dict(os.environ, PYTHONPATH=str(foreign))
            result = subprocess.run([str(root / "run.sh")], env=hostile,
                                    cwd=root, capture_output=True, text=True,
                                    timeout=15, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), '{"source": "bundle"}')
            self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
