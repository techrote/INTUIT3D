"""OCCT-independent numerical admission of *serialised* AP214 plate support surfaces.

This is deliberately a small, fail-closed STEP entity reader for OCP's plate-v1
AP214 envelope, not a general STEP importer. The structural graph verifier must
run first. It validates STEP surface positions, axes and radii independently of
OCP's STEP reader; it does not validate face trims, edges or interoperability.
"""
from __future__ import annotations

import math
import re

from plate_axes import classify_cardinal_normal
from step_graph_guard import _without_literals_and_comments

_NUMBER = r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?'
_ENTITY = re.compile(r'\s*#([1-9][0-9]*)\s*=\s*([A-Z][A-Z0-9_]*)\s*(\(.*\))\s*\Z', re.S)
_VECTOR = re.compile(r'\(\s*,\s*\(\s*(.*?)\s*\)\s*\)\s*\Z', re.S)
_AXIS = re.compile(r'\(\s*,\s*#(\d+)\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)\s*\Z')
_SURFACE = re.compile(r'\(\s*,\s*#(\d+)\s*\)\s*\Z')
_CYLINDER = re.compile(r'\(\s*,\s*#(\d+)\s*,\s*(' + _NUMBER + r')\s*\)\s*\Z')
_REFERENCES = re.compile(r'#([1-9][0-9]*)\b')
# Serialised coordinate equivalence only. Neither a modelling fuzzy tolerance
# nor authorization to move/repair topology. A failed comparison is visible.
COORD_ABS_MM = 1e-11
COORD_REL = 1e-12


def _entities(body: str) -> dict[int, tuple[str, str]]:
    entries = {}
    for statement in _without_literals_and_comments(body).split(';'):
        match = _ENTITY.fullmatch(statement)
        if match:
            ident = int(match[1])
            if ident in entries:
                raise ValueError('STEP analytic: duplicate entity number')
            entries[ident] = (match[2], match[3])
    return entries


def _entry(entries: dict, ref: int, kind: str) -> str:
    entry = entries.get(ref)
    if entry is None or entry[0] != kind:
        raise ValueError(f'STEP analytic: required {kind} reference missing or wrong type')
    return entry[1]


def _vector(entries: dict, ref: int, kind: str) -> tuple[float, float, float]:
    expr = _entry(entries, ref, kind)
    match = _VECTOR.fullmatch(expr)
    if not match:
        raise ValueError('STEP analytic: malformed Cartesian/direction vector')
    components = match[1].split(',')
    if len(components) != 3 or any(re.fullmatch(_NUMBER, v.strip()) is None for v in components):
        raise ValueError('STEP analytic: required 3D finite Cartesian/direction values')
    values = tuple(float(v) for v in components)
    if not all(math.isfinite(v) for v in values):
        raise ValueError('STEP analytic: nonfinite Cartesian/direction value')
    return values


def _axis(entries: dict, ref: int) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    match = _AXIS.fullmatch(_entry(entries, ref, 'AXIS2_PLACEMENT_3D'))
    if match is None:
        raise ValueError('STEP analytic: unsupported placement arguments')
    point = _vector(entries, int(match[1]), 'CARTESIAN_POINT')
    normal = _vector(entries, int(match[2]), 'DIRECTION')
    # A required X-reference direction also prevents accepting a dangling or
    # malformed orientation coordinate system, though trims remain B-rep gates.
    x_direction = _vector(entries, int(match[3]), 'DIRECTION')
    if not math.isclose(math.hypot(*x_direction), 1.0, abs_tol=1e-12, rel_tol=0):
        raise ValueError('STEP analytic: placement X direction not unit')
    if abs(math.fsum(a * b for a, b in zip(normal, x_direction))) > 1e-10:
        raise ValueError('STEP analytic: placement axes not orthogonal')
    return point, normal


def _coord_matches(observed: float, intended: float) -> bool:
    return math.isfinite(observed) and abs(observed - intended) <= max(COORD_ABS_MM, abs(intended) * COORD_REL)


def verify_step_analytic_plate(body: str, plate: dict) -> None:
    """Check shell-bound AP214 support geometry against authored plate-v1.

    Call after verify_step_graph; this function deliberately knows no OCP APIs
    and does not pretend that surfaces alone certify a valid complete solid.
    """
    if type(plate) is not dict or set(plate) != {'width', 'depth', 'thickness', 'holes'}:
        raise ValueError('STEP analytic: validated plate-v1 intent required')
    entries = _entities(body)
    planar: dict[str, list[float]] = {'X': [], 'Y': [], 'Z': []}
    bores: list[tuple[float, float, float]] = []
    faces = [(ref, expr) for ref, (kind, expr) in entries.items() if kind == 'ADVANCED_FACE']
    if len(faces) != 6 + len(plate['holes']):
        raise ValueError('STEP analytic: unexpected shell face count')
    for _, face in faces:
        refs = [int(ref) for ref in _REFERENCES.findall(face)]
        if len(refs) < 2:
            raise ValueError('STEP analytic: malformed shell face')
        surface = entries.get(refs[-1])
        if surface is None:
            raise ValueError('STEP analytic: missing face support')
        kind, expr = surface
        if kind == 'PLANE':
            match = _SURFACE.fullmatch(expr)
            if match is None:
                raise ValueError('STEP analytic: malformed planar support')
            point, direction = _axis(entries, int(match[1]))
            axis = classify_cardinal_normal(direction)
            index = 'XYZ'.index(axis)
            planar[axis].append(point[index])
        elif kind == 'CYLINDRICAL_SURFACE':
            match = _CYLINDER.fullmatch(expr)
            if match is None:
                raise ValueError('STEP analytic: malformed cylindrical support')
            point, direction = _axis(entries, int(match[1]))
            if classify_cardinal_normal(direction) != 'Z':
                raise ValueError('STEP analytic: nonvertical bore axis')
            radius = float(match[2])
            if not math.isfinite(radius) or radius <= 0:
                raise ValueError('STEP analytic: nonpositive or nonfinite bore radius')
            bores.append((point[0], point[1], radius))
        else:
            raise ValueError('STEP analytic: unsupported shell surface')

    intended_axes = {
        'X': [-plate['width'] / 2, plate['width'] / 2],
        'Y': [-plate['depth'] / 2, plate['depth'] / 2],
        'Z': [0.0, plate['thickness']],
    }
    for axis, intended in intended_axes.items():
        actual = sorted(planar[axis])
        if len(actual) != 2 or any(not _coord_matches(value, target) for value, target in zip(actual, intended)):
            raise ValueError(f'STEP analytic: {axis} support planes differ from authored plate')
    intended_holes = sorted((h['x'], h['y'], h['radius']) for h in plate['holes'])
    if len(bores) != len(intended_holes):
        raise ValueError('STEP analytic: incorrect through-hole support count')
    for actual, expected in zip(sorted(bores), intended_holes):
        if not all(_coord_matches(a, b) for a, b in zip(actual, expected)):
            raise ValueError('STEP analytic: cylindrical bore centre/radius differs from authored intent')
