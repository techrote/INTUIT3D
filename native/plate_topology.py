"""Fail-closed topology inventory for experimental plate-v1 B-reps.

A validated OCCT solid may still contain an unrequested microscopic inner
cavity whose mass change falls below the declared numerical comparison.
This intentionally narrow guard admits one exterior shell, six planar
plate faces and full-circumference cylindrical hole faces. It is not a
general CAD geometry equivalence or independent STEP oracle.
"""
from __future__ import annotations

import math

MAX_PLATE_HOLES = 64
# Angular comparison on measured face parameters; not a Boolean fuzzy tolerance.
FULL_TURN_RAD = 2 * math.pi
ANGLE_COMPARISON_RAD = 1e-9


def require_plate_face_shell_topology(shape) -> int:
    """Reject surplus inner shells, faces and incomplete bores in plate-v1.

    Every other geometry/semantic gate (hole depth, XY/radii, vertex envelope,
    BRepCheck and physical invariants) remains necessary. Noncanonical CAD
    solids are deliberately unsupported rather than silently repaired.
    """
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
    from OCP.TopAbs import TopAbs_FACE, TopAbs_SHELL, TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    def count(kind) -> int:
        it, n = TopExp_Explorer(shape, kind), 0
        while it.More():
            n += 1
            it.Next()
        return n

    if count(TopAbs_SOLID) != 1 or count(TopAbs_SHELL) != 1:
        raise ValueError('plate topology: exactly one solid and one outer shell required')
    planes, cylinders = 0, 0
    faces = TopExp_Explorer(shape, TopAbs_FACE)
    while faces.More():
        surface = BRepAdaptor_Surface(TopoDS.Face_s(faces.Current()), True)
        kind = surface.GetType()
        if kind == GeomAbs_Plane:
            planes += 1
        elif kind == GeomAbs_Cylinder:
            cylinders += 1
            low, high = surface.FirstUParameter(), surface.LastUParameter()
            if not (math.isfinite(low) and math.isfinite(high) and
                    abs(high - low - FULL_TURN_RAD) <= ANGLE_COMPARISON_RAD):
                raise ValueError('plate topology: incomplete cylindrical circumference')
        else:
            raise ValueError('plate topology: unrequested curved or unsupported face')
        if planes > 6 or cylinders > MAX_PLATE_HOLES:
            raise ValueError('plate topology: excess planar or cylindrical faces')
        faces.Next()
    if planes != 6:
        raise ValueError(f'plate topology: expected six planar faces, observed {planes}')
    return cylinders
