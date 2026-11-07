"""Real tar/gzip relocation and deterministic byte-for-byte archive tests."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

from reproducible_archive import ArchiveError, ROOT_NAME, write_archive


class ReproducibleArchiveTests(unittest.TestCase):
    def make_tree(self, root: Path, epoch: int) -> Path:
        root.mkdir()
        (root / "bin").mkdir()
        (root / "lib").mkdir()
        launcher = root / "bin" / "tool.sh"
        launcher.write_text('#!/bin/sh\necho offline-exec-ok\n')
        launcher.chmod(0o755)
        (root / "lib/libTKMath.so.8.0").write_bytes(b'ELF-like fixture payload')
        (root / "lib/libTKMath.so").symlink_to('libTKMath.so.8.0')
        (root / "manifest.json").write_text('{"schema":"fixed"}\n')
        for p in root.rglob('*'):
            if not p.is_symlink():
                os.utime(p, (epoch, epoch))
        os.utime(root, (epoch, epoch))
        return root

    def test_different_prefix_and_mtimes_produce_identical_gzip_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            first = self.make_tree(base / 'first-staging', 1_000_000)
            second = self.make_tree(base / 'different-second-prefix', 1_500_000_000)
            a, b = base / 'a.tar.gz', base / 'b.tar.gz'
            write_archive(first, a)
            write_archive(second, b)
            self.assertEqual(hashlib.sha256(a.read_bytes()).digest(),
                             hashlib.sha256(b.read_bytes()).digest())
            self.assertEqual(a.read_bytes()[:10][4:8], b'\0\0\0\0')
            with tarfile.open(a, 'r:gz') as tar:
                members = tar.getmembers()
                self.assertEqual([m.name for m in members], sorted(m.name for m in members))
                self.assertTrue(all(m.uid == m.gid == m.mtime == 0 for m in members))
                self.assertTrue(all(m.uname == m.gname == '' for m in members))
                self.assertTrue(all(m.name.startswith(ROOT_NAME) for m in members))
                self.assertEqual(tar.getmember(ROOT_NAME + '/bin/tool.sh').mode, 0o755)
                self.assertEqual(tar.getmember(ROOT_NAME + '/lib/libTKMath.so').linkname,
                                 'libTKMath.so.8.0')
                extracted = base / 'relocated'
                extracted.mkdir()
                tar.extractall(extracted, filter='data')
                self.assertEqual(subprocess.check_output(
                    [str(extracted / ROOT_NAME / 'bin/tool.sh')]).strip(),
                    b'offline-exec-ok')

    def test_refuses_escape_link_and_cleans_partial_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            tree = self.make_tree(base / 'source', 10)
            (tree / 'lib/escape.so').symlink_to('../../outside')
            archive = base / 'failed.tar.gz'
            with self.assertRaises((ArchiveError, FileNotFoundError)):
                write_archive(tree, archive)
            self.assertFalse(archive.exists())

    def test_refuses_existing_destination_and_in_tree_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            tree = self.make_tree(base / 'source', 10)
            archive = base / 'existing.tar.gz'
            archive.write_bytes(b'untouched')
            with self.assertRaisesRegex(ArchiveError, 'already exists'):
                write_archive(tree, archive)
            self.assertEqual(archive.read_bytes(), b'untouched')
            with self.assertRaisesRegex(ArchiveError, 'outside bundle tree'):
                write_archive(tree, tree / 'bad.tar.gz')


if __name__ == '__main__':
    unittest.main()
