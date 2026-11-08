"""Restart pin/immutability regressions; synthetic ELF is not OCCT qualification."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import abi_compat as abi
import resume_offline as target


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc")
                     and shutil.which("readelf") and shutil.which("ldd"),
                     "Linux ELF toolchain required")
class OfflineRestartTests(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.root = Path(work.name)
        self.destination = self.root / "prefix" / "chosen-local-install"
        (self.destination / "lib").mkdir(parents=True)
        (self.destination / "bin").mkdir()
        self.kernel = "a" * 40
        (self.root / "lib.c").write_text("int forty_two(void){return 42;}\n")
        (self.root / "main.c").write_text(
            '#include <stdio.h>\nextern int forty_two(void);\n'
            'int main(void){printf("%d\\n",forty_two());return 0;}\n')
        library = self.destination / "lib" / "libTKMath.so.8.0"
        worker = self.destination / "bin" / "intuit3d_occt8_plate"
        subprocess.run(["cc", "-shared", "-fPIC", str(self.root / "lib.c"),
                        "-Wl,-soname,libTKMath.so.8.0", "-o", str(library)],
                       check=True, capture_output=True)
        (self.destination / "lib/libTKMath.so").symlink_to(library.name)
        subprocess.run(["cc", str(self.root / "main.c"), "-o", str(worker),
                        "-L" + str(self.destination / "lib"), "-l:libTKMath.so.8.0",
                        "-Wl,--disable-new-dtags", "-Wl,-rpath,$ORIGIN/../lib"],
                       check=True, capture_output=True)
        (self.destination / "verify.py").write_text(
            'print("OCCT801_OFFLINE_BUNDLE_VERIFY_PASS synthetic")\n')
        selftest = {"status": "OFFLINE_CXX_REPLAY_PASS", "kernelSourceCommit": self.kernel,
                    "workerSha256": target.sha256(worker),
                    "dimensionEditExecuted": True, "dimensionsRestored": True,
                    "cases": {name: {} for name in ("8", "12", "edited8", "restored8")}}
        (self.destination / "selftest.py").write_text(
            "import json\nprint(json.dumps(" + repr(selftest) + "))\n")
        (self.destination / "run.sh").write_text("#!/bin/sh\necho synthetic\n")
        self.manifest = {
            "schema": target.BUNDLE_SCHEMA, "occtVersion": "8.0.1",
            "occtSourceCommit": target.OCCT_SHA,
            "kernelSourceCommit": self.kernel, "workerSha256": target.sha256(worker),
            "nativeCppExecuted": True, "independentCadInteroperability": False,
            "elfAbiProfile": abi.symbol_profile(worker, self.destination / "lib"),
        }
        self.write_manifest()

    def write_manifest(self):
        files = {}
        links = {}
        for path in self.destination.rglob("*"):
            rel = path.relative_to(self.destination).as_posix()
            if rel == "manifest.json":
                continue
            if path.is_symlink():
                links[rel] = path.readlink().as_posix()
            elif path.is_file():
                files[rel] = target.sha256(path)
        self.manifest["files"] = files
        self.manifest["links"] = links
        manifest = self.destination / "manifest.json"
        manifest.write_text(json.dumps(self.manifest, sort_keys=True))
        self.manifest_digest = target.sha256(manifest)

    def resume(self, replay=False):
        return target.resume(self.destination, self.manifest_digest,
                             self.kernel, self.manifest["workerSha256"], replay)

    def test_independent_restarts_still_resolve_copied_elf(self):
        first = self.resume(replay=True)
        second = self.resume()
        self.assertEqual(first["status"], "OFFLINE_OCCT8_RESUME_PASS")
        self.assertTrue(first["nativeReplayExecuted"])
        self.assertFalse(second["nativeReplayExecuted"])
        self.assertEqual(first["workerPath"], second["workerPath"])
        self.assertEqual(subprocess.check_output([first["workerPath"]]).strip(), b"42")

    def test_manifest_edit_fails_before_running_bundle(self):
        (self.destination / "manifest.json").write_text("{}")
        with self.assertRaisesRegex(target.InstallError, "manifest differs"):
            self.resume()

    def test_modified_verifier_cannot_execute_before_inventory_check(self):
        marker = self.root / "injected"
        (self.destination / "verify.py").write_text(
            f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
        with self.assertRaisesRegex(target.InstallError, "inventory differs"):
            self.resume()
        self.assertFalse(marker.exists())

    def test_library_soname_redirection_fails_closed(self):
        link = self.destination / "lib/libTKMath.so"
        link.unlink()
        link.symlink_to("/tmp/forged-occt.so")
        with self.assertRaises(target.InstallError):
            self.resume()

    def test_extra_file_and_worker_tamper_are_rejected(self):
        (self.destination / "native-foreign.py").write_text("print('hi')\n")
        with self.assertRaisesRegex(target.InstallError, "inventory differs"):
            self.resume()
        (self.destination / "native-foreign.py").unlink()
        with (self.destination / "bin/intuit3d_occt8_plate").open("ab") as stream:
            stream.write(b"tampered")
        with self.assertRaisesRegex(target.InstallError, "inventory differs"):
            self.resume()

    def test_requires_independent_source_pins(self):
        with self.assertRaisesRegex(target.InstallError, "immutable"):
            target.resume(self.destination, "not-a-sha", self.kernel,
                          self.manifest["workerSha256"])
        with self.assertRaisesRegex(target.InstallError, "source pins"):
            target.resume(self.destination, self.manifest_digest, "b" * 40,
                          self.manifest["workerSha256"])


if __name__ == "__main__":
    unittest.main()
