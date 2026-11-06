"""Reopen actual STEP bytes in a second, separately supervised OCP process.

This is a *same-engine* corroboration of the published artifact, not an
independent STEP implementation or a qualification of OCCT 8.0.1 C++.
The authoring worker's claimed readback metrics are not used as evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def inspect_step(path: Path) -> dict:
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.STEPControl import STEPControl_Reader
    from ocp_worker import solid_properties

    reader = STEPControl_Reader()
    if reader.ReadFile(str(path)) != IFSelect_RetDone or reader.TransferRoots() != 1:
        raise ValueError('STEP audit: separate-process import failed')
    result = solid_properties(reader.OneShape())
    return {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'metrics': result}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--step', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    result = inspect_step(args.step)
    staging = args.report.with_suffix('.pending')
    staging.write_text(json.dumps(result, allow_nan=False), encoding='utf-8')
    staging.replace(args.report)


if __name__ == '__main__':
    main()
