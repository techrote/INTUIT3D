"""Versioned solved six-edge L-profile -> pinned C++ extrusion/cut admission.

This is a deliberately bounded orthogonal selected-profile subset, not an
arbitrary sketch-wire importer or a production exactness certification.
"""
from __future__ import annotations
import math
from protocol import IDENTIFIER, MAX_DIM_MM, MIN_DIM_MM
from occt8_cut_contract import (validate_mixed_cut_request,
                               validate_cut_result, cut_metrics)

SCHEMA = "intuit3d/kernel/l-profile-cut-chain-v3"


def validate_profile_request(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "protocol", "requestId", "featureId", "revision", "units",
        "profile", "cuts", "exportStep"
    } or value["protocol"] != SCHEMA:
        raise ValueError("expected l-profile-cut-chain-v3")
    p = value["profile"]
    if not isinstance(p, dict) or set(p) != {
        "profileId", "width", "depth", "thickness", "legWidth", "footHeight"
    }:
        raise ValueError("expected selected six-edge L-profile")
    if not isinstance(p["profileId"], str) or not IDENTIFIER.fullmatch(p["profileId"]):
        raise ValueError("invalid selected semantic profile ID")
    if p["profileId"] == value["featureId"]:
        raise ValueError("profile and body feature IDs must differ")
    for key in ("width", "depth", "thickness", "legWidth", "footHeight"):
        v = p[key]
        if type(v) not in (int, float) or not math.isfinite(v) or not MIN_DIM_MM <= v <= MAX_DIM_MM:
            raise ValueError("unsupported L-profile dimension: " + key)
    if p["legWidth"] >= p["width"] or p["footHeight"] >= p["depth"]:
        raise ValueError("L-profile notch must have positive width and depth")
    if not isinstance(value["cuts"], list) or len(value["cuts"]) < 2:
        raise ValueError("at least two explicitly ordered cuts are required")
    fake = {**value, "protocol": "intuit3d/kernel/plate-mixed-cut-chain-v2",
            "plate": {"width": p["width"], "depth": p["depth"],
                      "thickness": p["thickness"], "holes": []}}
    fake.pop("profile")
    validate_mixed_cut_request(fake)
    # Admit a full circular/rectangular cutter inside one convex arm only.
    for cut in value["cuts"]:
        rx = cut["radius"] if cut["kind"] == "circle" else cut["width"] / 2
        ry = cut["radius"] if cut["kind"] == "circle" else cut["depth"] / 2
        x, y = cut["x"], cut["y"]
        in_leg = (abs(x+p["width"]/2-p["legWidth"]/2)+rx < p["legWidth"]/2
                  and abs(y)+ry < p["depth"]/2)
        in_foot = (abs(x)+rx < p["width"]/2
                   and abs(y+p["depth"]/2-p["footHeight"]/2)+ry < p["footHeight"]/2)
        if not (in_leg or in_foot):
            raise ValueError("cut outside selected L-profile material")
        if cut["featureId"] == p["profileId"]:
            raise ValueError("cut ID conflicts with selected profile")
    return value


def expected_profile_metrics(request: dict) -> tuple[float, float]:
    p = request["profile"]
    fake = {**request, "plate": {"width": p["width"], "depth": p["depth"],
                              "thickness": p["thickness"], "holes": []}}
    stock_delta = (p["width"]*p["footHeight"]
                   + p["legWidth"]*(p["depth"]-p["footHeight"])
                   - p["width"]*p["depth"])
    volume, area = cut_metrics(fake)
    return volume+stock_delta*p["thickness"], area+2*stock_delta


def canonical_profile_request(request: dict) -> str:
    p = request["profile"]
    rows = ["INTUIT3D_OCCT8_L_PROFILE_CHAIN_V3",
            f'{request["requestId"]} {request["featureId"]} {request["revision"]} {int(request["exportStep"])}',
            f'{p["profileId"]} {p["width"]:.17g} {p["depth"]:.17g} '
            f'{p["thickness"]:.17g} {p["legWidth"]:.17g} {p["footHeight"]:.17g} '
            f'0 {len(request["cuts"])}']
    for c in request["cuts"]:
        circle = c["kind"] == "circle"
        width = c["radius"] if circle else c["width"]
        depth = 0 if circle else c["depth"]
        rows.append(f'{c["featureId"]} {"C" if circle else "R"} {c["x"]:.17g} '
                    f'{c["y"]:.17g} {width:.17g} {depth:.17g} {c["cutDepthMm"]:.17g}')
    return "\n".join(rows)+"\n"


def validate_profile_result(request: dict, response: dict) -> dict:
    p = request["profile"]
    fake = {**request, "plate": {"width": p["width"], "depth": p["depth"],
                              "thickness": p["thickness"], "holes": []}}
    return validate_cut_result(fake, response, expected_metrics=expected_profile_metrics(request))
