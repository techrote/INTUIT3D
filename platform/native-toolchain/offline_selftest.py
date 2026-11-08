#!/usr/bin/env python3
"""Re-execute the archived OCCT8 worker after relocation, without a source checkout.

This is a production C++/STEP *offline replay*, not independent CAD acceptance.
Run from an extracted verified bundle using: python3 selftest.py
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

# The bundle is content-addressed: importing local modules must not create
# unmanifested __pycache__ files before or during its mandatory verification.
sys.dont_write_bytecode = True
from replay_evidence import EvidenceError, publish_replay_steps


class ReplayError(RuntimeError):
    pass


def require(predicate: bool, message: str) -> None:
    if not predicate:
        raise ReplayError(message)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def scalar(value: object, label: str) -> float:
    require(type(value) in (int, float) and math.isfinite(value),
            f"non-finite/non-numeric {label}")
    return float(value)


def close(observed: object, expected: float, label: str, *, absolute: float = 1e-6) -> None:
    number = scalar(observed, label)
    require(math.isclose(number, expected, rel_tol=1e-8, abs_tol=absolute),
            f"{label}: expected {expected}, got {number}")


def validate_response(request: dict, response: dict, step: Path, known_volume: object) -> dict:
    """Independent numeric spot checks supplement the bundled audited bridge."""
    require(isinstance(request, dict) and isinstance(response, dict),
            "request/response must be objects")
    for key in ("requestId", "featureId", "revision"):
        require(response.get(key) == request.get(key), f"wrong response {key}")
    require(response.get("status") == "validated_exact"
            and response.get("backend") == "OCCT-cxx-8.0.1"
            and response.get("occtVersion") == "8.0.1",
            "offline replay is not exact OCCT 8.0.1 C++ geometry")
    plate = request.get("plate")
    require(isinstance(plate, dict), "missing plate")
    holes = plate.get("holes")
    require(isinstance(holes, list) and len(holes) <= 64, "bad hole inventory")
    width = scalar(plate.get("width"), "width")
    depth = scalar(plate.get("depth"), "depth")
    thick = scalar(plate.get("thickness"), "thickness")
    require(width > 0 and depth > 0 and thick > 0, "non-positive plate dimension")
    source_holes = []
    for i, hole in enumerate(holes):
        require(isinstance(hole, dict), f"hole {i} not an object")
        source_holes.append({k: scalar(hole.get(k), f"hole{i}.{k}")
                             for k in ("x", "y", "radius")})
    volume = thick * (width * depth - sum(math.pi * h["radius"]**2 for h in source_holes))
    require(volume > 0, "invalid analytic material volume")
    close(known_volume, volume, "attested source analytic volume")
    for name in ("source", "stepReadback"):
        measurements = response.get(name)
        require(isinstance(measurements, dict) and
                measurements.get("valid") is True and
                measurements.get("solidCount") == 1, f"{name} not single validated solid")
        close(measurements.get("volumeMm3"), volume, f"{name}.volumeMm3")
        observed = measurements.get("cylindricalHoles")
        require(isinstance(observed, list) and len(observed) == len(source_holes),
                f"{name}: wrong hole inventory")
        expected = sorted(source_holes, key=lambda x: (x["x"], x["y"], x["radius"]))
        actual = []
        for i, hole in enumerate(observed):
            require(isinstance(hole, dict), f"{name} hole {i} invalid")
            actual.append({k: scalar(hole.get(k), f"{name}.hole{i}.{k}")
                           for k in ("x", "y", "radius")})
        actual.sort(key=lambda x: (x["x"], x["y"], x["radius"]))
        for i, (a, e) in enumerate(zip(actual, expected)):
            for field in ("x", "y", "radius"):
                close(a[field], e[field], f"{name}.hole{i}.{field}", absolute=1e-8)
    require(step.is_file() and 256 <= step.stat().st_size <= 32 * 1024 * 1024,
            "fresh STEP bytes absent or outside bounded plate size")
    digest = sha256(step)
    require(response.get("stepSha256") == digest and
            isinstance(response.get("part21Audit"), dict) and
            response["part21Audit"].get("sha256") == digest,
            "fresh STEP does not match real audited bridge response")
    return {"volumeMm3": volume, "stepSha256": digest,
            "stepBytes": step.stat().st_size, "holes": len(source_holes)}


def dimension_edit_request(original: dict) -> dict:
    """Return a REAL new plate-v1 request for an executable dimensional edit.

    This is a bounded first-foundation fixture, not an INTENT journal replay.
    Keep semantic feature identity while changing geometry and source revision.
    """
    require(original.get("protocol") == "intuit3d/kernel/plate-v1"
            and original.get("units") == "mm", "unsupported edit fixture protocol/units")
    plate = original.get("plate")
    require(isinstance(plate, dict) and
            plate.get("width") == 120 and plate.get("depth") == 80
            and plate.get("thickness") == 8, "unsupported edited plate fixture")
    holes = plate.get("holes")
    require(isinstance(holes, list) and len(holes) == 2
            and holes[0] == {"x": -30, "y": 0, "radius": 6}
            and holes[1] == {"x": 30, "y": 0, "radius": 6},
            "edited fixture hole layout differs from pinned KERNEL-001 geometry")
    require(type(original.get("revision")) is int, "invalid source revision")
    changed = copy.deepcopy(original)
    changed["requestId"] = original["requestId"] + ".dimension-edit"
    changed["revision"] = original["revision"] + 1
    changed["plate"]["width"] = 150
    changed["plate"]["holes"][0]["radius"] = 7
    changed["plate"]["holes"][1]["x"] = 35
    return changed


def analytic_volume(request: dict) -> float:
    plate = request["plate"]
    return plate["thickness"] * (
        plate["width"] * plate["depth"]
        - sum(math.pi * hole["radius"] ** 2 for hole in plate["holes"]))


def execute_case(root: Path, temp: str, label: str, request: dict,
                 expected_volume: float) -> dict:
    """Run the actual extracted worker and verify fresh, audited STEP bytes."""
    step = Path(temp) / f"fresh-{label}.step"
    command = [str(root / "run.sh"), "--timeout", "60",
               "--part21-step-audit", "--step-output", str(step)]
    completed = subprocess.run(command, input=json.dumps(request).encode("utf-8"),
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               cwd=temp, timeout=90, check=False)
    require(completed.returncode == 0,
            f"extracted C++ {label} failed: "
            + completed.stderr.decode(errors="replace")[-1500:])
    try:
        response = json.loads(completed.stdout)
    except (UnicodeError, ValueError) as exc:
        raise ReplayError(f"extracted C++ {label} returned invalid JSON") from exc
    return validate_response(request, response, step, expected_volume)


def replay(root: Path, evidence_dir: Path | None = None) -> dict:
    require(sys.platform == "linux", "this archived worker is Linux ELF only")
    verified = subprocess.run([sys.executable, str(root / "verify.py")],
                              capture_output=True, text=True, timeout=30, check=False)
    require(verified.returncode == 0, "offline file/SONAME checksum verification failed: "
            + verified.stderr[-1500:])
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("schema") == "intuit3d/pinned-occt801-offline-linux-bundle-v1"
            and manifest.get("occtVersion") == "8.0.1"
            and manifest.get("nativeCppExecuted") is True
            and manifest.get("independentCadInteroperability") is False,
            "unsupported or unproven offline native manifest")
    evidence = manifest.get("relocatedSmoke")
    require(isinstance(evidence, dict) and set(evidence) == {"8", "12"},
            "missing prior physical 8/12 mm smoke evidence")
    observations = {}
    requests: dict[str, dict] = {}
    with tempfile.TemporaryDirectory(prefix="intuit3d-extracted-occt8-") as temp:
        for thickness in (8, 12):
            source = root / "requests" / f"plate-{thickness}mm.json"
            request = json.loads(source.read_text(encoding="utf-8"))
            require(request.get("plate", {}).get("thickness") == thickness,
                    "request thickness does not match attested case")
            requests[str(thickness)] = request
            observations[str(thickness)] = execute_case(
                root, temp, str(thickness), request, evidence[str(thickness)]["volumeMm3"])

        # Distinct real C++ and Part 21 invocations must respond to a
        # *geometric* edit, not just the already-qualified thickness change.
        original = json.loads((root / "requests/plate-8mm.json").read_text(encoding="utf-8"))
        edited = dimension_edit_request(original)
        restored = copy.deepcopy(original)
        restored["requestId"] = original["requestId"] + ".restore-dimensions"
        restored["revision"] = original["revision"] + 2
        requests["edited8"] = edited
        observations["edited8"] = execute_case(
            root, temp, "edited8", edited, analytic_volume(edited))
        requests["restored8"] = restored
        observations["restored8"] = execute_case(
            root, temp, "restored8", restored, evidence["8"]["volumeMm3"])
        require(not math.isclose(observations["8"]["volumeMm3"],
                                 observations["edited8"]["volumeMm3"],
                                 rel_tol=1e-8, abs_tol=1e-6),
                "dimensional edit did not change real C++ material volume")
        require(observations["8"]["stepSha256"] != observations["edited8"]["stepSha256"],
                "dimensional edit did not produce changed STEP bytes")
        close(observations["restored8"]["volumeMm3"],
              observations["8"]["volumeMm3"], "restored 8mm plate volume")
        require(observations["restored8"]["holes"] == observations["8"]["holes"] == 2,
                "restoration lost plate hole inventory")
        fresh_steps = None
        if evidence_dir is not None:
            # Persist the *newly generated* exact C++ STEP bytes before the
            # temporary replay directory disappears. Do not publish on any
            # failed geometry, digest, source or edit/restoration predicate.
            fresh_steps = publish_replay_steps(
                Path(temp), evidence_dir, requests, observations,
                {"occtSourceCommit": manifest["occtSourceCommit"],
                 "kernelSourceCommit": manifest["kernelSourceCommit"],
                 "workerSha256": manifest["workerSha256"]})

    result = {"status": "OFFLINE_CXX_REPLAY_PASS", "occtVersion": "8.0.1",
            "kernelSourceCommit": manifest["kernelSourceCommit"],
            "workerSha256": manifest["workerSha256"], "cases": observations,
            "dimensionEditExecuted": True, "dimensionsRestored": True,
            "independentCadInteroperability": False}
    if fresh_steps is not None:
        result["freshStepEvidence"] = fresh_steps
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", type=Path,
                        help="new directory for four genuine fresh STEP outputs, requests and hash evidence")
    arguments = parser.parse_args()
    try:
        result = replay(Path(__file__).resolve().parent, arguments.evidence_dir)
    except (ReplayError, EvidenceError, OSError, ValueError, KeyError, TypeError,
            subprocess.SubprocessError) as exc:
        print("OFFLINE_CXX_REPLAY_FAIL:", exc, file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
