"""Real ELF relocation and offline-integrity regressions (not OCCT geometry tests)."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import bundle_offline as bundle


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc"),
                     "Linux native ELF toolchain unavailable")
class OfflineBundleTests(unittest.TestCase):
    def test_real_compiled_transitive_elf_relocation(self):
        """Genuinely compiled DT_NEEDED transitive libs load after prefix removal."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prefix = root / "prefix/lib"
            prefix.mkdir(parents=True)
            dest = root / "portable/lib"
            (root / "portable/bin").mkdir(parents=True)
            (root / "math.c").write_text("int maths(void) {return 42;}\n")
            (root / "kernel.c").write_text("extern int maths(void); int kernel(void) {return maths();}\n")
            (root / "main.c").write_text(
                '#include <stdio.h>\nextern int kernel(void);\n'
                'int main(void) {printf("%d\\n", kernel()); return 0;}\n')
            # Link the transitive TKMath dependency before TKernel.
            for name in ("TKMath", *[n for n in bundle.TOOLKITS if n != "TKMath"]):
                source = root / ("math.c" if name == "TKMath" else
                                 "kernel.c" if name == "TKernel" else "math.c")
                cmd = ["cc", "-shared", "-fPIC", str(source), "-o",
                       str(prefix / f"lib{name}.so.8.0"),
                       f"-Wl,-soname,lib{name}.so.8.0"]
                if name == "TKernel":
                    cmd.extend(["-L" + str(prefix), "-l:libTKMath.so.8.0"])
                subprocess.run(cmd, check=True, capture_output=True)
                (prefix / f"lib{name}.so").symlink_to(f"lib{name}.so.8.0")
            exe = root / "portable/bin/worker"
            subprocess.run([
                "cc", str(root / "main.c"), "-o", str(exe),
                "-L" + str(prefix), "-l:libTKernel.so.8.0",
                "-Wl,--disable-new-dtags", "-Wl,-rpath,$ORIGIN/../lib",
                "-Wl,-rpath-link," + str(prefix)
            ], check=True, capture_output=True)
            bundle.copy_toolkits(root / "prefix", dest)
            self.assertIn("libTKMath.so.8.0", bundle.validate_elf_resolution(exe, dest))
            self.assertEqual(subprocess.check_output([str(exe)]).strip(), b"42")
            shutil.rmtree(root / "prefix")
            self.assertEqual(subprocess.check_output([str(exe)]).strip(), b"42")
            self.assertEqual(len(list(dest.glob("lib*.so"))), len(bundle.TOOLKITS))

    @unittest.skipUnless(shutil.which("patchelf"), "requires real patchelf")
    def test_copied_toolkit_removes_obsolete_build_prefix_rpath(self):
        """Actual linked ELF must survive after its vendor install disappears."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prefix = root / "vendor/lib"
            dest = root / "relocated/lib"
            (root / "relocated/bin").mkdir(parents=True)
            prefix.mkdir(parents=True)
            dest.mkdir()
            (root / "math.c").write_text("int answer(void) {return 42;}\n")
            (root / "main.c").write_text(
                '#include <stdio.h>\nextern int answer(void);\n'
                'int main(void) {printf("%d\\n", answer()); return 0;}\n')
            original = prefix / "libTKMath.so.8.0"
            subprocess.run([
                "cc", "-shared", "-fPIC", str(root / "math.c"),
                "-Wl,-soname,libTKMath.so.8.0", "-Wl,--disable-new-dtags",
                "-Wl,-rpath," + str(prefix), "-o", str(original)
            ], check=True, capture_output=True)
            staged = dest / original.name
            shutil.copy2(original, staged)
            before = subprocess.check_output(["readelf", "-d", str(staged)], text=True)
            self.assertIn(str(prefix), before)
            bundle.relocate_toolkits(dest)
            after = subprocess.check_output(["readelf", "-d", str(staged)], text=True)
            self.assertIn("[$ORIGIN]", after)
            self.assertNotIn(str(prefix), after)
            binary = root / "relocated/bin/worker"
            subprocess.run([
                "cc", str(root / "main.c"), "-o", str(binary),
                "-L" + str(dest), "-l:libTKMath.so.8.0",
                "-Wl,--disable-new-dtags", "-Wl,-rpath,$ORIGIN/../lib"
            ], check=True, capture_output=True)
            shutil.rmtree(root / "vendor")
            self.assertEqual(subprocess.check_output([str(binary)]).strip(), b"42")
            self.assertIn(str(staged), bundle.validate_elf_resolution(binary, dest))

    def test_standalone_hash_verifier_refuses_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "bin").mkdir()
            binary = root / "bin/intuit3d_occt8_plate"
            binary.write_bytes(b"test-only ELF hash fixture")
            shutil.copy2(Path(__file__).with_name("verify_offline_bundle.py"),
                         root / "verify.py")
            dig = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
            manifest = {
                "schema": "intuit3d/pinned-occt801-offline-linux-bundle-v1",
                "occtSourceCommit": bundle.COMMIT,
                "kernelSourceCommit": "a" * 40,
                "workerSha256": dig(binary),
                "files": {
                    "bin/intuit3d_occt8_plate": dig(binary),
                    "verify.py": dig(root / "verify.py"),
                },
                "links": {},
            }
            (root / "manifest.json").write_text(json.dumps(manifest))
            def check() -> subprocess.CompletedProcess:
                return subprocess.run([sys.executable, str(root / "verify.py")],
                                      capture_output=True, text=True)
            self.assertEqual(check().returncode, 0)
            binary.write_bytes(binary.read_bytes() + b"tamper")
            self.assertEqual(check().returncode, 2)


if __name__ == "__main__":
    unittest.main()
