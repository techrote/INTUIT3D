"""Pinned OCCT8 orthogonal selected-profile v4: any simple CCW rectilinear contour.

This admits a bounded solved SKETCH contour and explicitly ordered disjoint
circular/rectangular blind or through cuts. No arcs, islands, face healing or
preview->exact promotion. Coordinates are in the selected sketch's local mm.
"""
from __future__ import annotations

import math
from protocol import IDENTIFIER, MIN_DIM_MM, MAX_DIM_MM
from occt8_cut_contract import (validate_mixed_cut_request, validate_cut_result)

SCHEMA = "intuit3d/kernel/orthogonal-profile-cut-chain-v4"
MAX_VERTICES = 64


def _intersect(a, b, c, d):
    """Inclusive axis-aligned segment intersection, including collinear touch."""
    if a["x"] == b["x"] and c["x"] == d["x"]:
        return a["x"] == c["x"] and max(min(a["y"], b["y"]), min(c["y"], d["y"])) <= min(max(a["y"], b["y"]), max(c["y"], d["y"]))
    if a["y"] == b["y"] and c["y"] == d["y"]:
        return a["y"] == c["y"] and max(min(a["x"], b["x"]), min(c["x"], d["x"])) <= min(max(a["x"], b["x"]), max(c["x"], d["x"]))
    if a["x"] == b["x"]:
        return min(c["x"], d["x"]) <= a["x"] <= max(c["x"], d["x"]) and min(a["y"], b["y"]) <= c["y"] <= max(a["y"], b["y"])
    return min(a["x"], b["x"]) <= c["x"] <= max(a["x"], b["x"]) and min(c["y"], d["y"]) <= a["y"] <= max(c["y"], d["y"])


def _point_inside(vertices, x, y):
    inside = False
    for i, a in enumerate(vertices):
        b = vertices[(i + 1) % len(vertices)]
        if (a["y"] > y) != (b["y"] > y):
            intersection = a["x"] + (y - a["y"]) * (b["x"] - a["x"]) / (b["y"] - a["y"])
            if x < intersection:
                inside = not inside
    return inside


def _cut_clear_of_boundary(vertices, cut):
    x, y = cut["x"], cut["y"]
    if not _point_inside(vertices, x, y):
        return False
    circle = cut["kind"] == "circle"
    radius = cut["radius"] if circle else 0
    rx = radius if circle else cut["width"] / 2
    ry = radius if circle else cut["depth"] / 2
    for i, a in enumerate(vertices):
        b = vertices[(i + 1) % len(vertices)]
        if a["x"] == b["x"]:
            dy = max(0.0, min(a["y"], b["y"]) - y, y - max(a["y"], b["y"]))
            if circle:
                if math.hypot(x - a["x"], dy) <= radius:
                    return False
            elif x-rx <= a["x"] <= x+rx and min(a["y"], b["y"]) <= y+ry and max(a["y"], b["y"]) >= y-ry:
                return False
        else:
            dx = max(0.0, min(a["x"], b["x"]) - x, x - max(a["x"], b["x"]))
            if circle:
                if math.hypot(y - a["y"], dx) <= radius:
                    return False
            elif y-ry <= a["y"] <= y+ry and min(a["x"], b["x"]) <= x+rx and max(a["x"], b["x"]) >= x-rx:
                return False
    return True


def polygon_metrics(vertices):
    twice_area = math.fsum(
        a["x"] * vertices[(i + 1) % len(vertices)]["y"] -
        vertices[(i + 1) % len(vertices)]["x"] * a["y"]
        for i, a in enumerate(vertices))
    perimeter = math.fsum(
        abs(a["x"] - vertices[(i + 1) % len(vertices)]["x"]) +
        abs(a["y"] - vertices[(i + 1) % len(vertices)]["y"])
        for i, a in enumerate(vertices))
    return twice_area / 2, perimeter


