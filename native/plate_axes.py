"""Fail-closed analytic planar-orientation oracle for plate-v1 OCCT solids.

A sub-microradian rotation of a whole plate preserves exact volume, area,
face count and shell count; it can also pass the explicitly budgeted vertex
extrema comparison. For the *axis-aligned* plate-v1 intent, the six planar
faces must be supported by two planes normal to each Cartesian axis.

This measures B-rep support-surface normals; it does not alter geometry,
relax modelling tolerances, or certify general B-rep/STEP interoperability.
"""
from __future__ import annotations

import math

# Maximum off-axis *direction component*. This is an angular comparison
# threshold for the restricted analytic plate-v1 contract, not OCCT fuzzy
# Boolean tolerance and not a deviation limit for arbitrary CAD surfaces.
MAX_OFF_AXIS_COMPONENT = 1e-10
AXES = ("X", "Y", "Z")


def classify_cardinal_normal(vector: object) -> str:
    """Return normal's axis independently of face orientation or parameterization.

    The measured direction must be a genuine unit vector with both other
    components small. Use off-axis components instead of dot(normal,axis):
    cosine rounds to 1 at angles below ~1e-8 radians in binary64.
    """
    if (type(vector) not in (tuple, list) or len(vector) != 3
            or any(type(value) not in (float, int) or not math.isfinite(value) for value in vector)):
        raise ValueError("plate axes: finite numeric normal triple required")
    length = math.hypot(*vector)
    if not math.isfinite(length) or abs(length - 1.0) > 1e-12:
        raise ValueError("plate axes: normalized B-rep plane direction required")
    components = tuple(abs(value) for value in vector)
    axis = max(range(3), key=components.__getitem__)
    if any(value > MAX_OFF_AXIS_COMPONENT for i, value in enumerate(components) if i != axis):
        raise ValueError("plate axes: non-cardinal planar support surface")
    return AXES[axis]


def require_plate_axis_aligned_planes(shape) -> None:
    """Validate two X, two Y and two Z support planes on the actual B-rep.

    Existing one-solid, one-shell, six-plane, envelope, wall-depth and hole
    checks remain mandatory. This complementary check runs for both authoring
    and independently supervised same-OCCT STEP readback via solid_properties.
    """
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Plane
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    planes = {axis: 0 for axis in AXES}
    faces = TopExp_Explorer(shape, TopAbs_FACE)
    count = 0
    while faces.More():
        count += 1
        if count > 70:  # Six plate planes plus bounded 64 hole faces.
            raise ValueError("plate axes: unexpected excess face count")
        face = BRepAdaptor_Surface(TopoDS.Face_s(faces.Current()), True)
        if face.GetType() == GeomAbs_Plane:
            direction = face.Plane().Axis().Direction()
            axis = classify_cardinal_normal((direction.X(), direction.Y(), direction.Z()))
            planes[axis] += 1
            if planes[axis] > 2:
                raise ValueError(f"plate axes: more than two {axis} support planes")
        faces.Next()
    if planes != {axis: 2 for axis in AXES}:
        raise ValueError(f"plate axes: expected paired X/Y/Z support planes, observed {planes}")
