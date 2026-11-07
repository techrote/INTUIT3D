#!/usr/bin/env python3
"""Package the executed, source-matched OCCT 8.0.1 C++ worker for offline Linux.

Requires the real PLATFORM 8/12 mm qualification and the pinned OCCT prefix.
Never substitutes OCP or synthetic geometry for compiled C++ execution.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

from qualify import COMMIT, VERSION, TOOLKITS, compare_geometry, verify_prefix

BRIDGE_FILES = ("occt8_bridge.py", "plate_envelope.py", "protocol.py",
                "process_supervision.py")


class BundleError(RuntimeError):
    pass


def require(ok: bool, description: str) -> None:
    if not ok:
        raise BundleError(description)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def copy_toolkits(prefix: Path, target: Path) -> None:
    """Keep verified DT_NEEDED SONAME links, not a system OCCT fallback."""
    source = prefix / "lib"
    require(source.is_dir(), "pinned OCCT prefix lacks lib/")
    candidates = {
        p.name: p for p in source.iterdir()
        if any(re.fullmatch(r"lib" + re.escape(name) + r"\.so(?:\..*)?", p.name)
               for name in TOOLKITS)
    }
    require(all(f"lib{name}.so" in candidates for name in TOOLKITS),
            "missing OCCT toolkit linker aliases")
    target.mkdir()
    for name, original in sorted(candidates.items()):
        require(original.is_file(), f"broken OCCT toolkit link: {original}")
        require(original.resolve().is_relative_to(source.resolve()),
                f"toolkit points outside pinned prefix: {original}")
        destination = target / name
        if original.is_symlink():
            link = os.readlink(original)
            require(not os.path.isabs(link) and "/" not in link and link in candidates,
                    f"unsafe toolkit SONAME symlink: {name} -> {link}")
            destination.symlink_to(link)
        else:
            shutil.copy2(original, destination)
    require(all((target / f"lib{name}.so").resolve().is_file()
                for name in TOOLKITS), "incomplete toolkit SONAME chain")


def copy_bridge(kernel: Path, target: Path) -> None:
    target.mkdir()
    for name in BRIDGE_FILES:
        source = kernel / "native" / name
        require(source.is_file(), f"missing Kernel bridge dependency: {source}")
        shutil.copy2(source, target / name)
    # The bounded #158 first-foundation source predates the generalized
    # occt8_cut_contract module. Newer #67 imports it for mixed-cut requests.
    # Bundle it only when the exact checked-out bridge actually requires it.
    cut_contract = kernel / "native/occt8_cut_contract.py"
    bridge_source = (kernel / "native/occt8_bridge.py").read_text()
    if "from occt8_cut_contract import" in bridge_source:
        require(cut_contract.is_file(), "missing required newer Kernel cut contract")
        shutil.copy2(cut_contract, target / cut_contract.name)
    oracle = kernel / "native/occt8/part21_oracle.py"
    require(oracle.is_file(), "missing Kernel Part 21 plate-subset reader")
    (target / "occt8").mkdir()
    shutil.copy2(oracle, target / "occt8/part21_oracle.py")


def relocate_worker(original: Path, target: Path) -> None:
    """Remove its absolute build-prefix RPATH (transitive ELF dependency risk)."""
    patcher = shutil.which("patchelf")
    require(patcher is not None, "patchelf required to relocate the ELF DT_RPATH")
    shutil.copy2(original, target)
    result = subprocess.run([patcher, "--force-rpath", "--set-rpath",
                             "$ORIGIN/../lib", str(target)],
                            capture_output=True, text=True, timeout=30, check=False)
    require(result.returncode == 0, f"patchelf failed: {result.stderr}")
    dynamic = subprocess.run(["readelf", "-d", str(target)], capture_output=True,
                             text=True, timeout=30, check=False)
    require(dynamic.returncode == 0 and "(RPATH)" in dynamic.stdout and
            "[$ORIGIN/../lib]" in dynamic.stdout,
            "relocated worker has no transitive origin-relative DT_RPATH")


def validate_elf_resolution(worker: Path, lib: Path) -> str:
    command = subprocess.run(["ldd", str(worker)], capture_output=True, text=True,
                             env={**os.environ, "LD_LIBRARY_PATH": str(lib)},
                             timeout=30, check=False)
    require(command.returncode == 0 and "not found" not in command.stdout,
            f"relocated ELF cannot load: {command.stdout} {command.stderr}")
    occt_lines = [line for line in command.stdout.splitlines()
                  if re.search(r"libTK[A-Za-z0-9]+\.so", line)]
    require(occt_lines, "compiled worker loaded no OCCT shared toolkits")
    for line in occt_lines:
        # GNU ld.so normally prints $ORIGIN/../lib without canonicalizing
        # the path; compare resolved paths, not string prefixes.
        location = line.split("=>", 1)[-1].split(" (", 1)[0].strip()
        require(Path(location).is_absolute() and
                Path(location).resolve().is_relative_to(lib.resolve()),
                f"unbundled OCCT library resolved from host/build prefix: {line}")
    return command.stdout


def launcher(root: Path) -> None:
    script = root / "run.sh"
    script.write_text('''#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")" && pwd -P)"
# Use the copied exact-version toolkit instead of a host OCCT.
export LD_LIBRARY_PATH="$ROOT/lib"
exec python3 "$ROOT/native/occt8_bridge.py" --worker "$ROOT/bin/intuit3d_occt8_plate" "$@"
''', encoding="utf-8")
    script.chmod(0o755)


def smoke_relocated(root: Path, qualification: Path) -> dict:
    """Execute copied worker and freshly audit both real produced STEP files."""
    measured = {}
    with tempfile.TemporaryDirectory(prefix="intuit-occt801-relocated-") as temp:
        for thickness in (8, 12):
            source = qualification / f"request-{thickness}mm.json"
            require(source.is_file(), f"missing executed {thickness}mm request")
            request = json.loads(source.read_text(encoding="utf-8"))
            step = Path(temp) / f"plate-{thickness}mm.step"
            command = [str(root / "run.sh"), "--timeout", "60",
                       "--part21-step-audit", "--step-output", str(step)]
            done = subprocess.run(command, input=source.read_bytes(),
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  cwd=temp, timeout=90, check=False)
            require(done.returncode == 0,
                    f"relocated native C++ {thickness}mm failed: "
                    + done.stderr.decode(errors="replace")[-2000:])
            try:
                response = json.loads(done.stdout)
            except (ValueError, UnicodeError) as exc:
                raise BundleError(f"invalid C++ JSON response at {thickness}mm") from exc
            # Same-engine + strict plate-subset STEP, not full non-OCCT CAD.
            result = compare_geometry(response, request, step)
            measured[str(thickness)] = {
                "status": "NATIVE_EXPERIMENTAL_PASS",
                "stepSha256": result["stepSha256"],
                "volumeMm3": result["analyticVolumeMm3"],
                "stepBytes": result["stepBytes"],
            }
    return measured


def inventory(root: Path) -> tuple[dict, dict]:
    files, links = {}, {}
    for p in sorted(root.rglob("*")):
        relative = p.relative_to(root).as_posix()
        if relative == "manifest.json":
            continue
        if p.is_symlink():
            require(p.resolve().is_relative_to(root.resolve()),
                    f"bundle link escapes directory: {relative}")
            links[relative] = os.readlink(p)
        elif p.is_file():
            files[relative] = sha256(p)
    return files, links


def build(args: argparse.Namespace) -> dict:
    require(sys.platform == "linux", "Linux ELF bundle requires Linux")
    output = args.output.resolve()
    archive = Path(str(output) + ".tar.gz")
    require(not output.exists() and not archive.exists(),
            "output folder/archive already exists; no overwrites")
    report = json.loads((args.qualification / "qualification.json").read_text())
    require(report.get("status") == "NATIVE_EXPERIMENTAL_PASS" and
            report.get("nativeCppExecuted") is True,
            "refusing to bundle skipped, mock or failed C++ qualification")
    cases = report.get("artifacts")
    require(isinstance(cases, list) and len(cases) == 2 and
            {case.get("thicknessMm") for case in cases} == {8, 12},
            "real native 8/12 mm STEP evidence missing/incomplete")
    install = verify_prefix(args.prefix)
    require(install["version"] == VERSION and install["commit"] == COMMIT,
            "not an attested pinned OCCT 8.0.1 install")
    worker = Path(report["worker"]["file"])
    require(worker.is_file() and os.access(worker, os.X_OK) and
            sha256(worker) == report["worker"]["sha256"],
            "compiled worker bytes differ from physical qualification")
    for case in cases:
        step = Path(case["step"])
        require(step.is_file() and sha256(step) == case["stepSha256"],
                f"qualified STEP missing or changed: {step}")
    git = subprocess.run(["git", "-C", str(args.kernel_tree), "rev-parse", "HEAD"],
                         capture_output=True, text=True, check=False)
    kernel_sha = git.stdout.strip()
    require(git.returncode == 0 and re.fullmatch(r"[0-9a-f]{40}", kernel_sha)
            is not None, "missing immutable Kernel source revision")
    require(report.get("kernelSourceCommit") == kernel_sha,
            "source mismatch: qualification was executed on another Kernel commit")
    output.mkdir(parents=True)
    try:
        (output / "bin").mkdir()
        relocate_worker(worker, output / "bin/intuit3d_occt8_plate")
        copy_toolkits(args.prefix, output / "lib")
        copy_bridge(args.kernel_tree, output / "native")
        (output / "requests").mkdir()
        (output / "evidence").mkdir()
        for thickness in (8, 12):
            shutil.copy2(args.qualification / f"request-{thickness}mm.json",
                         output / "requests" / f"plate-{thickness}mm.json")
            shutil.copy2(args.qualification / f"plate-{thickness}mm.step",
                         output / "evidence" / f"plate-{thickness}mm.step")
            shutil.copy2(args.qualification / f"response-{thickness}mm.json",
                         output / "evidence" / f"response-{thickness}mm.json")
        launcher(output)
        shutil.copy2(Path(__file__).with_name("verify_offline_bundle.py"),
                     output / "verify.py")
        shutil.copy2(Path(__file__).with_name("offline_selftest.py"),
                     output / "selftest.py")
        (output / "README.txt").write_text(
            f"Official OCCT {VERSION} C++ Linux, commit {COMMIT}\n"
            "python3 verify.py\n"
            "./run.sh --part21-step-audit --step-output /tmp/plate.step < requests/plate-8mm.json\n"
            "Offline pinned native C++ 8/12 mm geometry and STEP, requires compatible Linux glibc/libstdc++ and Python 3.\n"
            "Part 21 plate-subset and OCCT readback do not certify external CAD interoperability.\n")
        resolution = validate_elf_resolution(
            output / "bin/intuit3d_occt8_plate", output / "lib")
        smoke = smoke_relocated(output, args.qualification)
        files, links = inventory(output)
        manifest = {
            "schema": "intuit3d/pinned-occt801-offline-linux-bundle-v1",
            "occtVersion": VERSION, "occtSourceCommit": COMMIT,
            "occtBuildProfile": install["profile"],
            "occtPinSha256": install["pinSha256"],
            "kernelSourceCommit": kernel_sha,
            "workerOriginalSha256": report["worker"]["sha256"],
            "workerSha256": sha256(output / "bin/intuit3d_occt8_plate"),
            "machine": platform.machine(), "host": platform.platform(),
            "abiResolution": resolution, "nativeCppExecuted": True,
            "independentCadInteroperability": False,
            "relocatedSmoke": smoke,
            "qualificationSteps": {str(c["thicknessMm"]): c["stepSha256"]
                                   for c in cases},
            "files": files, "links": links,
        }
        (output / "manifest.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        verifier = subprocess.run(
            [sys.executable, str(output / "verify.py")],
            capture_output=True, text=True, check=False)
        require(verifier.returncode == 0, "bundle checksum verification failed: "
                + verifier.stdout + verifier.stderr)
        with tarfile.open(archive, "w:gz", dereference=False) as tar:
            tar.add(output, arcname=output.name)
        # A source-prefix-relative smoke test does not prove that the
        # *distributed* archive works. Extract the exact published bytes into
        # a fresh path and require fresh 8/12mm real C++ / STEP replay.
        with tempfile.TemporaryDirectory(prefix="intuit-occt801-archive-") as temp:
            with tarfile.open(archive, "r:gz") as packaged:
                packaged.extractall(path=temp, filter="data")
            extracted = Path(temp) / output.name
            actual = subprocess.run(
                [sys.executable, str(extracted / "selftest.py")],
                cwd=temp, capture_output=True, text=True, timeout=210,
                check=False)
            require(actual.returncode == 0,
                    "EXTRACTED_ARCHIVE_CXX_REPLAY_FAIL: "
                    + actual.stdout[-2000:] + actual.stderr[-2000:])
            extracted_replay = json.loads(actual.stdout)
            require(extracted_replay.get("status") == "OFFLINE_CXX_REPLAY_PASS"
                    and set(extracted_replay.get("cases", {})) == {"8", "12"}
                    and extracted_replay.get("kernelSourceCommit") == kernel_sha,
                    "extracted archive returned incomplete or mismatched proof")
        print(json.dumps({
            "status": "OFFLINE_BUNDLE_PASS", "archive": str(archive),
            "archiveSha256": sha256(archive), "archiveBytes": archive.stat().st_size,
            "kernel": kernel_sha, "relocatedCpp8And12": smoke,
            "extractedArchiveCppReplay": extracted_replay
        }, indent=2))
        return manifest
    except BaseException:
        shutil.rmtree(output, ignore_errors=True)
        archive.unlink(missing_ok=True)
        raise


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    for arg in ("qualification", "prefix", "kernel-tree", "output"):
        p.add_argument("--" + arg, required=True, type=Path)
    try:
        build(p.parse_args())
    except (BundleError, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        print("OFFLINE_BUNDLE_BLOCKED:", exc, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
