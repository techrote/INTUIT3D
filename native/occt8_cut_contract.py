"""Versioned pinned OCCT8 plate + ordered rectangular cut request and mass oracle.

Only axis-aligned, strictly interior and pairwise disjoint pockets are admitted
by this first C++ provider. Unadmitted profiles must remain pending in the
authoritative journal; no preview or approximate geometry is exported as exact.
"""
from __future__ import annotations

import math
from protocol import IDENTIFIER, MAX_DIM_MM, MIN_DIM_MM, close, validate_request

SCHEMA = "intuit3d/kernel/plate-cut-chain-v1"


def validate_cut_request(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "protocol", "requestId", "featureId", "revision", "units",
        "plate", "cuts", "exportStep"
    } or value["protocol"] != SCHEMA:
        raise ValueError("expected versioned plate-cut-chain-v1 request")
    base = {key: item for key, item in value.items() if key != "cuts"}
    base["protocol"] = "intuit3d/kernel/plate-v1"
    validate_request(base)
    cuts = value["cuts"]
    if not isinstance(cuts, list) or not (1 <= len(cuts) <= 16):
        raise ValueError("expected one to sixteen explicitly ordered cuts")
    p = value["plate"]
    seen = {value["featureId"]}
    for i, cut in enumerate(cuts):
        if not isinstance(cut, dict) or set(cut) != {
            "featureId", "x", "y", "width", "depth", "cutDepthMm"
        }:
            raise ValueError(f"cut {i}: invalid fields")
        ident = cut["featureId"]
        if not isinstance(ident, str) or IDENTIFIER.fullmatch(ident) is None or ident in seen:
            raise ValueError(f"cut {i}: invalid or duplicate semantic feature ID")
        seen.add(ident)
        for key in ("x", "y", "width", "depth", "cutDepthMm"):
            v = cut[key]
            if type(v) not in (int, float) or not math.isfinite(v):
                raise ValueError(f"cut {i}: {key} must be finite")
            if key not in ("x", "y") and not (MIN_DIM_MM <= v <= MAX_DIM_MM):
                raise ValueError(f"cut {i}: {key} outside supported dimension range")
        if cut["cutDepthMm"] > p["thickness"]:
            raise ValueError(f"cut {i}: blind depth exceeds plate thickness")
        if not (abs(cut["x"]) + cut["width"]/2 < p["width"]/2 and
                abs(cut["y"]) + cut["depth"]/2 < p["depth"]/2):
            raise ValueError(f"cut {i}: rectangular tool is not strictly inside plate")
        for hole in p["holes"]:
            dx = max(0., abs(hole["x"] - cut["x"]) - cut["width"]/2)
            dy = max(0., abs(hole["y"] - cut["y"]) - cut["depth"]/2)
            if math.hypot(dx, dy) <= hole["radius"]:
                raise ValueError(f"cut {i}: intersects or touches circular bore")
        for before in cuts[:i]:
            if (abs(cut["x"] - before["x"]) <= (cut["width"] + before["width"])/2 and
                    abs(cut["y"] - before["y"]) <= (cut["depth"] + before["depth"])/2):
                raise ValueError(f"cut {i}: intersects or touches earlier cut")
    return value


def cut_metrics(request: dict) -> tuple[float, float]:
    p = request["plate"]
    holes_area = math.fsum(math.pi * h["radius"]**2 for h in p["holes"])
    bore_perimeter = math.fsum(2*math.pi*h["radius"] for h in p["holes"])
    volume = (p["width"]*p["depth"] - holes_area)*p["thickness"]
    area = 2*(p["width"]*p["depth"]-holes_area) + (
        2*(p["width"]+p["depth"])+bore_perimeter)*p["thickness"]
    for cut in request["cuts"]:
        w, d, height = cut["width"], cut["depth"], cut["cutDepthMm"]
        volume -= w*d*height
        area += 2*(w+d)*height
        if height == p["thickness"]:
            area -= 2*w*d
    return volume, area


def validate_cut_result(request: dict, report: object) -> dict:
    if not isinstance(report, dict) or set(report) != {
        "protocol", "requestId", "featureId", "revision", "backend",
        "occtVersion", "status", "units", "source", "stepReadback", "stepWritten"
    }:
        raise ValueError("invalid OCCT8 cut result schema")
    for key in ("protocol", "requestId", "featureId", "revision"):
        if report[key] != request[key]:
            raise ValueError(f"native cut {key} does not match authored request")
    if (report["backend"], report["occtVersion"], report["status"], report["units"]) != (
        "OCCT-cxx-8.0.1", "8.0.1", "validated_exact", "mm"
    ):
        raise ValueError("unsupported or unvalidated OCCT8 cut result")
    if type(report["stepWritten"]) is not bool or report["stepWritten"] != request["exportStep"]:
        raise ValueError("STEP status disagrees with authored request")
    expected_volume, expected_area = cut_metrics(request)
    holes = sorted(request["plate"]["holes"], key=lambda h: (h["x"], h["y"], h["radius"]))
    for name in ("source", "stepReadback"):
        m = report[name]
        if name == "stepReadback" and not request["exportStep"]:
            if m is not None:
                raise ValueError("unexpected STEP readback")
            continue
        if not isinstance(m, dict) or set(m) != {
            "valid", "solidCount", "volumeMm3", "surfaceAreaMm2", "cylindricalHoles"
        } or m["valid"] is not True or type(m["solidCount"]) is not int or m["solidCount"] != 1:
            raise ValueError(f"{name}: invalid B-rep body report")
        if (type(m["volumeMm3"]) not in (int, float) or
                not close(m["volumeMm3"], expected_volume) or
                type(m["surfaceAreaMm2"]) not in (int, float) or
                not close(m["surfaceAreaMm2"], expected_area)):
            raise ValueError(f"{name}: analytic material/area mismatch")
        observed = m["cylindricalHoles"]
        if not isinstance(observed, list) or len(observed) != len(holes):
            raise ValueError(f"{name}: circular hole topology differs")
        for actual, expected in zip(observed, holes):
            if not isinstance(actual, dict) or set(actual) != {"x", "y", "radius", "axisZ"}:
                raise ValueError(f"{name}: malformed cylindrical hole")
            for key in ("x", "y", "radius"):
                if (type(actual[key]) not in (int, float) or not math.isfinite(actual[key]) or
                        abs(actual[key]-expected[key]) > max(1e-11, abs(expected[key])*1e-9)):
                    raise ValueError(f"{name}: missing/displaced bore")
            if (type(actual["axisZ"]) not in (int, float) or
                    not math.isfinite(actual["axisZ"]) or
                    abs(abs(actual["axisZ"])-1)>1e-10):
                raise ValueError(f"{name}: bore axis is not vertical")
    return report


def canonical_cut_request(request: dict) -> str:
    p = request["plate"]
    parts = ["INTUIT3D_OCCT8_CUT_CHAIN_V1",
             f'{request["requestId"]} {request["featureId"]} {request["revision"]} {int(request["exportStep"])}',
             f'{p["width"]:.17g} {p["depth"]:.17g} {p["thickness"]:.17g} {len(p["holes"])} {len(request["cuts"])}']
    parts += [f'{h["x"]:.17g} {h["y"]:.17g} {h["radius"]:.17g}' for h in p["holes"]]
    parts += [f'{c["featureId"]} {c["x"]:.17g} {c["y"]:.17g} {c["width"]:.17g} {c["depth"]:.17g} {c["cutDepthMm"]:.17g}'
              for c in request["cuts"]]
    return "\n".join(parts)+"\n"
