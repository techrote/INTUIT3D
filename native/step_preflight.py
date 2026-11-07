"""Bounded independent *structural* preflight of experimental OCCT STEP exports.

This is NOT a CAD/STEP parser, geometric readback, or interoperability proof.
It refuses wrong-unit, truncated, substituted or implausible STEP artifacts
before the supervisor atomically publishes them as its own exact exports.
"""
from __future__ import annotations

import re
from pathlib import Path

from step_graph_guard import verify_step_graph
from step_analytic_guard import verify_step_analytic_plate

MAX_STEP_BYTES = 32 * 1024 * 1024
MIN_STEP_BYTES = 512

_SECTION = re.compile(
    r"\AISO-10303-21;\s*HEADER;\s*(.*?)\s*ENDSEC;\s*DATA;\s*(.*?)"
    r"\s*ENDSEC;\s*END-ISO-10303-21;\s*\Z",
    re.DOTALL,
)
_ENTITY = re.compile(r"(?m)^#(\d+)\s*=\s*([A-Z_][A-Z0-9_]*|\()")
_LENGTH_UNIT = re.compile(
    r"(?m)^#\d+\s*=\s*\(\s*LENGTH_UNIT\s*\(\s*\)\s*"
    r"NAMED_UNIT\s*\(\s*\*\s*\)\s*"
    r"SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)\s*\)\s*;"
)


def verify_step_artifact(path: Path, *, expected_holes: int, plate: dict | None = None) -> None:
    """Fail-closed OCCT AP214 STEP structure/units check; *not* geometry proof.

    The source B-rep and same-engine STEP reimport must *separately* pass the
    kernel's geometric/analytic topology checks. This independent text gate
    checks that the bytes handed to the caller are still plausible mm STEP.
    """
    if type(expected_holes) is not int or not 0 <= expected_holes <= 64:
        raise ValueError("STEP preflight: invalid expected hole count")
    size = path.stat().st_size
    if not MIN_STEP_BYTES <= size <= MAX_STEP_BYTES:
        raise ValueError("STEP preflight: file size out of bounded range")
    try:
        data = path.read_bytes()
        text = data.decode("ascii")
    except UnicodeDecodeError as error:
        raise ValueError("STEP preflight: non-ASCII experimental export") from error
    if len(data) != size or "\x00" in text:
        raise ValueError("STEP preflight: unstable or binary export")
    match = _SECTION.fullmatch(text)
    if match is None:
        raise ValueError("STEP preflight: truncated or malformed ISO-10303-21 sections")
    header, body = match.groups()
    if len(re.findall(r"\bFILE_SCHEMA\s*\(\s*\(\s*'AUTOMOTIVE_DESIGN\b", header)) != 1:
        raise ValueError("STEP preflight: unexpected AP214 schema")
    declarations = _ENTITY.findall(body)
    identifiers = [identifier for identifier, _ in declarations]
    if not declarations or len(identifiers) != len(set(identifiers)):
        raise ValueError("STEP preflight: duplicate or absent STEP entity identifiers")
    units = re.findall(r"\bLENGTH_UNIT\s*\(\s*\)", body)
    if len(units) != 1 or _LENGTH_UNIT.search(body) is None:
        raise ValueError("STEP preflight: length unit is not exactly millimetres")
    types = [kind for _, kind in declarations]
    if types.count("MANIFOLD_SOLID_BREP") != 1 or types.count("CLOSED_SHELL") != 1:
        raise ValueError("STEP preflight: wrong single-solid/shell structure")
    if types.count("CYLINDRICAL_SURFACE") != expected_holes:
        raise ValueError("STEP preflight: missing/spurious cylindrical surface entities")
    # Verify that the declarations describe the actual shell-bound plate,
    # and that the millimetre unit is bound to that shape representation.
    # This remains an independent *structural* gate, not geometry proof.
    verify_step_graph(body, expected_holes=expected_holes)
    # For supervisor exports, independently decode the serialised AP214
    # support surfaces against authored intent before same-OCCT reimport.
    # Legacy callers without plate only request structural preflight.
    if plate is not None:
        verify_step_analytic_plate(body, plate)
