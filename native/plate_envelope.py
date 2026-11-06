"""Independent plate envelope oracle for the experimental OCCT plate worker.

The plate-v1 contract has a centered, axis-aligned rectangular plate resting at
z=0 with strictly interior cylindrical holes. As volume and area are NOT a
unique signature of width/depth/thickness, require all six extrema in addition
to the prior mass, cylinder and STEP graph checks.

Vertex extrema suffice for this constrained plate profile: all eight box
corners remain present. This is NOT a generic B-rep bounding-box oracle or a
replacement for semantic topology validation.
"""
from __future__ import annotations

import math

BOUND_KEYS = frozenset(("minX", "maxX", "minY", "maxY", "minZ", "maxZ"))


def require_plate_vertex_envelope_mm(plate: dict, bounds: object, phase: str = "geometry") -> None:
    """Reject a displaced/reshaped plate despite unchanged mass properties.

    Comparison is an explicit coordinate equivalence gate (absolute 1e-7 mm,
    relative 1e-10), never a modeling Boolean fuzzy tolerance. Never widen it
    in response to a failed fixture without separate qualification.
    """
    if type(bounds) is not dict or set(bounds) != BOUND_KEYS:
        raise ValueError(f"{phase} vertex envelope: six named axis extrema required")
    expected = {
        "minX": -plate["width"] / 2.0,
        "maxX": plate["width"] / 2.0,
        "minY": -plate["depth"] / 2.0,
        "maxY": plate["depth"] / 2.0,
        "minZ": 0.0,
        "maxZ": plate["thickness"],
    }
    for name, target in expected.items():
        observed = bounds[name]
        if type(observed) not in (int, float) or not math.isfinite(observed):
            raise ValueError(f"{phase} vertex envelope {name}: finite number required")
        tolerance = max(1e-7, abs(target) * 1e-10)
        if abs(observed - target) > tolerance:
            raise ValueError(
                f"{phase} vertex envelope {name}: {observed!r} differs from "
                f"intent {target!r} mm (coordinate gate {tolerance:g} mm)"
            )


def vertex_envelope_mm(shape) -> dict[str, float]:
    """Read true OCCT B-rep vertex coordinates, not a preview tessellation.

    Dynamic imports allow the pure analytic refusal tests to run without OCP;
    actual STEP/source coordinate acquisition requires the pinned OCP runtime.
    """
    from OCP.BRep import BRep_Tool
    from OCP.TopAbs import TopAbs_VERTEX
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    vertices = TopExp_Explorer(shape, TopAbs_VERTEX)
    first = True
    bounds: dict[str, float] = {}
    while vertices.More():
        point = BRep_Tool.Pnt_s(TopoDS.Vertex_s(vertices.Current()))
        coordinates = (point.X(), point.Y(), point.Z())
        if not all(math.isfinite(value) for value in coordinates):
            raise ValueError("nonfinite OCCT source/STEP B-rep vertex")
        if first:
            bounds = dict(zip(("minX", "minY", "minZ"), coordinates))
            bounds.update(zip(("maxX", "maxY", "maxZ"), coordinates))
            first = False
        else:
            for axis, value in zip(("X", "Y", "Z"), coordinates):
                bounds["min" + axis] = min(bounds["min" + axis], value)
                bounds["max" + axis] = max(bounds["max" + axis], value)
        vertices.Next()
    if first:
        raise ValueError("OCCT source/STEP shape contains no B-rep vertices")
    return bounds
