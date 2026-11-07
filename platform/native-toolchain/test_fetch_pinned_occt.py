"""Real local Git transport tests. No fake remote result can qualify OCCT C++."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('occt_fetch', Path(__file__).with_name('fetch_pinned_occt.py'))
f = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(f)


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / 'remote'
        self.remote.mkdir()
        for args in [['git', 'init', '-q'], ['git', 'config', 'user.name', 'Test'],
                     ['git', 'config', 'user.email', 'test@example.invalid']]:
            subprocess.run(args, cwd=self.remote, check=True, capture_output=True)
        (self.remote / 'CMakeLists.txt').write_text('project(testfixture)\n')
        subprocess.run(['git', 'add', 'CMakeLists.txt'], cwd=self.remote, check=True, capture_output=True)
        subprocess.run(['git', 'commit', '-qm', 'fixture'], cwd=self.remote, check=True, capture_output=True)
        self.sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.remote, text=True).strip()

    def acquire(self, commit=None, destination=None, evidence=None):
        return f.acquire(destination or (self.root / 'occt'), evidence or (self.root / 'evidence'),
                         remote=str(self.remote), commit=commit or self.sha, timeout=30)

    def test_local_git_transport_fetches_exact_hash_and_clean_tree(self):
        result = self.acquire()
        self.assertEqual(result['status'], 'PINNED_SOURCE_FETCHED_ONLY')
        self.assertTrue(result['sourceReady'])
        self.assertFalse(result['nativeCppExecuted'])
        self.assertFalse(result['independentCadInteroperability'])
        self.assertEqual(result['sourceCommit'], self.sha)
        self.assertEqual((self.root / 'occt/CMakeLists.txt').read_text(), 'project(testfixture)\n')
        self.assertEqual(subprocess.check_output(['git', '-C', str(self.root / 'occt'), 'status', '--porcelain'], text=True), '')
        self.assertEqual(json.loads((self.root / 'evidence/acquisition.json').read_text())['status'], 'PINNED_SOURCE_FETCHED_ONLY')

    def test_reject_wrong_commit_without_publishing_partial_source(self):
        result = self.acquire(commit='0' * 40)
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertFalse(result['sourceReady'])
        self.assertFalse((self.root / 'occt').exists())
        self.assertTrue((self.root / 'evidence/acquisition.json').exists())
        self.assertTrue(list((self.root / 'evidence').glob('git-*.log')))

    def test_existing_destination_not_clobbered(self):
        target = self.root / 'occt'
        target.mkdir()
        (target / 'user.txt').write_text('precious')
        with self.assertRaisesRegex(f.AcquisitionBlocked, 'already exists'):
            self.acquire()
        self.assertEqual((target / 'user.txt').read_text(), 'precious')

    def test_existing_evidence_not_clobbered(self):
        evidence = self.root / 'evidence'
        evidence.mkdir()
        with self.assertRaisesRegex(f.AcquisitionBlocked, 'evidence destination'):
            self.acquire()
        self.assertFalse((self.root / 'occt').exists())

    def test_invalid_hash_fails_before_git_or_publication(self):
        with self.assertRaisesRegex(f.AcquisitionBlocked, 'full lowercase SHA-1'):
            self.acquire(commit='HEAD')
        self.assertFalse((self.root / 'occt').exists())
        self.assertFalse((self.root / 'evidence').exists())

    def test_missing_source_cmake_does_not_publish_checkout(self):
        (self.remote / 'CMakeLists.txt').unlink()
        subprocess.run(['git', 'add', '-u'], cwd=self.remote, check=True, capture_output=True)
        subprocess.run(['git', 'commit', '-qm', 'delete source'], cwd=self.remote, check=True, capture_output=True)
        sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.remote, text=True).strip()
        result = self.acquire(commit=sha)
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertFalse((self.root / 'occt').exists())


if __name__ == '__main__':
    unittest.main()
