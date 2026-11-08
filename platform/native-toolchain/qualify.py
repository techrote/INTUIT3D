#!/usr/bin/env python3
"""Offline-capable OCCT 8.0.1 build and *actual* C++ STEP qualification.

No synthetic worker is allowed on the success path. No independent CAD
interoperability is claimed: Part 21 subset checks are not a full CAD reader.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

COMMIT = "b8f597c677811d1f9f4d8a97f5ae2825c0353a42"
VERSION = "8.0.1"
PROFILE = "release-shared-cxx17-worker-only-headless-v4"
TOOLKITS = (
    "TKernel", "TKMath", "TKG2d", "TKG3d", "TKGeomBase", "TKBRep",
    "TKGeomAlgo", "TKTopAlgo", "TKPrim", "TKBO", "TKShHealing",
    "TKDE", "TKXSBase", "TKDESTEP",
)
PIN = {
    "repository": "https://github.com/Open-Cascade-SAS/OCCT.git",
    "commit": COMMIT,
    "version": VERSION,
    "build_profile": PROFILE,
    "selected_toolkits": ";".join(TOOLKITS),
    "xlib": "off",
    "opengl": "off",
}

class Blocked(RuntimeError):
    """Unmet native prerequisite; this is NOT a geometry test pass."""


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def verify_prefix(prefix: Path) -> dict:
    """Structural preflight only; authentic native execution is mandatory."""
    header = prefix / "include/opencascade/Standard_Version.hxx"
    pin_file = prefix / "RCS006_SOURCE_PIN.txt"
    if not header.is_file() or not pin_file.is_file():
        raise Blocked("OCCT prefix lacks version header or RCS006_SOURCE_PIN.txt")
    if not re.search(r'^\s*#define\s+OCC_VERSION_COMPLETE\s+"8\.0\.1"\s*$',
                     header.read_text(), re.MULTILINE):
        raise Blocked("OCCT prefix has wrong version header")
    lines = pin_file.read_text().splitlines()
    actual: dict[str, str] = {}
    for line in lines:
        if "=" not in line:
            raise Blocked("malformed OCCT source attestation")
        key, value = line.split("=", 1)
        if key in actual:
            raise Blocked(f"duplicate source attestation key: {key}")
        actual[key] = value
    for key, value in PIN.items():
        if actual.get(key) != value:
            raise Blocked(f"OCCT source attestation mismatch: {key}")
    config = prefix / "lib/cmake/opencascade/OpenCASCADEConfig.cmake"
    if not config.is_file():
        raise Blocked("OCCT prefix lacks OpenCASCADEConfig.cmake")
    libraries: dict[str, dict] = {}
    for name in TOOLKITS:
        matches = [p for lib in ("lib", "lib64")
                   for p in (prefix / lib).glob(f"lib{name}.so*")
                   if p.is_file()]
        if not matches:
            raise Blocked(f"OCCT prefix lacks shared toolkit {name}")
        p = next((p for p in matches if p.name == f"lib{name}.so"), matches[0])
        with p.open("rb") as stream:
            if stream.read(4) != b"\x7fELF":
                raise Blocked(f"OCCT toolkit not a Linux ELF: {name}")
        libraries[name] = {"file": str(p.resolve()), "sha256": sha256(p)}
    return {"prefix": str(prefix.resolve()), "version": VERSION,
            "commit": COMMIT, "profile": PROFILE,
            "pinSha256": sha256(pin_file), "libraries": libraries,
            "status": "structural_preflight_only"}


def verify_source(source: Path, run) -> None:
    if not (source / "CMakeLists.txt").is_file():
        raise Blocked("OCCT source checkout has no CMakeLists.txt")
    commit = run(["git", "-C", str(source), "rev-parse", "HEAD"], capture=True).strip()
    if commit != COMMIT:
        raise Blocked(f"OCCT source HEAD {commit} does not match pinned {COMMIT}")
    if run(["git", "-C", str(source), "status", "--porcelain"], capture=True).strip():
        raise Blocked("OCCT source checkout is modified; refuse ambiguous source provenance")


def provision(source: Path, prefix: Path, output: Path, jobs: int, run) -> None:
    """Build exact RCS-006 headless profile from *pre-fetched* pinned checkout."""
    verify_source(source, run)
    if prefix.exists():
        raise Blocked("destination prefix exists; will not overwrite user data")
    build = output / "occt-build"
    flags = [
        "-DCMAKE_BUILD_TYPE=Release", f"-DCMAKE_INSTALL_PREFIX={prefix}",
        "-DBUILD_CPP_STANDARD=C++17", "-DBUILD_LIBRARY_TYPE=Shared",
        *[f"-DBUILD_MODULE_{name}=OFF" for name in (
            "FoundationClasses", "ModelingData", "ModelingAlgorithms",
            "ApplicationFramework", "DataExchange", "Visualization", "Draw")],
        f"-DBUILD_ADDITIONAL_TOOLKITS={';'.join(TOOLKITS)}",
        *[f"-DUSE_{name}=OFF" for name in (
            "TCL", "TK", "FREETYPE", "FREEIMAGE", "TBB", "VTK", "OPENVR",
            "RAPIDJSON", "DRACO", "FFMPEG", "EIGEN", "OPENGL", "XLIB")],
    ]
    run(["cmake", "-S", str(source), "-B", str(build), "-G", "Ninja", *flags])
    run(["cmake", "--build", str(build), "--parallel", str(jobs)])
    run(["cmake", "--install", str(build)])
    # Never attest a build that has missing toolkits/configuration.
    header = prefix / "include/opencascade/Standard_Version.hxx"
    config = prefix / "lib/cmake/opencascade/OpenCASCADEConfig.cmake"
    if not header.is_file() or not config.is_file():
        raise Blocked("build did not install OCCT version header/config")
    (prefix / "RCS006_SOURCE_PIN.txt").write_text(
        "".join(f"{k}={v}\n" for k, v in PIN.items()), encoding="utf-8"
    )
    verify_prefix(prefix)


def require_kernel(kernel: Path) -> None:
    needed = ["native/occt8/CMakeLists.txt", "native/occt8/plate_worker.cpp",
              "native/occt8_bridge.py", "native/occt8/part21_oracle.py",
              "native/examples/plate-two-holes.request.json"]
    missing = [p for p in needed if not (kernel / p).is_file()]
    if missing:
        raise Blocked("Kernel PR #67 not present in supplied checkout: " + ", ".join(missing))


def compare_geometry(result: dict, request: dict, step: Path) -> dict:
    plate = request["plate"]
    holes = plate["holes"]
    area = plate["width"] * plate["depth"] - sum(math.pi * h["radius"] ** 2 for h in holes)
    volume = area * plate["thickness"]
    surface = 2 * area + (2 * (plate["width"] + plate["depth"]) +
                          sum(2 * math.pi * h["radius"] for h in holes)) * plate["thickness"]
    if result.get("status") != "validated_exact" or result.get("backend") != "OCCT-cxx-8.0.1" or result.get("occtVersion") != VERSION:
        raise Blocked("bridge did not report actual pinned C++ validated geometry")
    if result.get("requestId") != request["requestId"] or result.get("featureId") != request["featureId"] or result.get("revision") != request["revision"]:
        raise Blocked("C++ response identity/revision mismatch")
    for label in ("source", "stepReadback"):
        metric = result.get(label)
        if not isinstance(metric, dict) or metric.get("valid") is not True or metric.get("solidCount") != 1:
            raise Blocked(f"{label} has invalid geometry/solid count")
        for key, expected in (("volumeMm3", volume), ("surfaceAreaMm2", surface)):
            value = metric.get(key)
            if type(value) not in (float, int) or not math.isfinite(value) or not math.isclose(value, expected, rel_tol=1e-8, abs_tol=1e-6):
                raise Blocked(f"{label} {key} mismatches independent analytic oracle")
        actual_holes = metric.get("cylindricalHoles")
        if not isinstance(actual_holes, list) or len(actual_holes) != len(holes):
            raise Blocked(f"{label} has incorrect cylindrical-hole inventory")
        a = sorted(actual_holes, key=lambda h: (h["x"], h["y"], h["radius"]))
        e = sorted(holes, key=lambda h: (h["x"], h["y"], h["radius"]))
        for observed, expected in zip(a, e):
            for field in ("x", "y", "radius"):
                val = observed.get(field)
                if type(val) not in (float, int) or not math.isclose(val, expected[field], rel_tol=1e-9, abs_tol=1e-9):
                    raise Blocked(f"{label} misplaced hole {field}")
    digest = sha256(step) if step.is_file() else None
    if digest is None or digest != result.get("stepSha256") or step.stat().st_size < 256:
        raise Blocked("actual STEP bytes missing, too small or sha256 mismatched")
    if result.get("part21Audit", {}).get("sha256") != digest:
        raise Blocked("Part 21 plate-subset STEP audit absent or mismatched")
    return {"widthMm": plate["width"], "depthMm": plate["depth"],
            "thicknessMm": plate["thickness"], "holes": len(holes),
            "analyticVolumeMm3": volume, "analyticAreaMm2": surface,
            "stepBytes": step.stat().st_size, "stepSha256": digest,
            "step": str(step.resolve()), "proof": "actual_worker_plus_same_engine_and_part21_subset"}


def qualification(args: argparse.Namespace) -> int:
    if args.output.exists():
        raise Blocked("evidence destination exists; refuse clobber")
    args.output.mkdir(parents=True)
    report: dict = {"schema": "intuit3d/platform-occt8-qualification-v1",
                    "status": "BLOCKED", "nativeCppExecuted": False,
                    "independentCadInteroperability": False, "commands": [], "artifacts": []}
    try:
        def run(cmd: list[str], *, capture: bool = False) -> str:
            n = len(report["commands"]) + 1
            name = f"command-{n:02d}.log"
            item = {"argv": cmd, "log": name, "status": "started"}
            report["commands"].append(item)
            with (args.output / name).open("w", encoding="utf-8") as log:
                if capture:
                    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, timeout=args.timeout, check=False)
                    log.write(p.stdout)
                else:
                    p = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT,
                                       timeout=args.timeout, check=False)
                item["returncode"] = p.returncode
                item["status"] = "success" if p.returncode == 0 else "failure"
                if p.returncode != 0:
                    raise Blocked(f"command failed ({name}): {' '.join(shlex.quote(s) for s in cmd)}")
                return p.stdout if capture else ""
        if sys.platform != "linux":
            raise Blocked("this executable qualification harness targets Linux ELF; Windows native is unqualified")
        require_kernel(args.kernel_tree)
        # Attest the exact KERNEL source used by this real native build.
        # Offline bundles must reject evidence from an unrelated PR head.
        commit = subprocess.run(
            ["git", "-C", str(args.kernel_tree), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=False, timeout=20)
        if commit.returncode or not re.fullmatch(r"[0-9a-f]{40}", commit.stdout.strip()):
            raise Blocked("unable to attest KERNEL source commit")
        report["kernelSourceCommit"] = commit.stdout.strip()
        if args.source:
            provision(args.source, args.prefix, args.output, args.jobs, run)
        prefix_record = verify_prefix(args.prefix)
        report["occtInstall"] = prefix_record
        worker_build = args.output / "worker-build"
        run(["cmake", "-S", str(args.kernel_tree / "native/occt8"),
             "-B", str(worker_build), "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
             f"-DINTUIT3D_OCCT8_PREFIX={args.prefix}"])
        run(["cmake", "--build", str(worker_build), "--parallel", str(args.jobs)])
        worker = worker_build / "intuit3d_occt8_plate"
        if not worker.is_file() or not os.access(worker, os.X_OK):
            raise Blocked("actual compiled C++ worker missing or non-executable")
        report["worker"] = {"file": str(worker), "sha256": sha256(worker)}
        fixture = json.loads((args.kernel_tree / "native/examples/plate-two-holes.request.json").read_text())
        for thickness in (8, 12):
            req = json.loads(json.dumps(fixture))
            req["plate"]["thickness"] = thickness
            req["revision"] = thickness
            req["requestId"] = f"platform.plate.{thickness}mm"
            request_path = args.output / f"request-{thickness}mm.json"
            request_path.write_text(json.dumps(req, sort_keys=True, indent=2) + "\n")
            step = args.output / f"plate-{thickness}mm.step"
            cmd = [sys.executable, str(args.kernel_tree / "native/occt8_bridge.py"),
                   "--worker", str(worker), "--step-output", str(step),
                   "--timeout", str(args.native_timeout), "--part21-step-audit"]
            # stdin must be the actual request; invoke without a shell.
            name = f"bridge-{thickness}mm.log"
            with (args.output / name).open("w", encoding="utf-8") as log:
                p = subprocess.run(cmd, input=request_path.read_bytes(), stdout=subprocess.PIPE,
                                   stderr=log, timeout=args.native_timeout + 10, check=False)
                log.write("\nbridge return code: " + str(p.returncode) + "\n")
            (args.output / f"response-{thickness}mm.json").write_bytes(p.stdout)
            report["commands"].append({"argv": cmd, "stdin": str(request_path),
                                       "log": name, "returncode": p.returncode})
            if p.returncode != 0:
                raise Blocked(f"C++ bridge failed at {thickness} mm; inspect {name}")
            try:
                response = json.loads(p.stdout)
            except (ValueError, UnicodeDecodeError) as exc:
                raise Blocked(f"C++ bridge returned invalid JSON at {thickness} mm") from exc
            metrics = compare_geometry(response, req, step)
            report["nativeCppExecuted"] = True
            report["artifacts"].append(metrics)
        if len(report["artifacts"]) != 2:
            raise Blocked("8/12 mm genuine native geometry qualification incomplete")
        report["status"] = "NATIVE_EXPERIMENTAL_PASS"
        return 0
    except (Blocked, FileNotFoundError, subprocess.TimeoutExpired, OSError, ValueError) as exc:
        report["status"] = "BLOCKED"
        report["failure"] = f"{type(exc).__name__}: {exc}"
        return 2
    finally:
        (args.output / "qualification.json").write_text(json.dumps(report, sort_keys=True,
                                                        indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kernel-tree", type=Path, required=True,
                        help="checkout containing KERNEL PR #67; defaults are not inferred")
    parser.add_argument("--prefix", type=Path, required=True,
                        help="already attested RCS-006 prefix or new destination with --source")
    parser.add_argument("--source", type=Path,
                        help="existing clean git OCCT checkout at pinned commit; builds without network")
    parser.add_argument("--output", type=Path, required=True,
                        help="new unique directory for reproducible build/log/artifact evidence")
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--native-timeout", type=int, default=30,
                        help="maximum per isolated C++ operation in seconds")
    parser.add_argument("--timeout", type=int, default=3600,
                        help="per build command timeout; native request is capped separately")
    args = parser.parse_args()
    if args.jobs < 1 or args.jobs > 32 or args.timeout < 10 or not (1 <= args.native_timeout <= 3600):
        parser.error("jobs must be 1..32, build timeout >= 10, native timeout 1..3600")
    args.kernel_tree = args.kernel_tree.resolve()
    args.prefix = args.prefix.resolve()
    args.output = args.output.resolve()
    if args.source:
        args.source = args.source.resolve()
    try:
        rc = qualification(args)
    except (Blocked, OSError) as exc:
        print(f"BLOCKED before evidence initialization: {exc}", file=sys.stderr)
        return 2
    print(f"Qualification status and evidence: {args.output / 'qualification.json'}")
    return rc

if __name__ == "__main__":
    raise SystemExit(main())
