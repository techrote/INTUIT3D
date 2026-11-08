"""Additive v5 selected non-orthogonal line contour contract for pinned OCCT8 C++."""
from occt8_orthogonal_contract import (
    LINEAR_SCHEMA as SCHEMA, polygon_metrics, expected_orthogonal_metrics,
    canonical_orthogonal_request, validate_orthogonal_result,
    validate_orthogonal_request)


def validate_linear_request(value):
    return validate_orthogonal_request(value, linear=True)


def canonical_linear_request(value):
    return canonical_orthogonal_request(value)


def expected_linear_metrics(value):
    return expected_orthogonal_metrics(value)


def validate_linear_result(value, response):
    return validate_orthogonal_result(value, response)


# Additive v6: pinned extrusion before first cut; preserve strict v5.
from occt8_orthogonal_contract import FLEX_SCHEMA


def validate_flexible_linear_request(value):
    return validate_orthogonal_request(value, linear=True, flexible=True)


def canonical_flexible_linear_request(value):
    return canonical_orthogonal_request(value)


def expected_flexible_linear_metrics(value):
    return expected_orthogonal_metrics(value)


def validate_flexible_linear_result(value, response):
    return validate_orthogonal_result(value, response)
