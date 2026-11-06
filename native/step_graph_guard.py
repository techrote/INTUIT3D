"""Conservative STEP AP214 B-rep graph admission for the OCP plate prototype.

Recognises only the observed OCP plate/single-shell shape representation.
Not a general ISO 10303 parser, geometric equivalence test or STEP consumer.
Input is the already section-delimited DATA body, never external files.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_REF = re.compile(r"#([1-9][0-9]*)\b")


@dataclass(frozen=True)
class Entity:
    kind: str
    refs: tuple[int, ...]
    expression: str


def _without_literals_and_comments(data: str) -> str:
    """Mask quoted strings and STEP /* comments while preserving references."""
    output: list[str] = []
    index = 0
    while index < len(data):
        ch = data[index]
        if ch == "'":
            output.append(' ')
            index += 1
            while index < len(data):
                if data[index] == "'":
                    if index + 1 < len(data) and data[index + 1] == "'":
                        output.extend((' ', ' '))
                        index += 2
                        continue
                    output.append(' ')
                    index += 1
                    break
                output.append(' ')
                index += 1
            else:
                raise ValueError('STEP graph: unterminated string')
        elif data.startswith('/*', index):
            output.extend((' ', ' '))
            index += 2
            end = data.find('*/', index)
            if end < 0:
                raise ValueError('STEP graph: unterminated comment')
            output.extend(' ' * (end + 2 - index))
            index = end + 2
        else:
            output.append(ch)
            index += 1
    return ''.join(output)


def verify_step_graph(body: str, *, expected_holes: int) -> None:
    """Refuse orphan/dangling B-rep surfaces or unbound mm length units.

    This is deliberately stricter than general valid STEP: only a single
    OCCT AP214 solid with an explicit closed shell and unit-bearing context
    is within this research provider's admitted envelope.
    """
    if type(expected_holes) is not int or not (0 <= expected_holes <= 64):
        raise ValueError('STEP graph: invalid expected hole count')
    masked = _without_literals_and_comments(body)
    entities: dict[int, Entity] = {}
    for statement in masked.split(';'):
        if not statement.strip():
            continue
        match = re.match(r'\s*#([1-9][0-9]*)\s*=\s*([A-Z][A-Z0-9_]*|\()', statement, re.S)
        if match is None:
            raise ValueError('STEP graph: non-entity or malformed DATA statement')
        identifier = int(match.group(1))
        if identifier in entities:
            raise ValueError('STEP graph: duplicate entity number')
        kind = match.group(2) if match.group(2) != '(' else 'COMPLEX'
        remainder = statement[match.end():]
        references = tuple(int(ref) for ref in _REF.findall(remainder))
        entities[identifier] = Entity(kind, references, remainder)
    if not entities:
        raise ValueError('STEP graph: empty DATA')
    for entity in entities.values():
        if any(ref not in entities for ref in entity.refs):
            raise ValueError('STEP graph: dangling entity reference')

    def only(kind: str) -> tuple[int, Entity]:
        items = [(ident, ent) for ident, ent in entities.items() if ent.kind == kind]
        if len(items) != 1:
            raise ValueError(f'STEP graph: expected exactly one {kind}')
        return items[0]

    solid_id, solid = only('MANIFOLD_SOLID_BREP')
    shell_id, shell = only('CLOSED_SHELL')
    _, representation = only('ADVANCED_BREP_SHAPE_REPRESENTATION')
    if solid.refs != (shell_id,) or solid_id not in representation.refs:
        raise ValueError('STEP graph: solid is not linked to its single shell and representation')
    if not shell.refs or len(set(shell.refs)) != len(shell.refs):
        raise ValueError('STEP graph: missing or duplicate shell faces')
    if any(entities[ref].kind != 'ADVANCED_FACE' for ref in shell.refs):
        raise ValueError('STEP graph: shell references non-face entities')
    all_faces = {ident for ident, ent in entities.items() if ent.kind == 'ADVANCED_FACE'}
    if all_faces != set(shell.refs):
        raise ValueError('STEP graph: unbound/orphan advanced face')

    cylinders: list[int] = []
    for face_id in shell.refs:
        face = entities[face_id]
        if len(face.refs) < 2:
            raise ValueError('STEP graph: incomplete face surface reference')
        surface_id = face.refs[-1]
        kind = entities[surface_id].kind
        if kind not in ('PLANE', 'CYLINDRICAL_SURFACE'):
            raise ValueError('STEP graph: unsupported plate surface type')
        if kind == 'CYLINDRICAL_SURFACE':
            cylinders.append(surface_id)
    declared_cylinders = {ident for ident, ent in entities.items() if ent.kind == 'CYLINDRICAL_SURFACE'}
    if (len(cylinders) != expected_holes or len(set(cylinders)) != len(cylinders)
            or set(cylinders) != declared_cylinders):
        raise ValueError('STEP graph: orphan, duplicated or missing shell-bound cylindrical hole')

    # The unit must belong to the exact context used by this shape, not to
    # some unrelated context or a spurious stand-alone LENGTH_UNIT entity.
    context_id = representation.refs[-1] if representation.refs else -1
    context = entities.get(context_id)
    if context is None or context.kind != 'COMPLEX' or 'GLOBAL_UNIT_ASSIGNED_CONTEXT' not in context.expression:
        raise ValueError('STEP graph: shape representation lacks unit context')
    units = [ref for ref in context.refs if 'LENGTH_UNIT' in entities[ref].expression]
    if len(units) != 1:
        raise ValueError('STEP graph: shape context is not bound to exactly one length unit')
    length_unit = entities[units[0]]
    if length_unit.kind != 'COMPLEX' or not re.search(
        r'\bLENGTH_UNIT\s*\(\s*\).*?\bSI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)',
        length_unit.expression, re.S,
    ):
        raise ValueError('STEP graph: context length unit is not millimetres')
