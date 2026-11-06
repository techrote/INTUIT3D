"""Conservative through-hole face-depth oracle for the experimental plate-v1 B-rep.

All curved faces of the constrained axis-aligned plate must be vertical
cylindrical sidewalls spanning *both* planar faces. This is not a generic
B-rep equivalence test or a substitute for STEP importer independence.
"""
from __future__ import annotations

import math


def require_through_cylindrical_faces(shape) -> int:
    """Reject even micro-blind cuts hidden under volume/area comparison budgets.

    Reads B-rep face topology and vertex coordinates directly, not a mesh or
    reported mass properties. The 1e-7 mm absolute / 1e-10 relative gate is
    only a geometric *comparison* budget, never a Boolean fuzzy tolerance.
    This oracle applies to the constrained plate-v1 profile, not general CAD.
    """
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder
    from OCP.TopAbs import TopAbs_FACE, TopAbs_VERTEX
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from plate_envelope import vertex_envelope_mm

    bounds = vertex_envelope_mm(shape)
    low, high = bounds['minZ'], bounds['maxZ']
    if not math.isfinite(high - low) or high <= low:
        raise ValueError('through-hole depth: invalid plate Z envelope')
    tolerance = max(1e-7, abs(high - low) * 1e-10)
    faces = TopExp_Explorer(shape, TopAbs_FACE)
    count = 0
    while faces.More():
        face = TopoDS.Face_s(faces.Current())
        surface = BRepAdaptor_Surface(face)
        if surface.GetType() == GeomAbs_Cylinder:
            count += 1
            direction_z = surface.Cylinder().Axis().Direction().Z()
            if not math.isfinite(direction_z) or abs(abs(direction_z) - 1) > 1e-10:
                raise ValueError(f'through-hole depth: cylinder {count} not vertical')
            vertices = TopExp_Explorer(face, TopAbs_VERTEX)
            z_values = []
            while vertices.More():
                z = BRep_Tool.Pnt_s(TopoDS.Vertex_s(vertices.Current())).Z()
                if not math.isfinite(z):
                    raise ValueError(f'through-hole depth: cylinder {count} nonfinite Z vertex')
                z_values.append(z)
                vertices.Next()
            if not z_values:
                raise ValueError(f'through-hole depth: cylinder {count} has no B-rep vertices')
            if abs(min(z_values) - low) > tolerance or abs(max(z_values) - high) > tolerance:
                raise ValueError(
                    f'through-hole depth: cylinder {count} spans '
                    f'[{min(z_values):.12g}, {max(z_values):.12g}] mm, '
                    f'plate spans [{low:.12g}, {high:.12g}] mm '
                    f'(comparison gate {tolerance:.3g} mm)'
                )
        faces.Next()
    return count
