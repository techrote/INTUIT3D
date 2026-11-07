"""Independent CAD bore-wall sampling contract for bounded STEP plate fixtures.

Centres and total removed volume alone cannot establish hole radii: different
radius pairs with the same sum of squared radii produce identical volume and
empty centre rays. Sample both sides of each of four cardinal bore walls.
These probes must be executed by the independent imported-geometry engine.
"""
from __future__ import annotations

import math


def bore_wall_probes(case: dict) -> list[tuple[str, float, float, float, str]]:
    """Return ordered (name, x, y, ray-start-z, expected occupancy) probes.

    Only unambiguous disjoint, internal, through circular bores are supported.
    The offset is a bounded *sampling distance*, not an asserted CAD tolerance.
    """
    width = float(case['widthMm'])
    depth = float(case['depthMm'])
    thickness = float(case['thicknessMm'])
    holes = [(float(h['x']), float(h['y']), float(h['radius']))
             for h in case['holes']]
    if (not all(math.isfinite(v) for v in (width, depth, thickness))
            or min(width, depth, thickness) <= 0 or len(holes) < 2):
        raise ValueError('unsupported physical bore fixture dimensions')
    for x, y, r in holes:
        if (not all(math.isfinite(v) for v in (x, y, r)) or r <= 0
                or abs(x) + r >= width / 2 or abs(y) + r >= depth / 2):
            raise ValueError('bore is not unambiguously internal to the plate')
    for i, (x, y, r) in enumerate(holes):
        for ox, oy, other_radius in holes[i + 1:]:
            if math.hypot(x - ox, y - oy) <= r + other_radius:
                raise ValueError('overlapping/touching bores lack isolated wall samples')

    probes: list[tuple[str, float, float, float, str]] = []
    for i, (x, y, r) in enumerate(holes):
        offset = min(0.75, r * 0.15)
        for label, dx, dy in (('east', 1., 0.), ('west', -1., 0.),
                              ('north', 0., -1.), ('south', 0., 1.)):
            inner = (x + dx * (r - offset), y + dy * (r - offset))
            outer = (x + dx * (r + offset), y + dy * (r + offset))
            if (abs(outer[0]) >= width / 2 or abs(outer[1]) >= depth / 2
                    or any(math.hypot(outer[0] - ox, outer[1] - oy) <= other_radius
                           for j, (ox, oy, other_radius) in enumerate(holes) if j != i)):
                raise ValueError('bore-wall material sample overlaps another void or exterior')
            probes.append((f'hole.{i}.inner.{label}', *inner, thickness + 5., 'empty'))
            probes.append((f'hole.{i}.outer.{label}', *outer, thickness + 5., 'solid'))
    return probes
