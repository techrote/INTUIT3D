"""Bounded, one-job process-tree supervision for the *experimental* OCP worker.

This is failure containment for trusted local projects, NOT a security sandbox.
POSIX descendants inherit a private session; timeout and successful worker exit
both reap any remaining group members. Windows uses taskkill /T on timeout;
Windows descendant cleanup on normal exit is not independently qualified.
"""
from __future__ import annotations

import os
import signal
import subprocess
import threading
from pathlib import Path
from typing import Sequence

MAX_DIAGNOSTIC_BYTES = 4096


def _stop_tree(worker: subprocess.Popen[bytes]) -> None:
    if os.name == 'posix':
        try:
            os.killpg(worker.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass  # All members have already exited.
    elif os.name == 'nt' and worker.poll() is None:
        # CREATE_NEW_PROCESS_GROUP alone does not kill descendants on Windows.
        try:
            subprocess.run(['taskkill', '/PID', str(worker.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=3, check=False)
        except (OSError, subprocess.TimeoutExpired):
            pass
    if worker.poll() is None:
        worker.kill()


def run_isolated_worker(args: Sequence[str], *, cwd: Path, timeout: float) -> subprocess.CompletedProcess[bytes]:
    """Execute once, capture only the last 4096 stderr bytes, and kill on deadline.

    The parent never accumulates arbitrary output in RAM. The worker writes its
    real results to bounded private files, not to stdout. On POSIX, even a
    successful leader cannot leave its own descendants running after return.
    """
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    worker = subprocess.Popen(args, cwd=cwd, stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                              start_new_session=(os.name == 'posix'), creationflags=flags)
    tail = bytearray()

    def drain_stderr() -> None:
        assert worker.stderr is not None
        while True:
            chunk = worker.stderr.read(4096)
            if not chunk:
                break
            tail.extend(chunk)
            del tail[:-MAX_DIAGNOSTIC_BYTES]

    reader = threading.Thread(target=drain_stderr, name='intuit3d-kernel-stderr', daemon=True)
    reader.start()
    timed_out = False
    try:
        worker.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
    finally:
        _stop_tree(worker)
        # POSIX parent is reaped after descendants are killed; no zombies.
        try:
            worker.wait(timeout=3)
        except subprocess.TimeoutExpired:
            _stop_tree(worker)
            worker.wait()
        reader.join(timeout=3)
        if worker.stderr is not None:
            worker.stderr.close()
    if timed_out:
        raise subprocess.TimeoutExpired(args, timeout)
    return subprocess.CompletedProcess(args, worker.returncode, b'', bytes(tail))