def validate_orthogonal_request(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "protocol", "requestId", "featureId", "revision", "units",
        "profile", "cuts", "exportStep"
    } or value["protocol"] != SCHEMA:
        raise ValueError("expected orthogonal-profile-cut-chain-v4")
    for field in ("requestId", "featureId"):
        if not isinstance(value[field], str) or not IDENTIFIER.fullmatch(value[field]):
            raise ValueError("invalid semantic identity")
    if type(value["revision"]) is not int or not 0 <= value["revision"] < 2**53:
        raise ValueError("invalid revision")
    if value["units"] != "mm" or type(value["exportStep"]) is not bool:
        raise ValueError("invalid units or export flag")
    p = value["profile"]
    if not isinstance(p, dict) or set(p) != {"profileId", "thickness", "vertices"}:
        raise ValueError("invalid selected profile")
    if not isinstance(p["profileId"], str) or not IDENTIFIER.fullmatch(p["profileId"]) or p["profileId"] == value["featureId"]:
        raise ValueError("invalid selected profile ID")
    thickness = p["thickness"]
    if type(thickness) not in (int, float) or not math.isfinite(thickness) or not MIN_DIM_MM <= thickness <= MAX_DIM_MM:
        raise ValueError("invalid extrusion thickness")
    v = p["vertices"]
    if not isinstance(v, list) or not 6 <= len(v) <= MAX_VERTICES:
        raise ValueError("expected six to 64 rectilinear contour vertices")
    for i, a in enumerate(v):
        if not isinstance(a, dict) or set(a) != {"x", "y"} or any(
                type(a[k]) not in (int, float) or not math.isfinite(a[k]) or abs(a[k]) > MAX_DIM_MM for k in ("x", "y")):
            raise ValueError(f"vertex {i}: finite bounded XY required")
        b = v[(i + 1) % len(v)]
        if not isinstance(b, dict) or set(b) != {"x", "y"}:
            raise ValueError("invalid next contour vertex")
        dx, dy = abs(b["x"] - a["x"]), abs(b["y"] - a["y"])
        if not ((dx >= MIN_DIM_MM and dy == 0) or (dy >= MIN_DIM_MM and dx == 0)):
            raise ValueError("non-orthogonal or degenerate contour edge")
    for i in range(len(v)):
        a, b = v[i], v[(i + 1) % len(v)]
        c = v[(i + 1) % len(v)]
        d = v[(i + 2) % len(v)]
        if (a["x"] == b["x"]) == (c["x"] == d["x"]):
            raise ValueError("consecutive collinear contour edges not admitted")
        for j in range(i + 1, len(v)):
            if j == i + 1 or (i == 0 and j == len(v)-1):
                continue
            if _intersect(a, b, v[j], v[(j + 1) % len(v)]):
                raise ValueError("self-intersecting or touching selected profile")
    area, perimeter = polygon_metrics(v)
    if not area > MIN_DIM_MM or not math.isfinite(area) or not math.isfinite(perimeter):
        raise ValueError("selected contour must be simple counterclockwise with positive material area")
    if not isinstance(value["cuts"], list) or not 2 <= len(value["cuts"]) <= 16:
        raise ValueError("expected two to sixteen ordered blind/through cuts")
    xs, ys = [a["x"] for a in v], [a["y"] for a in v]
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    cx, cy = (xmin+xmax)/2, (ymin+ymax)/2
    transformed = [{**c, "x": c.get("x", 0)-cx, "y": c.get("y", 0)-cy}
                   for c in value["cuts"]]
    validate_mixed_cut_request({
        "protocol": "intuit3d/kernel/plate-mixed-cut-chain-v2",
        "requestId": value["requestId"], "featureId": value["featureId"],
        "revision": value["revision"], "units": value["units"],
        "plate": {"width": xmax-xmin, "depth": ymax-ymin,
                  "thickness": thickness, "holes": []},
        "cuts": transformed, "exportStep": value["exportStep"]
    })
    for c in value["cuts"]:
        if c["featureId"] == p["profileId"]:
            raise ValueError("cut feature ID conflicts with selected sketch")
        if not _cut_clear_of_boundary(v, c):
            raise ValueError("cut touches selected profile boundary or empty material")
    return value


def expected_orthogonal_metrics(request: dict) -> tuple[float, float]:
    area, perimeter = polygon_metrics(request["profile"]["vertices"])
    t = request["profile"]["thickness"]
    volume = area*t
    surface = 2*area + perimeter*t
    for c in request["cuts"]:
        if c["kind"] == "circle":
            footprint = math.pi*c["radius"]**2
            wall = 2*math.pi*c["radius"]
        else:
            footprint = c["width"]*c["depth"]
            wall = 2*(c["width"]+c["depth"])
        volume -= footprint*c["cutDepthMm"]
        surface += wall*c["cutDepthMm"]
        if c["cutDepthMm"] == t:
            surface -= 2*footprint
    return volume, surface


def canonical_orthogonal_request(request: dict) -> str:
    p = request["profile"]
    rows = ["INTUIT3D_OCCT8_ORTHOGONAL_CHAIN_V4",
            f'{request["requestId"]} {request["featureId"]} {request["revision"]} {int(request["exportStep"])}',
            f'{p["profileId"]} {p["thickness"]:.17g} {len(p["vertices"])} {len(request["cuts"])}']
    rows += [f'{v["x"]:.17g} {v["y"]:.17g}' for v in p["vertices"]]
    for c in request["cuts"]:
        circle = c["kind"] == "circle"
        rows.append(f'{c["featureId"]} {"C" if circle else "R"} {c["x"]:.17g} {c["y"]:.17g} '
                    f'{(c["radius"] if circle else c["width"]):.17g} '
                    f'{(0 if circle else c["depth"]):.17g} {c["cutDepthMm"]:.17g}')
    return "\n".join(rows)+"\n"


def validate_orthogonal_result(request: dict, response: dict) -> dict:
    p = request["profile"]
    xs, ys = [v["x"] for v in p["vertices"]], [v["y"] for v in p["vertices"]]
    fake = {**request, "plate": {
        "width": max(xs)-min(xs), "depth": max(ys)-min(ys),
        "thickness": p["thickness"], "holes": []}}
    return validate_cut_result(fake, response, expected_metrics=expected_orthogonal_metrics(request))
