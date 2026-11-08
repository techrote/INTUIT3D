"""Compiled ELF ABI inventory/preflight tests; not OCCT geometry acceptance."""
from __future__ import annotations

import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import abi_compat as abi


@unittest.skipUnless(sys.platform == 'linux' and shutil.which('cc') and
                     shutil.which('readelf') and shutil.which('ldd'),
                     'real Linux ELF tools required')
class AbiProfileTests(unittest.TestCase):
    def setUp(self):
        self.h = tempfile.TemporaryDirectory()
        self.addCleanup(self.h.cleanup)
        root = Path(self.h.name)
        self.bin = root/'bin'
        self.libs = root/'lib'
        self.bin.mkdir()
        self.libs.mkdir()
        (root/'lib.c').write_text('int answer(void) {return 42;}\n')
        (root/'main.c').write_text(
            '#include <stdio.h>\nextern int answer(void);\n'
            'int main(void) {printf("%d\\n", answer()); return 0;}\n')
        subprocess.run(['cc','-shared','-fPIC',str(root/'lib.c'),
                        '-Wl,-soname,libTKMath.so.8.0',
                        '-o',str(self.libs/'libTKMath.so.8.0')],check=True)
        self.worker=self.bin/'worker'
        subprocess.run(['cc',str(root/'main.c'),'-L'+str(self.libs),
                        '-l:libTKMath.so.8.0','-Wl,--disable-new-dtags',
                        '-Wl,-rpath,$ORIGIN/../lib', '-o',str(self.worker)],check=True)

    def test_compiled_elf_abi_preflight_survives_relocation(self):
        before=abi.symbol_profile(self.worker,self.libs)
        self.assertEqual(before['schema'],'intuit3d/native-elf-abi-v1')
        self.assertIn('GLIBC',before['requiredVersions'])
        self.assertIn('libTKMath.so.8.0', before['objects']['bin/worker']['needed'])
        result=abi.verify_abi(self.worker,self.libs,before)
        self.assertEqual(result['status'],'HOST_ELF_ABI_PREFLIGHT_PASS')
        self.assertEqual(subprocess.check_output([str(self.worker)]).strip(),b'42')
        self.assertEqual(abi.symbol_profile(self.worker,self.libs),before)

    def test_rejects_fabricated_profile(self):
        profile=abi.symbol_profile(self.worker,self.libs)
        profile['requiredVersions']['GLIBC']='9.99'
        with self.assertRaisesRegex(abi.ABIError, 'differs from attested'):
            abi.verify_abi(self.worker,self.libs,profile)

    def test_rejects_missing_toolkit_or_external_library(self):
        expected=abi.symbol_profile(self.worker,self.libs)
        (self.libs/'libTKMath.so.8.0').unlink()
        with self.assertRaises(abi.ABIError):
            abi.verify_abi(self.worker,self.libs,expected)

    def test_real_ldd_ignores_inherited_bash_env_startup_hook(self):
        # On Debian/Ubuntu ldd is a Bash script. BASH_ENV is sourced before
        # the script starts, even if all LD_* environment variables are gone.
        # The negative control proves whether this host has that behaviour.
        root = Path(self.h.name)
        hook = root/'host-preload.sh'
        marker = root/'ldd-hook-executed'
        hook.write_text('printf injected > ' + shlex.quote(str(marker)) + '\n')
        hostile = dict(os.environ, BASH_ENV=str(hook))
        control = subprocess.run(['ldd', '--version'], env=hostile,
                                 capture_output=True, text=True, timeout=15)
        self.assertEqual(control.returncode, 0, control.stderr)
        if not marker.exists():
            self.skipTest('ldd on this host does not source BASH_ENV')
        marker.unlink()
        profile = abi.symbol_profile(self.worker, self.libs)
        with mock.patch.dict(os.environ, {'BASH_ENV': str(hook)}):
            result = abi.verify_abi(self.worker, self.libs, profile)
        self.assertEqual(result['status'], 'HOST_ELF_ABI_PREFLIGHT_PASS')
        self.assertFalse(marker.exists(), 'host startup code executed during ABI inspection')

    def test_version_selection_uses_numeric_order_not_lexical(self):
        sample='''Version needs section '.gnu.version_r' contains 1 entry:
          0x0020: Name: GLIBC_2.9  Flags: none
          0x0030: Name: GLIBC_2.34 Flags: none
          0x0040: Name: GLIBCXX_3.4.3  Flags: none
          0x0050: Name: GLIBCXX_3.4.30 Flags: none'''
        self.assertEqual(abi.requirements_from_readelf(sample),
                         {'GLIBC':'2.34','GLIBCXX':'3.4.30'})
        self.assertEqual(abi.requirements_from_readelf('Version symbols section'),{})


if __name__=='__main__': unittest.main()
