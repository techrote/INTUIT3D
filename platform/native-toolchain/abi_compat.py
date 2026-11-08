#!/usr/bin/env python3
"""Linux ELF ABI requirements and host compatibility for offline OCCT workers.

This is a *preflight* and provenance record. It does not replace real C++/STEP
replay, and cannot promise compatibility on other Linux distributions.
"""
from __future__ import annotations

import os
from pathlib import Path
import platform
import re
import subprocess

FAMILIES = ('GLIBC', 'GLIBCXX', 'CXXABI')
MAX_OBJECTS = 128
VERSION_PATTERN = re.compile(r'\bName:\s*(GLIBCXX|GLIBC|CXXABI)_([0-9]+(?:\.[0-9]+)+)\b')
NEEDED_PATTERN = re.compile(r'\(NEEDED\).*?\[([^\]]+)\]')
SONAME_PATTERN = re.compile(r'\blibTK[A-Za-z0-9]+\.so(?:\.[0-9]+)*\b')


class ABIError(RuntimeError):
    pass


def require(ok: bool, message: str) -> None:
    if not ok:
        raise ABIError(message)


def command(argv: list[str], timeout: int = 30) -> str:
    env = {k: v for k, v in os.environ.items()
           if k not in ('LD_LIBRARY_PATH', 'LD_PRELOAD', 'LD_AUDIT', 'LD_DEBUG')}
    proc = subprocess.run(argv, text=True, capture_output=True, timeout=timeout,
                          check=False, env=env)
    require(proc.returncode == 0,
            'ELF inspection failed: ' + ' '.join(argv) + ' ' + proc.stderr[-500:])
    return proc.stdout


def version_tuple(value: str) -> tuple[int, ...]:
    require(isinstance(value, str) and
            re.fullmatch(r'[0-9]+(?:\.[0-9]+)+', value) is not None,
            'malformed ELF ABI version')
    return tuple(int(part) for part in value.split('.'))


def requirements_from_readelf(output: str) -> dict[str, str]:
    # Version definitions on the *provider* are not consumer requirements.
    # Parse only the .gnu.version_r / Version needs section.
    segment = output.split('Version needs section', 1)
    if len(segment) == 1:
        return {}  # Versionless C/C++ shared toolkits are valid ELF objects.
    needed = segment[1].split('Version definition section', 1)[0]
    result: dict[str, str] = {}
    for family, version in VERSION_PATTERN.findall(needed):
        if family not in result or version_tuple(version) > version_tuple(result[family]):
            result[family] = version
    return result


def symbol_profile(worker: Path, libs: Path) -> dict:
    """Capture the actual version-needs floor for copied native ELF objects."""
    require(worker.is_file() and libs.is_dir(), 'missing native ELF bundle')
    objects = [worker, *(p for p in sorted(libs.iterdir())
                         if p.is_file() and not p.is_symlink())]
    require(1 < len(objects) <= MAX_OBJECTS, 'invalid native ELF object count')
    required: dict[str, str] = {}
    records: dict[str, dict] = {}
    for obj in objects:
        label = 'bin/' + obj.name if obj == worker else 'lib/' + obj.name
        header = command(['readelf', '-h', str(obj)])
        require(re.search(r'^\s*Class:\s*ELF64\s*$', header, re.M) is not None,
                'only 64-bit Linux ELF is supported: ' + label)
        machine_line = next((x.split(':', 1)[1].strip() for x in header.splitlines()
                             if 'Machine:' in x), '')
        require(machine_line, 'missing ELF machine: ' + label)
        needs = requirements_from_readelf(command(['readelf', '-W', '--version-info', str(obj)]))
        for family, version in needs.items():
            if family not in required or version_tuple(version) > version_tuple(required[family]):
                required[family] = version
        dynamic = command(['readelf', '-W', '-d', str(obj)])
        records[label] = {
            'machine': machine_line,
            'versions': needs,
            'needed': sorted(set(NEEDED_PATTERN.findall(dynamic))),
        }
    require('GLIBC' in required, 'native ABI profile omitted glibc requirements')
    machines = {record['machine'] for record in records.values()}
    require(len(machines) == 1, 'mixed ELF machine types in packaged binary')
    return {'schema': 'intuit3d/native-elf-abi-v1', 'machine': next(iter(machines)),
            'requiredVersions': required, 'objects': records}


def verify_abi(worker: Path, libs: Path, expected: dict) -> dict:
    """Verify exact ELF requirements survived distribution and inspect loader."""
    actual = symbol_profile(worker, libs)
    require(actual == expected, 'ELF ABI profile differs from attested manifest')
    dynamic = command(['ldd', str(worker)])
    require('not found' not in dynamic, 'host missing a required native shared library')
    for line in dynamic.splitlines():
        match = SONAME_PATTERN.search(line)
        if match and '=>' in line:
            path = line.split('=>', 1)[1].split('(', 1)[0].strip()
            require(path.startswith('/') and
                    Path(path).resolve().is_relative_to(libs.resolve()),
                    'OCCT toolkit escaped installed bundle: ' + line)
    # ldd -v calls the actual host loader's version matching machinery; it
    # refuses missing GLIBC_*/GLIBCXX_*/CXXABI_* versions, not just filenames.
    command(['ldd', '-v', str(worker)])
    return {'status': 'HOST_ELF_ABI_PREFLIGHT_PASS',
            'machine': actual['machine'],
            'requiredVersions': actual['requiredVersions'],
            'host': platform.platform()}
