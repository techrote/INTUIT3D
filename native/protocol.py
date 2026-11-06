"""Versioned, fail-closed plate IPC contract. Standard-library only.

Request geometry is authoritative user intent; worker B-reps are ephemeral.
Every field is validated before invoking a native/CAD backend.
"""
from __future__ import annotations

import math
import re
from typing import TypedDict

SCHEMA = "intuit3d/kernel/plate-v1"
IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,127}$")
MAX_HOLES = 64
MAX_DIM_MM = 1_000_000.0
MIN_DIM_MM = 1e-6


class Hole(TypedDict):
    x: float
    y: float
    radius: float


class Plate(TypedDict):
    width: float
    depth: float
    thickness: float
    holes: list[Hole]


class PlateRequest(TypedDict):
    protocol: str
    requestId: str
    featureId: str
    revision: int
    units: str
    plate: Plate
    exportStep: bool


class InvalidRequest(ValueError):
    pass


def _object(value: object, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise InvalidRequest(f"{label}: expected exactly {sorted(keys)}")
    return value


def _finite(value: object, label: str, minimum: float | None = None) -> float:
    if type(value) not in (int, float) or not math.isfinite(value):
        raise InvalidRequest(f"{label}: finite numeric value required")
    number = float(value)
    if minimum is not None and not (minimum <= number <= MAX_DIM_MM):
        raise InvalidRequest(f"{label}: out of supported range [{minimum}, {MAX_DIM_MM}]")
    return number


def validate_request(value: object) -> PlateRequest:
    doc = _object(value, {"protocol", "requestId", "featureId", "revision", "units", "plate", "exportStep"}, "request")
    if doc["protocol"] != SCHEMA or doc["units"] != "mm":
        raise InvalidRequest("unsupported protocol or units (millimetres only)")
    for key in ("requestId", "featureId"):
        if not isinstance(doc[key], str) or IDENTIFIER.fullmatch(doc[key]) is None:
            raise InvalidRequest(f"{key}: invalid semantic identifier")
    if type(doc["revision"]) is not int or not (0 <= doc["revision"] < 2**53):
        raise InvalidRequest("revision must be a nonnegative safe integer")
    if type(doc["exportStep"]) is not bool:
        raise InvalidRequest("exportStep must be boolean")
    plate = _object(doc["plate"], {"width", "depth", "thickness", "holes"}, "plate")
    width = _finite(plate["width"], "width", MIN_DIM_MM)
    depth = _finite(plate["depth"], "depth", MIN_DIM_MM)
    _finite(plate["thickness"], "thickness", MIN_DIM_MM)
    holes = plate["holes"]
    if not isinstance(holes, list) or len(holes) > MAX_HOLES:
        raise InvalidRequest(f"holes: expected list of at most {MAX_HOLES}")
    for i, hole in enumerate(holes):
        obj = _object(hole, {"x", "y", "radius"}, f"hole {i}")
        x = _finite(obj["x"], f"hole {i}.x")
        y = _finite(obj["y"], f"hole {i}.y")
        radius = _finite(obj["radius"], f"hole {i}.radius", MIN_DIM_MM)
        # Strictly interior holes; do not infer that boundary-touching cuts are valid.
        if not (abs(x) + radius < width / 2 and abs(y) + radius < depth / 2):
            raise InvalidRequest(f"hole {i}: outside or tangent to plate boundary")
        for j, previous in enumerate(holes[:i]):
            if math.hypot(x - previous["x"], y - previous["y"]) <= radius + previous["radius"]:
                raise InvalidRequest(f"hole {i}: overlapping or tangent to hole {j}")
    return doc  # type: ignore[return-value]


def analytic_invariants(plate: Plate) -> tuple[float, float]:
    """Independent elementary analytic target, never a replacement for B-rep."""
    width, depth, thickness = plate["width"], plate["depth"], plate["thickness"]
    cuts = math.fsum(math.pi * h["radius"] ** 2 for h in plate["holes"])
    wall = math.fsum(2 * math.pi * h["radius"] for h in plate["holes"])
    return (width * depth - cuts) * thickness, 2 * (width * depth - cuts) + (2 * (width + depth) + wall) * thickness


def close(actual: float, expected: float) -> bool:
    # Explicit numerical comparison; not a Boolean fuzzy modelling tolerance.
    return math.isfinite(actual) and abs(actual - expected) <= max(1e-7, abs(expected) * 1e-10)


def validate_result(request: PlateRequest, response: object) -> dict:
    result = _object(response, {"protocol", "requestId", "featureId", "revision", "backend", "occtVersion", "status", "units", "source", "stepReadback", "stepWritten"}, "response")
    if (result["protocol"], result["requestId"], result["featureId"], result["revision"], result["units"]) != (SCHEMA, request["requestId"], request["featureId"], request["revision"], "mm"):
        raise ValueError("mismatched response identity, revision or protocol")
    if result["backend"] != "OCP-python-prototype" or not isinstance(result["occtVersion"], str):
        raise ValueError("unsupported or unversioned geometry backend")
    if result["status"] != "validated_exact":
        raise ValueError("worker did not report validated_exact")
    if type(result["stepWritten"]) is not bool or result["stepWritten"] != request["exportStep"]:
        raise ValueError("STEP export status does not match request")
    expected_volume, expected_area = analytic_invariants(request["plate"])
    for field in ("source", "stepReadback"):
        obj = result[field]
        if field == "stepReadback" and not request["exportStep"] and obj is None:
            continue
        _object(obj, {"valid", "solidCount", "volumeMm3", "surfaceAreaMm2", "cylindricalHoles"}, field)
        if obj["valid"] is not True or type(obj["solidCount"]) is not int or obj["solidCount"] != 1:
            raise ValueError(f"{field}: invalid or unexpected body topology")
        for metric, target in (("volumeMm3", expected_volume), ("surfaceAreaMm2", expected_area)):
            if type(obj[metric]) not in (int, float) or not close(float(obj[metric]), target):
                raise ValueError(f"{field}: {metric} fails analytic oracle")
        # Aggregate volume/area alone can hide lost micro-holes. Reject absent,
        # displaced, spurious, non-cylindrical or non-vertical through-holes.
        actual_holes = obj["cylindricalHoles"]
        expected_holes = sorted(request["plate"]["holes"], key=lambda h: (h["x"], h["y"], h["radius"]))
        if not isinstance(actual_holes, list) or len(actual_holes) != len(expected_holes):
            raise ValueError(f"{field}: expected cylindrical hole topology absent or duplicated")
        for index, (actual, expected) in enumerate(zip(actual_holes, expected_holes)):
            _object(actual, {"x", "y", "radius", "axisZ"}, f"{field}.cylinder{index}")
            for key in ("x", "y", "radius"):
                value = actual[key]
                # OCCT STEP round-tripping may shift least-significant bits;
                # this explicit comparison is NOT a modelling fuzzy tolerance.
                tolerance = max(1e-11, abs(expected[key]) * 1e-9)
                if type(value) not in (int, float) or not math.isfinite(value) or abs(value - expected[key]) > tolerance:
                    raise ValueError(f"{field}: cylinder {index} has wrong {key}")
            axis = actual["axisZ"]
            if type(axis) not in (int, float) or not math.isfinite(axis) or abs(abs(axis) - 1) > 1e-10:
                raise ValueError(f"{field}: cylinder {index} not vertical")
    return result
