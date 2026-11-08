"""Offline archive must include the complete immutable KERNEL-002 bridge closure.

These synthetic Python import fixtures are not physical OCCT geometry tests.
"""
from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from bundle_offline import BundleError, copy_bridge, _imported_kernel_contracts


class KernelBridgeClosureTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.kernel = self.root / "checked-out-kernel"
        self.native = self.kernel / "native"
        (self.native / "occt8").mkdir(parents=True)
        self.target = self.root / "offline" / "native"
        self.write("plate_envelope.py", "PLATE=1\n")
        self.write("protocol.py", "IDENTITY=7\n")
        self.write("process_supervision.py", "SUPERVISE=True\n")
        self.write("occt8/part21_oracle.py", "ORACLE=True\n")
        self.write("occt8_bridge.py", (
            "from plate_envelope import PLATE\n"
            "from process_supervision import SUPERVISE\n"
            "from protocol import IDENTITY\n"
            "from occt8_profile_contract import PROFILE\n"
            "from occt8_orthogonal_contract import ORTHOGONAL\n"
            "from occt8_cut_contract import CUT\n"
            "assert PROFILE == 11 and ORTHOGONAL == 13 and CUT == 17\n"
        ))
        self.write("occt8_profile_contract.py",
                   "from occt8_cut_contract import CUT\nPROFILE=11\n")
        self.write("occt8_orthogonal_contract.py",
                   "from occt8_cut_contract import CUT\nORTHOGONAL=13\n")
        self.write("occt8_cut_contract.py",
                   "from protocol import IDENTITY\nCUT=17\n")

    def write(self, name: str, data: str):
        p = self.native / name
        p.write_text(data, encoding="utf-8")

    def test_source_matched_profile_orthogonal_and_cut_imports_execute_offline(self):
        copy_bridge(self.kernel, self.target)
        self.assertEqual(
            {p.name for p in self.target.glob("*_contract.py")},
            {"occt8_cut_contract.py", "occt8_profile_contract.py",
             "occt8_orthogonal_contract.py"},
        )
        # -I excludes host user-site / PYTHONPATH; only the staged copied
        # bridge may satisfy imports, not the source repository.
        process = subprocess.run(
            [sys.executable, "-I", "-c",
             "import sys; sys.path.insert(0, sys.argv[1]); import occt8_bridge",
             str(self.target)], capture_output=True, text=True, check=False)
        self.assertEqual(process.returncode, 0, process.stderr)

    def test_missing_required_orthogonal_contract_fails_closed(self):
        (self.native / "occt8_orthogonal_contract.py").unlink()
        with self.assertRaisesRegex(BundleError,
                                    "missing/unsafe source-matched Kernel contract"):
            copy_bridge(self.kernel, self.target)

    def test_transitive_imports_cannot_silently_fall_back_to_host(self):
        self.write("occt8_profile_contract.py",
                   "from occt8_new_future_contract import FUTURE\nPROFILE=11\n")
        with self.assertRaisesRegex(BundleError, "occt8_new_future_contract.py"):
            copy_bridge(self.kernel, self.target)

    def test_rejects_symlinked_contract_even_when_target_exists(self):
        source = self.native / "occt8_profile_contract.py"
        source.unlink()
        source.symlink_to("occt8_cut_contract.py")
        with self.assertRaisesRegex(BundleError,
                                    "missing/unsafe source-matched Kernel contract"):
            copy_bridge(self.kernel, self.target)

    def test_python_ast_detects_indirect_and_aliased_import_forms(self):
        path = self.native / "occt8_profile_contract.py"
        path.write_text(
            "import occt8_cut_contract as cut\n"
            "if False:\n    from occt8_new_future_contract import X\n",
            encoding="utf-8")
        self.assertEqual(_imported_kernel_contracts(path),
                         {"occt8_cut_contract", "occt8_new_future_contract"})


if __name__ == "__main__":
    unittest.main()
