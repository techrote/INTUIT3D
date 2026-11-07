"""Test the offline installer with real compiled ELF bytes and FAKE gates.

These deliberately synthetic fixtures are not evidence of pinned OCCT8 geometry.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

import install_offline as target
import abi_compat as abi


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc"),
                     "Linux C compiler required")
class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.kernel_sha = "a" * 40
        self.bundle = self.root / "source-bundle"
        (self.bundle / "bin").mkdir(parents=True)
        (self.bundle / "lib").mkdir()
        (self.root / "math.c").write_text("int answer(void) {return 42;}\n")
        (self.root / "main.c").write_text(
            '#include <stdio.h>\nextern int answer(void);\n'
            'int main(void) {printf("%d\\n",answer()); return 0;}\n')
        real_lib = self.bundle / "lib/libTKMath.so.8.0"
        subprocess.run(["cc", "-shared", "-fPIC", str(self.root / "math.c"),
                        "-Wl,-soname,libTKMath.so.8.0", "-o", str(real_lib)],
                       check=True, capture_output=True)
        worker = self.bundle / "bin/intuit3d_occt8_plate"
        subprocess.run(["cc", str(self.root / "main.c"), "-o", str(worker),
                        "-L" + str(self.bundle / "lib"), "-l:libTKMath.so.8.0",
                        "-Wl,--disable-new-dtags", "-Wl,-rpath,$ORIGIN/../lib"],
                       check=True, capture_output=True)
        (self.bundle / "lib/libTKMath.so").symlink_to(real_lib.name)
        worker_sha = target.sha256(worker)
        self.manifest = {
            "schema": target.BUNDLE_SCHEMA, "occtVersion": "8.0.1",
            "occtSourceCommit": target.OCCT_SHA,
            "kernelSourceCommit": self.kernel_sha,
            "nativeCppExecuted": True, "independentCadInteroperability": False,
            "workerSha256": worker_sha,
            "elfAbiProfile": abi.symbol_profile(worker, self.bundle / "lib"),
        }
        (self.bundle / "manifest.json").write_text(json.dumps(self.manifest))
        (self.bundle / "verify.py").write_text(
            'import pathlib, hashlib, json\n'
            'root=pathlib.Path(__file__).parent\n'
            'doc=json.loads((root/"manifest.json").read_text())\n'
            'p=root/"bin/intuit3d_occt8_plate"\n'
            'assert hashlib.sha256(p.read_bytes()).hexdigest()==doc["workerSha256"]\n')
        self.test_result = {
            "status": "OFFLINE_CXX_REPLAY_PASS",
            "kernelSourceCommit": self.kernel_sha, "workerSha256": worker_sha,
            "dimensionEditExecuted": True, "dimensionsRestored": True,
            "cases": {"8": {}, "12": {}, "edited8": {}, "restored8": {}},
        }
        (self.bundle / "selftest.py").write_text(
            'import json\nprint(json.dumps(' + repr(self.test_result) + '))\n')
        (self.bundle / "run.sh").write_text('#!/bin/sh\nexec "$(dirname "$0")/bin/intuit3d_occt8_plate"\n')
        (self.bundle / "run.sh").chmod(0o755)
        self.archive = self.root / "bundle.tar.gz"
        self.write_archive()
        self.destination = self.root / "installed" / "occt8"

    def write_archive(self):
        with tarfile.open(self.archive, "w:gz") as t:
            t.add(self.bundle, arcname=target.ROOT_NAME)
        self.digest = target.sha256(self.archive)

    def test_real_compiled_elf_installed_and_executable(self):
        info = target.install(self.archive, self.destination,
                              self.digest, self.kernel_sha)
        self.assertEqual(info["status"], "OFFLINE_OCCT8_INSTALL_PASS")
        self.assertEqual(info["nativeReplayCases"],
                         ["12", "8", "edited8", "restored8"])
        self.assertEqual(subprocess.check_output([info["workerPath"]]).strip(), b"42")
        self.assertTrue((self.destination / "lib/libTKMath.so").is_symlink())

    def test_digest_and_kernel_source_are_strictly_required(self):
        with self.assertRaisesRegex(target.InstallError, "SHA-256 mismatch"):
            target.install(self.archive, self.destination, "0" * 64,
                           self.kernel_sha)
        with self.assertRaisesRegex(target.InstallError, "source manifest"):
            target.install(self.archive, self.destination, self.digest,
                           "b" * 40)
        self.assertFalse(self.destination.exists())

    def test_failing_native_replay_does_not_publish_or_leave_temp(self):
        (self.bundle / "selftest.py").write_text(
            'import json\nprint(json.dumps({"status":"source_only"}))\n')
        self.write_archive()
        with self.assertRaisesRegex(target.InstallError, "did not pass"):
            target.install(self.archive, self.destination, self.digest,
                           self.kernel_sha)
        self.assertFalse(self.destination.exists())
        self.assertEqual(list(self.destination.parent.glob('.intuit3d-occt8-stage-*')), [])

    def test_refuses_unsafe_member_and_missing_executable(self):
        with tarfile.open(self.archive, "w:gz") as tar:
            info = tarfile.TarInfo('../outside')
            info.size = 3
            import io
            tar.addfile(info, io.BytesIO(b'BAD'))
        with self.assertRaisesRegex(target.InstallError, "unsafe archive path"):
            target.install(self.archive, self.destination,
                           target.sha256(self.archive), self.kernel_sha)
        self.assertFalse(self.destination.exists())

    def test_rejects_false_abi_profile_even_with_correct_archive_sha(self):
        self.manifest["elfAbiProfile"]["requiredVersions"]["GLIBC"] = "9.99"
        (self.bundle / "manifest.json").write_text(json.dumps(self.manifest))
        self.write_archive()
        with self.assertRaisesRegex(abi.ABIError, "differs from attested"):
            target.install(self.archive, self.destination,
                           self.digest, self.kernel_sha)
        self.assertFalse(self.destination.exists())

    def test_refuses_destination_overwrite(self):
        self.destination.mkdir(parents=True)
        (self.destination / "untouched").write_text('original')
        with self.assertRaisesRegex(target.InstallError, "already exists"):
            target.install(self.archive, self.destination, self.digest,
                           self.kernel_sha)
        self.assertEqual((self.destination / "untouched").read_text(), 'original')


if __name__ == '__main__':
    unittest.main()
