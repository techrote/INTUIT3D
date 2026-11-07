"""Bounded independent ISO 10303-21 plate geometry readback.

No OCCT/OCP or STEP toolkit: read Part 21 entities and their references to
check a single closed, millimetre plate shell, dimensions and through bores.
This is a strict plate-subset reader, NOT a general CAD STEP importer, volume
integrator, or independent interoperability certification.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import sys

MAX_BYTES = 32 * 1024 * 1024
_ENTITY = re.compile(r"^\s*#([1-9][0-9]*)\s*=\s*(.*?)\s*$", re.S)
_SIMPLE = re.compile(r"^([A-Z][A-Z0-9_]*)\s*\((.*)\)$", re.S)
_REF = re.compile(r"^#([1-9][0-9]*)$")
_NUMBER = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?$")


class UnsupportedStep(ValueError):
    """Fail closed if Part 21 cannot substantiate this specific plate intent."""


def _statements(source: str):
    start = i = 0
    quote = comment = False
    while i < len(source):
        c = source[i]
        pair = source[i:i + 2]
        if comment:
            if pair == '*/':
                comment = False
                i += 2
                continue
        elif quote:
            if pair == "''":
                i += 2
                continue
            if c == "'":
                quote = False
        elif pair == '/*':
            comment = True
            i += 2
            continue
        elif c == "'":
            quote = True
        elif c == ';':
            yield source[start:i].strip()
            start = i + 1
        i += 1
    if quote or comment or source[start:].strip():
        raise UnsupportedStep("truncated Part 21 statement")


def _fields(source: str) -> list[str]:
    result = []
    start = depth = i = 0
    quote = False
    while i < len(source):
        c = source[i]
        if quote:
            if source[i:i+2] == "''":
                i += 2
                continue
            if c == "'":
                quote = False
        elif c == "'":
            quote = True
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth < 0:
                raise UnsupportedStep("unbalanced EXPRESS arguments")
        elif c == ',' and depth == 0:
            result.append(source[start:i].strip())
            start = i + 1
        i += 1
    if quote or depth:
        raise UnsupportedStep("unbalanced EXPRESS arguments")
    result.append(source[start:].strip())
    return result


def _ref(value: str) -> int:
    match = _REF.fullmatch(value.strip())
    if not match:
        raise UnsupportedStep("expected entity reference")
    return int(match[1])


def _refs(value: str) -> list[int]:
    if not (value.startswith('(') and value.endswith(')')):
        raise UnsupportedStep("expected reference list")
    items = _fields(value[1:-1])
    return [] if items == [''] else [_ref(item) for item in items]


def _real(value: str) -> float:
    if not _NUMBER.fullmatch(value.strip()):
        raise UnsupportedStep("invalid STEP real number")
    result = float(value)
    if not math.isfinite(result):
        raise UnsupportedStep("non-finite STEP real number")
    return result


@dataclass(frozen=True)
class Entity:
    kind: str
    args: tuple[str, ...]
    raw: str


class Step:
    def __init__(self, data: bytes):
        if not 100 <= len(data) <= MAX_BYTES:
            raise UnsupportedStep("unsupported STEP size")
        try:
            source = data.decode('ascii')
        except UnicodeError as exc:
            raise UnsupportedStep("STEP is not ASCII-compatible") from exc
        statements = list(_statements(source))
        if len(statements) < 5 or statements[0] != 'ISO-10303-21' or statements[-1] != 'END-ISO-10303-21':
            raise UnsupportedStep("invalid Part 21 envelope")
        if statements.count('HEADER') != 1 or statements.count('DATA') != 1:
            raise UnsupportedStep("expected one HEADER and one DATA section")
        start = statements.index('DATA')
        if statements[-2] != 'ENDSEC' or not statements[start+1:-2]:
            raise UnsupportedStep("incomplete DATA section")
        self.entities: dict[int, Entity] = {}
        for statement in statements[start+1:-2]:
            match = _ENTITY.fullmatch(statement)
            if not match:
                raise UnsupportedStep("unrecognized Part 21 entity")
            idx = int(match[1])
            if idx in self.entities:
                raise UnsupportedStep("duplicate Part 21 identifier")
            raw = match[2].strip()
            simple = _SIMPLE.fullmatch(raw)
            self.entities[idx] = (Entity(simple[1], tuple(_fields(simple[2])), raw)
                                  if simple else Entity('COMPLEX', (), raw))
        if len(self.entities) > 250000:
            raise UnsupportedStep("too many STEP entities")
        self.sha256 = hashlib.sha256(data).hexdigest()

    def get(self, idx: int, kind: str) -> tuple[str, ...]:
        entity = self.entities.get(idx)
        if entity is None or entity.kind != kind:
            raise UnsupportedStep(f"missing or unsupported {kind}")
        return entity.args

    def point(self, idx: int) -> tuple[float, float, float]:
        args = self.get(idx, 'CARTESIAN_POINT')
        if len(args) != 2 or not args[1].startswith('(') or not args[1].endswith(')'):
            raise UnsupportedStep("invalid point")
        coordinates = _fields(args[1][1:-1])
        if len(coordinates) != 3:
            raise UnsupportedStep("non-3D Cartesian point")
        return tuple(_real(c) for c in coordinates)

    def axis(self, idx: int):
        args = self.get(idx, 'AXIS2_PLACEMENT_3D')
        if len(args) != 4:
            raise UnsupportedStep("invalid axis placement")
        direction_args = self.get(_ref(args[2]), 'DIRECTION')
        if len(direction_args) != 2 or not direction_args[1].startswith('('):
            raise UnsupportedStep("invalid surface direction")
        direction = tuple(_real(x) for x in _fields(direction_args[1][1:-1]))
        if len(direction) != 3 or not math.isclose(sum(x*x for x in direction), 1,
                                                  abs_tol=1e-9, rel_tol=1e-9):
            raise UnsupportedStep("non-unit surface direction")
        return self.point(_ref(args[1])), direction


def _near(a, b):
    # Readback comparison only; never a modelling fuzzy-Boolean tolerance.
    return math.isfinite(a) and math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-7)


def verify_plate_part21(data: bytes, plate: dict) -> dict:
    doc = Step(data)
    solids = [i for i, e in doc.entities.items() if e.kind == 'MANIFOLD_SOLID_BREP']
    reps = [i for i, e in doc.entities.items()
            if e.kind == 'ADVANCED_BREP_SHAPE_REPRESENTATION']
    if len(solids) != 1 or len(reps) != 1:
        raise UnsupportedStep("expected one advanced B-rep and one manifold solid")
    rep = doc.get(reps[0], 'ADVANCED_BREP_SHAPE_REPRESENTATION')
    if len(rep) != 3 or solids[0] not in _refs(rep[1]):
        raise UnsupportedStep("solid not connected to B-rep representation")
    context = doc.entities.get(_ref(rep[2]))
    units = (re.search(r'GLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\s*\(([^)]*)\)\s*\)', context.raw)
             if context and context.kind == 'COMPLEX' else None)
    if units is None:
        raise UnsupportedStep("STEP representation units missing")
    unit_ids = _refs('(' + units[1] + ')')
    if not any(doc.entities.get(i) and
               re.search(r'\bLENGTH_UNIT\s*\(\s*\)\s*.*?\bSI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)',
                         doc.entities[i].raw)
               for i in unit_ids):
        raise UnsupportedStep("STEP length unit is not explicitly millimetres")
    solid = doc.get(solids[0], 'MANIFOLD_SOLID_BREP')
    face_ids = _refs(doc.get(_ref(solid[1]), 'CLOSED_SHELL')[1])
    holes = plate['holes']
    if len(face_ids) != 6 + len(holes) or len(set(face_ids)) != len(face_ids):
        raise UnsupportedStep("unexpected plate face count")
    edges: dict[int, list[bool]] = {}
    vertices: set[int] = set()
    cylinders: list[tuple[float, float, float]] = []
    circles: list[tuple[tuple[float, float, float], float]] = []
    plane_count = 0
    for face_id in face_ids:
        face = doc.get(face_id, 'ADVANCED_FACE')
        if len(face) != 4 or face[3] not in ('.T.', '.F.'):
            raise UnsupportedStep("invalid face orientation")
        surface = doc.entities.get(_ref(face[2]))
        if surface is None:
            raise UnsupportedStep("missing surface")
        if surface.kind == 'PLANE':
            plane_count += 1
        elif surface.kind == 'CYLINDRICAL_SURFACE':
            cyl = doc.get(_ref(face[2]), 'CYLINDRICAL_SURFACE')
            point, axis = doc.axis(_ref(cyl[1]))
            radius = _real(cyl[2])
            if radius <= 0 or not (_near(axis[0], 0) and _near(axis[1], 0)
                                  and _near(abs(axis[2]), 1)):
                raise UnsupportedStep("nonvertical or invalid cylindrical bore")
            cylinders.append((point[0], point[1], radius))
        else:
            raise UnsupportedStep("unsupported plate face surface")
        for bound_id in _refs(face[1]):
            bound = doc.entities.get(bound_id)
            if not bound or bound.kind not in ('FACE_BOUND', 'FACE_OUTER_BOUND'):
                raise UnsupportedStep("invalid face bound")
            loop = doc.get(_ref(bound.args[1]), 'EDGE_LOOP')
            for oriented_id in _refs(loop[1]):
                oriented = doc.get(oriented_id, 'ORIENTED_EDGE')
                if len(oriented) != 5 or oriented[4] not in ('.T.', '.F.'):
                    raise UnsupportedStep("invalid edge orientation")
                edge_id = _ref(oriented[3])
                # Face orientation reverses edge traversal in STEP. Ignoring it
                # incorrectly rejects actual OCCT through-hole STEP shells.
                edges.setdefault(edge_id, []).append(oriented[4] == face[3])
                curve = doc.get(edge_id, 'EDGE_CURVE')
                vertices.update((_ref(curve[1]), _ref(curve[2])))
                geom_id = _ref(curve[3])
                geometry = doc.entities.get(geom_id)
                if geometry and geometry.kind in ('SURFACE_CURVE', 'SEAM_CURVE'):
                    geom_id = _ref(geometry.args[1])
                geometry = doc.entities.get(geom_id)
                if geometry and geometry.kind == 'CIRCLE':
                    circle = doc.get(geom_id, 'CIRCLE')
                    if _real(circle[2]) <= 0:
                        raise UnsupportedStep("invalid circular edge radius")
                    point, _ = doc.axis(_ref(circle[1]))
                    circles.append((point, _real(circle[2])))
    if plane_count != 6 or len(cylinders) != len(holes):
        raise UnsupportedStep("unexpected planar/cylindrical face topology")
    if not edges or any(len(v) != 2 or v[0] == v[1] for v in edges.values()):
        raise UnsupportedStep("nonmanifold or incorrectly oriented shell edge")
    points = [doc.point(_ref(doc.get(i, 'VERTEX_POINT')[1])) for i in vertices]
    extents = tuple((min(p[j] for p in points), max(p[j] for p in points))
                    for j in range(3))
    expected = ((-plate['width']/2, plate['width']/2),
                (-plate['depth']/2, plate['depth']/2), (0, plate['thickness']))
    if any(not _near(a, b) for observed, target in zip(extents, expected)
           for a, b in zip(observed, target)):
        raise UnsupportedStep("STEP vertex envelope differs from authored plate")
    actual = sorted(cylinders)
    expected_holes = sorted((h['x'], h['y'], h['radius']) for h in holes)
    if any(not _near(a, b) for measured, target in zip(actual, expected_holes)
           for a, b in zip(measured, target)):
        raise UnsupportedStep("STEP cylindrical bore differs from authored hole")
    for x, y, radius in actual:
        for z in (0, plate['thickness']):
            if not any(_near(p[0], x) and _near(p[1], y) and _near(p[2], z)
                       and _near(r, radius) for p, r in circles):
                raise UnsupportedStep("missing bore circular end boundary")
    volume = (plate['width']*plate['depth'] -
              math.fsum(math.pi*r*r for _, _, r in actual))*plate['thickness']
    return {'sha256': doc.sha256, 'readback': 'independent-part21-plate-subset-v1',
            'solidCount': 1, 'faceCount': len(face_ids), 'edgeCount': len(edges),
            'vertexEnvelopeMm': [[a, b] for a, b in extents],
            'cylindricalHoles': [{'x': x, 'y': y, 'radius': r} for x, y, r in actual],
            'analyticPlateVolumeMm3': volume}


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--step', type=Path, required=True)
    p.add_argument('--intent', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    a = p.parse_args()
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from protocol import validate_request
        intent = validate_request(json.loads(a.intent.read_text('utf-8')))
        result = verify_plate_part21(a.step.read_bytes(), intent['plate'])
        a.report.write_text(json.dumps(result, allow_nan=False), encoding='utf-8')
        return 0
    except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
        print(f'Part 21 plate readback failed: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
