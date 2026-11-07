"""Explicit external cross-version STEP readback for the candidate OCCT8 provider.

Uses the pinned OCP 7.9.3.1 wrapper around OCCT in a fresh process.
It is NOT an independent STEP engine or production interoperability test.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--step", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    import OCP
    if OCP.__version__ != "7.9.3.1":
        raise RuntimeError("external reader needs pinned OCP 7.9.3.1")
    from step_audit_worker import inspect_step
    result = inspect_step(args.step)
    temporary = args.report.with_suffix(".pending")
    temporary.write_text(json.dumps(result, allow_nan=False), encoding="utf-8")
    temporary.replace(args.report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
