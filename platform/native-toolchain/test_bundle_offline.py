"""Real ELF relocation and offline-integrity regressions (not OCCT geometry tests)."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

import bundle_offline as bundle


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc"),
                     "Linux native ELF toolchain unavailable")
class OfflineBundleTests(unittest.TestCase):

    def test_archive_relocation_and_python_execution_do_not_mutate_manifest(self):
        """Real extracted Python entrypoints must not write timestamped pyc files."""
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            root = base / "source"
            (root / "native").mkdir(parents=True)
            (root / "bin").mkdir()
            (root / "native/occt8_bridge.py").write_text(
                "import local_helper\nprint(local_helper.answer)\n")
            (root / "native/local_helper.py").write_text("answer = 42\n")
            (root / "bin/intuit3d_occt8_plate").write_bytes(b"test-only worker fixture")
            for source, target in (
                ("verify_offline_bundle.py", "verify.py"),
                ("offline_selftest.py", "selftest.py"),
                ("replay_evidence.py", "replay_evidence.py"),
            ):
                shutil.copy2(Path(__file__).with_name(source), root / target)
            bundle.launcher(root)
            files, links = bundle.inventory(root)
            manifest = {
                "schema": "intuit3d/pinned-occt801-offline-linux-bundle-v1",
                "occtSourceCommit": bundle.COMMIT,
                "kernelSourceCommit": "a" * 40,
                "workerSha256": bundle.sha256(root / "bin/intuit3d_occt8_plate"),
                "files": files,
                "links": links,
            }
            (root / "manifest.json").write_text(json.dumps(manifest))
            archive = base / "reproducible.tar.gz"
            bundle.write_archive(root, archive)
            relocated = base / "relocated"
            relocated.mkdir()
            with tarfile.open(archive, "r:gz") as package:
                package.extractall(relocated, filter="data")
            extracted = relocated / bundle.ARCHIVE_ROOT_NAME

            def verify():
                completed = subprocess.run(
                    [sys.executable, str(extracted / "verify.py")],
                    cwd=extracted, capture_output=True, text=True, check=False)
                self.assertEqual(completed.returncode, 0, completed.stderr)

            verify()
            launched = subprocess.run(
                [str(extracted / "run.sh")], cwd=extracted,
                capture_output=True, text=True, check=False)
            self.assertEqual(launched.returncode, 0, launched.stderr)
            self.assertEqual(launched.stdout.strip(), "42")
            # --help imports the bundled local replay module without needing
            # an OCCT installation; the physical replay remains a separate gate.
            help_run = subprocess.run(
                [sys.executable, str(extracted / "selftest.py"), "--help"],
                cwd=extracted, capture_output=True, text=True, check=False)
            self.assertEqual(help_run.returncode, 0, help_run.stderr)
            verify()
            self.assertFalse(list(extracted.rglob("__pycache__")))
            self.assertFalse(list(extracted.rglob("*.pyc")))
            self.assertEqual(bundle.inventory(extracted), (files, links))

    def test_inventory_rejects_generated_python_bytecode(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "__pycache__").mkdir()
            (root / "__pycache__/bridge.cpython-311.pyc").write_bytes(b"not stable")
            with self.assertRaisesRegex(bundle.BundleError, "runtime Python bytecode"):
                bundle.inventory(root)

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
            # Negative control: a real, otherwise functioning ELF which
            # resolves OCCT-named libraries from its old prefix must FAIL.
            # This protects the substantive bundle-custody invariant while
            # allowing normal bin/../lib loader path spelling.
            host_binary = root / "host-prefix-worker"
            subprocess.run([
                "cc", str(root / "main.c"), "-o", str(host_binary),
                "-L" + str(prefix), "-l:libTKernel.so.8.0",
                "-Wl,--disable-new-dtags", "-Wl,-rpath," + str(prefix),
                "-Wl,-rpath-link," + str(prefix)
            ], check=True, capture_output=True)
            self.assertEqual(subprocess.check_output([str(host_binary)]).strip(),
                             b"42")
            with self.assertRaisesRegex(bundle.BundleError,
                                        "unbundled OCCT library"):
                bundle.validate_elf_resolution(host_binary, dest)
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
            # GNU ld.so can report $ORIGIN/../lib without lexical
            # canonicalization. Verify the *actual resolved file*, not a
            # string prefix (the production resolver already refuses host
            # libraries and missing dependencies).
            resolution = bundle.validate_elf_resolution(binary, dest)
            resolved_math = [
                line.split("=>", 1)[1].split(" (", 1)[0].strip()
                for line in resolution.splitlines()
                if "libTKMath.so.8.0 =>" in line
            ]
            self.assertEqual(len(resolved_math), 1, resolution)
            self.assertEqual(Path(resolved_math[0]).resolve(strict=True),
                             staged.resolve(strict=True))
            self.assertNotIn(str(prefix), resolution)

    def test_pinned_extra_toolkit_dependency_closure_executes_after_relocation(self):
        """Reject the real TKDESTEP -> TKXCAF -> TKLCAF missing-library failure."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prefix = root / "vendor"
            lib = prefix / "lib"
            lib.mkdir(parents=True)
            portable = root / "portable"
            (portable / "bin").mkdir(parents=True)
            # The selected CMake build list is not its entire DT_NEEDED graph.
            # Include one worker-direct library and one unused installed toolkit.
            ordered = ("TKLCAF", "TKXCAF", "TKDirect", *bundle.TOOLKITS, "TKUnused")
            for name in ordered:
                if name == "TKLCAF":
                    code = "int lcaf(void) {return 40;}\n"
                    dependency = None
                elif name == "TKXCAF":
                    code = "extern int lcaf(void); int xcaf(void) {return lcaf()+1;}\n"
                    dependency = "TKLCAF"
                elif name == "TKDESTEP":
                    code = "extern int xcaf(void); int destep(void) {return xcaf()+1;}\n"
                    dependency = "TKXCAF"
                elif name == "TKDirect":
                    code = "int direct(void) {return 0;}\n"
                    dependency = None
                else:
                    code = "int otherwise_unused(void) {return 0;}\n"
                    dependency = None
                cfile = root / f"{name}.c"
                cfile.write_text(code)
                command = ["cc", "-shared", "-fPIC", str(cfile),
                           "-Wl,--disable-new-dtags", "-Wl,-rpath,$ORIGIN",
                           "-Wl,-soname,lib" + name + ".so.8.0",
                           "-o", str(lib / ("lib" + name + ".so.8.0"))]
                if dependency:
                    command += ["-L" + str(lib), "-l:lib" + dependency + ".so.8.0"]
                subprocess.run(command, check=True, capture_output=True)
                (lib / ("lib" + name + ".so")).symlink_to(
                    "lib" + name + ".so.8.0")
            worker_source = root / "worker.c"
            worker_source.write_text(
                '#include <stdio.h>\n'
                'extern int destep(void); extern int direct(void);\n'
                'int main(void) {printf("%d\\n", destep()+direct()); return 0;}\n')
            worker = portable / "bin" / "worker"
            subprocess.run(
                ["cc", str(worker_source), "-o", str(worker),
                 "-L" + str(lib), "-l:libTKDESTEP.so.8.0",
                 "-l:libTKDirect.so.8.0",
                 "-Wl,--disable-new-dtags", "-Wl,-rpath,$ORIGIN/../lib",
                 "-Wl,-rpath-link," + str(lib)],
                check=True, capture_output=True)
            target = portable / "lib"
            bundle.copy_toolkits(prefix, target, worker)
            for needed in ("TKDESTEP", "TKXCAF", "TKLCAF", "TKDirect"):
                self.assertTrue((target / f"lib{needed}.so.8.0").is_file(),
                                f"missing real DT_NEEDED closure library: {needed}")
            self.assertFalse((target / "libTKUnused.so.8.0").exists())
            self.assertIn("libTKLCAF.so.8.0",
                          subprocess.check_output(
                              ["readelf", "-d", str(target / "libTKXCAF.so.8.0")],
                              text=True))
            shutil.rmtree(prefix)
            self.assertEqual(subprocess.check_output([str(worker)]).strip(), b"42")
            # A missing transitive toolkit must fail during packaging rather
            # than allowing host OCCT to fulfil the dependency at execution.
            (lib).mkdir(parents=True)
            # Rebuild the dependency chain from staged genuine ELF bytes but
            # deliberately exclude TKLCAF's SONAME and physical copy.
            for staged in target.iterdir():
                if not staged.name.startswith("libTKLCAF"):
                    if staged.is_symlink():
                        (lib / staged.name).symlink_to(os.readlink(staged))
                    else:
                        shutil.copy2(staged, lib / staged.name)
            with self.assertRaisesRegex(bundle.BundleError,
                                        "missing transitive pinned OCCT toolkit: libTKLCAF"):
                bundle.copy_toolkits(prefix, root / "missing-transitive", worker)

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
