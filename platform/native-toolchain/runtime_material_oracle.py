"""Bounded independent analytic oracle for the real pinned-C++ RUNTIME demo.

The consumer must report the *authored* 120x80 plate, actual two-bore geometry
and 8/12 mm edit stages. Seven arbitrary positive volumes are not physical
material evidence. This supplements, not replaces, executed native STEP tests.
"""
from __future__ import annotations

import math


class MaterialOracleError(ValueError):
    pass


_BASE = ((-30.0, 0.0, 6.0), (30.0, 0.0, 6.0))
_RESIZED = ((-20.0, 0.0, 4.5), (20.0, 0.0, 4.5))
EXPECTED = {
    "plate-8mm-two-bores": (8.0, _BASE),
    "retrospective-12mm-rebuild": (12.0, _BASE),
    "solved-hole-spacing-and-bore-resize": (12.0, _RESIZED),
    "undo-hole-layout-rebuild": (12.0, _BASE),
    "undo-thickness-rebuild": (8.0, _BASE),
    "archive-reopen-edited-hole-layout": (12.0, _RESIZED),
    "archive-reopen-original-plate": (8.0, _BASE),
}


def check_stage(stage: str, holes: object, volume: object) -> dict:
    """Validate selected real authoring geometry, independent of receipt values."""
    if stage not in EXPECTED:
        raise MaterialOracleError(f"unsupported authored stage: {stage}")
    if not isinstance(holes, list) or len(holes) != 2:
        raise MaterialOracleError(f"{stage}: missing two-bore inventory")
    thickness, expected_holes = EXPECTED[stage]
    actual_holes = []
    for hole in holes:
        if not isinstance(hole, dict) or set(hole) != {"x", "y", "radius"}:
            raise MaterialOracleError(f"{stage}: malformed native bore")
        for key in ("x", "y", "radius"):
            value = hole[key]
            if type(value) not in (float, int) or not math.isfinite(value):
                raise MaterialOracleError(f"{stage}: non-finite bore {key}")
        actual_holes.append(tuple(float(hole[key]) for key in ("x", "y", "radius")))
    actual_holes.sort()
    for n, (actual, expected) in enumerate(zip(actual_holes, expected_holes)):
        for field, a, e in zip(("x", "y", "radius"), actual, expected):
            if not math.isclose(a, e, rel_tol=0, abs_tol=1e-7):
                raise MaterialOracleError(
                    f"{stage}: unexpected bore {n}.{field}: {a}, expected {e}")
    analytic = thickness * (
        120.0 * 80.0 - sum(math.pi * radius * radius
                           for _, _, radius in expected_holes))
    if type(volume) not in (int, float) or not math.isfinite(volume):
        raise MaterialOracleError(f"{stage}: non-finite material volume")
    # 1e-7 relative is much tighter than either dimensional edit, while allowing
    # floating-point OCCT readback. It does not admit approximate mesh volumes.
    if not math.isclose(float(volume), analytic, rel_tol=1e-7, abs_tol=1e-5):
        raise MaterialOracleError(
            f"{stage}: native volume {volume} differs from analytic plate {analytic:.9f}")
    return {
        "thicknessMm": thickness, "analyticVolumeMm3": analytic,
        "holeCentersRadii": [{"x": x, "y": y, "radius": radius}
                             for x, y, radius in expected_holes],
    }
