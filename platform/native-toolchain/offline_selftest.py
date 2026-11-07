#!/usr/bin/env python3
"""Re-execute the archived OCCT8 worker after relocation, without a source checkout.

This is a production C++/STEP *offline replay*, not independent CAD acceptance.
Run from an extracted verified bundle using: python3 selftest.py
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile


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


def replay(root: Path) -> dict:
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
    with tempfile.TemporaryDirectory(prefix="intuit3d-extracted-occt8-") as temp:
        for thickness in (8, 12):
            source = root / "requests" / f"plate-{thickness}mm.json"
            request = json.loads(source.read_text(encoding="utf-8"))
            require(request.get("plate", {}).get("thickness") == thickness,
                    "request thickness does not match attested case")
            step = Path(temp) / f"fresh-{thickness}mm.step"
            command = [str(root / "run.sh"), "--timeout", "60",
                       "--part21-step-audit", "--step-output", str(step)]
            result = subprocess.run(command, input=source.read_bytes(),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    cwd=temp, timeout=90, check=False)
            require(result.returncode == 0,
                    f"extracted C++ {thickness}mm failed: "
                    + result.stderr.decode(errors="replace")[-1500:])
            try:
                response = json.loads(result.stdout)
            except (UnicodeError, ValueError) as exc:
                raise ReplayError(f"extracted C++ {thickness}mm returned invalid JSON") from exc
            observations[str(thickness)] = validate_response(
                request, response, step, evidence[str(thickness)]["volumeMm3"])
    return {"status": "OFFLINE_CXX_REPLAY_PASS", "occtVersion": "8.0.1",
            "kernelSourceCommit": manifest["kernelSourceCommit"],
            "workerSha256": manifest["workerSha256"], "cases": observations,
            "independentCadInteroperability": False}


def main() -> int:
    try:
        result = replay(Path(__file__).resolve().parent)
    except (ReplayError, OSError, ValueError, KeyError, TypeError,
            subprocess.SubprocessError) as exc:
        print("OFFLINE_CXX_REPLAY_FAIL:", exc, file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
