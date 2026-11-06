"""Adversarial process-tree tests; all run without CAD dependencies."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from process_supervision import MAX_DIAGNOSTIC_BYTES, run_isolated_worker


class ProcessSupervisionTests(unittest.TestCase):
    def test_result_is_code_and_diagnostic_tail_is_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            code = 'import sys; sys.stderr.buffer.write(b"a" * 150000 + b"END"); sys.exit(7)'
            result = run_isolated_worker([sys.executable, '-c', code], cwd=Path(tmp), timeout=6)
            self.assertEqual(result.returncode, 7)
            self.assertTrue(result.stderr.endswith(b'END'))
            self.assertLessEqual(len(result.stderr), MAX_DIAGNOSTIC_BYTES)
            self.assertEqual(result.stdout, b'')

    def test_timeout_raises_without_returning_a_success_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(subprocess.TimeoutExpired):
                run_isolated_worker([sys.executable, '-c', 'import time; time.sleep(4)'],
                                    cwd=Path(tmp), timeout=0.1)

    @unittest.skipUnless(os.name == 'posix', 'POSIX process group test')
    def test_timeout_kills_descendant_that_outlives_leader(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp, 'escaped.txt')
            program = ("import subprocess,sys,time; "
                       "subprocess.Popen([sys.executable, '-c', "
                       "'import pathlib,time; time.sleep(0.6); pathlib.Path(\"escaped.txt\").write_text(\"escaped\")']); "
                       "time.sleep(5)")
            with self.assertRaises(subprocess.TimeoutExpired):
                run_isolated_worker([sys.executable, '-c', program], cwd=Path(tmp), timeout=0.16)
            time.sleep(0.75)
            self.assertFalse(marker.exists(), 'orphan geometry descendant escaped cancellation')

    @unittest.skipUnless(os.name == 'posix', 'POSIX process group test')
    def test_successful_leader_cannot_leave_background_writer(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp, 'background.txt')
            program = ("import subprocess,sys; "
                       "subprocess.Popen([sys.executable, '-c', "
                       "'import pathlib,time; time.sleep(0.6); pathlib.Path(\"background.txt\").write_text(\"escaped\")'])")
            result = run_isolated_worker([sys.executable, '-c', program], cwd=Path(tmp), timeout=3)
            self.assertEqual(result.returncode, 0)
            time.sleep(0.75)
            self.assertFalse(marker.exists(), 'leader completion left a live descendant')


if __name__ == '__main__':
    unittest.main()
