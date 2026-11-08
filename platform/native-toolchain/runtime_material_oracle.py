"""Bounded independent analytic oracle for the real pinned-C++ RUNTIME demo.

The consumer must report the *authored* 120x80 plate, actual two-bore geometry
and 8/12 mm edit stages. Seven arbitrary positive volumes are not physical
material evidence. This supplements, not replaces, executed native STEP tests.
"""
from __future__ import annotations

import math
import json
from pathlib import Path
import subprocess

from execution_environment import sealed_env


class MaterialOracleError(ValueError):
    pass


_BASE = ((-25.0, 0.0, 6.0), (25.0, 0.0, 6.0))
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



# This is intentionally evaluated from the immutable RUNTIME checkout, rather
# than another PLATFORM copy of the SKETCH fixture. The real RUNTIME demo uses
# plateSketchFixture(); its authored hole centers are at x=35/85 within the
# [0,120] plate, hence native local x=-25/+25 (not -30/+30).
_SKETCH_FIXTURE_EVAL = r"""
import {plateSketchFixture} from './packages/sketch/index.mjs';
const fixture=plateSketchFixture();
const points=new Map(fixture.points.map(p=>[p.id,p]));
const boundaryIds=new Set(fixture.lines.flatMap(line=>[line.start,line.end]));
const boundary=[...boundaryIds].map(id=>points.get(id));
if(boundary.length!==4||boundary.some(p=>!p))throw Error('expected four plate corners');
const minX=Math.min(...boundary.map(p=>p.x)),maxX=Math.max(...boundary.map(p=>p.x));
const minY=Math.min(...boundary.map(p=>p.y)),maxY=Math.max(...boundary.map(p=>p.y));
const corners=new Set(boundary.map(p=>`${p.x},${p.y}`));
if(corners.size!==4 || ![minX,maxX].every(x=>[minY,maxY].every(y=>corners.has(`${x},${y}`))))
  throw Error('authored plate is not a rectangle');
const holes=fixture.circles.map(c=>{
  const p=points.get(c.center);
  if(!p)throw Error('missing authored hole center');
  return {x:p.x-(minX+maxX)/2,y:p.y-(minY+maxY)/2,radius:c.radius};
});
console.log(JSON.stringify({units:fixture.units,width:maxX-minX,height:maxY-minY,holes}));
"""


def verify_runtime_sketch_fixture(runtime_tree: Path, node: str = "node") -> dict:
    """Require the real source-matched SKETCH fixture to agree with this oracle.

    This catches independent PLATFORM drift before the expensive seven-stage
    C++ demo; a synthetic receipt matching stale PLATFORM values cannot pass.
    Actual C++/STEP execution is still separately mandatory.
    """
    try:
        result = subprocess.run([node, "--input-type=module", "--eval",
                                 _SKETCH_FIXTURE_EVAL],
                                cwd=runtime_tree, capture_output=True, text=True,
                                timeout=30, check=False, env=sealed_env())
    except (OSError, subprocess.SubprocessError) as exc:
        raise MaterialOracleError("cannot evaluate source-matched SKETCH fixture") from exc
    if result.returncode:
        raise MaterialOracleError("source-matched SKETCH fixture failed: " + result.stderr[-700:])
    try:
        fixture = json.loads(result.stdout)
    except (TypeError, ValueError) as exc:
        raise MaterialOracleError("source-matched SKETCH fixture returned invalid JSON") from exc
    if not isinstance(fixture, dict) or fixture.get("units") != "mm":
        raise MaterialOracleError("source-matched SKETCH fixture has wrong units")
    for key, expected in (("width", 120.0), ("height", 80.0)):
        value = fixture.get(key)
        if type(value) not in (int, float) or not math.isfinite(value) or not math.isclose(value, expected, abs_tol=1e-9, rel_tol=0):
            raise MaterialOracleError("source-matched SKETCH fixture has wrong " + key)
    holes = fixture.get("holes")
    if not isinstance(holes, list) or len(holes) != 2:
        raise MaterialOracleError("source-matched SKETCH fixture lacks two circular bores")
    actual = []
    for hole in holes:
        if not isinstance(hole, dict) or set(hole) != {"x", "y", "radius"}:
            raise MaterialOracleError("source-matched SKETCH fixture has malformed bore")
        if any(type(hole[k]) not in (int, float) or not math.isfinite(hole[k]) for k in ("x", "y", "radius")):
            raise MaterialOracleError("source-matched SKETCH fixture has non-finite bore")
        actual.append((float(hole["x"]), float(hole["y"]), float(hole["radius"])))
    for measured, expected in zip(sorted(actual), _BASE):
        if any(not math.isclose(a, b, abs_tol=1e-9, rel_tol=0) for a, b in zip(measured, expected)):
            raise MaterialOracleError(
                f"source-matched SKETCH authored bore {measured} differs from PLATFORM {expected}")
    return {"authoredPlateWidthMm": fixture["width"],
            "authoredPlateHeightMm": fixture["height"],
            "authoredBoresLocalMm": [{"x": x, "y": y, "radius": radius} for x,y,radius in sorted(actual)]}


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
