#!/usr/bin/env python3
"""Acquire a clean exact-commit OCCT source tree for Platform's C++ build gate.

Acquisition is NOT native qualification. Runs on a networked Linux host or GitHub
Actions runner; existing qualify.py deliberately remains offline-only.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

PINNED_COMMIT = 'b8f597c677811d1f9f4d8a97f5ae2825c0353a42'
OFFICIAL_REMOTE = 'https://github.com/Open-Cascade-SAS/OCCT.git'


class AcquisitionBlocked(RuntimeError):
    pass


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def acquire(destination: Path, evidence: Path, *, remote: str = OFFICIAL_REMOTE,
            commit: str = PINNED_COMMIT, timeout: int = 1200) -> dict:
    """Fail closed. Custom remotes/commits are used only by the local regression suite."""
    destination = destination.absolute()
    evidence = evidence.absolute()
    if destination.exists() or destination.is_symlink():
        raise AcquisitionBlocked('source destination already exists; will not overwrite')
    if evidence.exists() or evidence.is_symlink():
        raise AcquisitionBlocked('evidence destination already exists; will not overwrite')
    if not destination.parent.is_dir() or not evidence.parent.is_dir():
        raise AcquisitionBlocked('create source/evidence parent directories first')
    if not isinstance(commit, str) or len(commit) != 40 or any(c not in '0123456789abcdef' for c in commit):
        raise AcquisitionBlocked('expected commit must be a full lowercase SHA-1')
    if timeout < 10 or timeout > 7200:
        raise AcquisitionBlocked('timeout must be between 10 and 7200 seconds')
    evidence.mkdir()
    report = {'schema': 'intuit3d.occt-source-acquisition/v1',
              'status': 'BLOCKED', 'sourceReady': False, 'nativeCppExecuted': False,
              'independentCadInteroperability': False, 'sourceCommit': commit,
              'remote': remote, 'destination': str(destination), 'commands': []}
    staging = None
    try:
        staging = Path(tempfile.mkdtemp(prefix=f'.{destination.name}.partial-', dir=destination.parent))
        env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GIT_ASKPASS='/bin/false')

        def run(args: list[str], *, capture: bool = False) -> str:
            number = len(report['commands']) + 1
            log_name = f'git-{number:02d}.log'
            entry = {'argv': args, 'log': log_name, 'status': 'started'}
            report['commands'].append(entry)
            try:
                result = subprocess.run(args, stdin=subprocess.DEVNULL,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        text=True, errors='replace', check=False,
                                        timeout=timeout, env=env)
            except (OSError, subprocess.TimeoutExpired) as exc:
                (evidence / log_name).write_text(f'{type(exc).__name__}: {exc}\n')
                entry['status'] = 'failed'
                raise AcquisitionBlocked(f'git operation failed: {log_name}') from exc
            (evidence / log_name).write_text(result.stdout + '\n[stderr]\n' + result.stderr)
            entry['returncode'] = result.returncode
            entry['status'] = 'success' if result.returncode == 0 else 'failed'
            if result.returncode:
                raise AcquisitionBlocked(f'git command returned {result.returncode}: {log_name}')
            return result.stdout.strip() if capture else ''

        run(['git', 'init', '--quiet', str(staging)])
        # Fetch exactly the commit, not a floating branch or tag. A server that
        # refuses this object results in BLOCKED rather than substituting HEAD.
        run(['git', '-C', str(staging), '-c', 'protocol.version=2',
             'fetch', '--no-tags', '--depth=1', '--filter=blob:none', remote, commit])
        run(['git', '-C', str(staging), '-c', 'advice.detachedHead=false',
             'checkout', '--quiet', '--detach', 'FETCH_HEAD'])
        observed = run(['git', '-C', str(staging), 'rev-parse', 'HEAD'], capture=True)
        if observed != commit:
            raise AcquisitionBlocked(f'fetched HEAD {observed} does not match pinned commit')
        if run(['git', '-C', str(staging), 'status', '--porcelain'], capture=True):
            raise AcquisitionBlocked('source checkout dirty after fetch')
        expected_type = run(['git', '-C', str(staging), 'cat-file', '-t', 'HEAD'], capture=True)
        if expected_type != 'commit' or not (staging / 'CMakeLists.txt').is_file():
            raise AcquisitionBlocked('fetched object is not a complete OCCT source checkout')
        report['sourceCMakeSha256'] = sha256(staging / 'CMakeLists.txt')
        if destination.exists() or destination.is_symlink():
            raise AcquisitionBlocked('destination appeared during fetch; refusing overwrite')
        staging.rename(destination)
        staging = None
        report['status'] = 'PINNED_SOURCE_FETCHED_ONLY'
        report['sourceReady'] = True
        return report
    except (AcquisitionBlocked, OSError) as exc:
        report['status'] = 'BLOCKED'
        report['failure'] = f'{type(exc).__name__}: {exc}'
        return report
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)
        (evidence / 'acquisition.json').write_text(json.dumps(report, sort_keys=True, indent=2) + '\n')


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, required=True,
                        help='new directory for the clean pinned OCCT source tree')
    parser.add_argument('--evidence', type=Path, required=True,
                        help='new directory for immutable Git fetch/verification logs')
    parser.add_argument('--timeout', type=int, default=1200)
    args = parser.parse_args(argv)
    try:
        report = acquire(args.destination, args.evidence, timeout=args.timeout)
    except AcquisitionBlocked as exc:
        print(f'BLOCKED before evidence initialization: {exc}', file=sys.stderr)
        return 2
    print(json.dumps({'status': report['status'], 'evidence': str(args.evidence / 'acquisition.json'),
                      'source': str(args.destination), 'failure': report.get('failure')}, sort_keys=True))
    return 0 if report['sourceReady'] else 2


if __name__ == '__main__':
    sys.exit(main())
