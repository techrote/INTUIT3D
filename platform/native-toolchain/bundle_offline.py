#!/usr/bin/env python3
"""Package the executed, source-matched OCCT 8.0.1 C++ worker for offline Linux.

Requires the real PLATFORM 8/12 mm qualification and the pinned OCCT prefix.
Never substitutes OCP or synthetic geometry for compiled C++ execution.
"""
from __future__ import annotations

import argparse
import ast
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
from abi_compat import symbol_profile, ABIError
from reproducible_archive import ArchiveError, ROOT_NAME as ARCHIVE_ROOT_NAME, write_archive

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


TOOLKIT_NAME = re.compile(r"libTK[A-Za-z0-9]+\.so(?:\.[0-9]+)*\Z")
NEEDED_NAME = re.compile(r"\(NEEDED\).*?\[([^\]]+)\]")


def _needed_toolkits(obj: Path) -> set[str]:
    """Read real ELF DT_NEEDED records, never infer runtime closure from a name list."""
    proc = subprocess.run(["readelf", "-W", "-d", str(obj)],
                          capture_output=True, text=True, timeout=30, check=False)
    require(proc.returncode == 0 and "Dynamic section" in proc.stdout,
            f"cannot inspect physical ELF dependencies: {obj}: {proc.stderr[-300:]}")
    return {name for name in NEEDED_NAME.findall(proc.stdout)
            if TOOLKIT_NAME.fullmatch(name)}


def copy_toolkits(prefix: Path, target: Path, worker: Path | None = None) -> None:
    """Ship the exact pinned OCCT toolkit DT_NEEDED closure, not merely build seeds.

    OCCT can install *additional* toolkits as dependencies of the explicitly
    pinned 14 CMake seed toolkits. TKDESTEP, for example, may depend on
    TKXCAF/TKLCAF. Omitting those produces an archive that builds successfully
    but fails the relocated worker loader. Discover the transitive closure
    from actual installed ELF objects (and the compiled worker), preserving
    every SONAME/linker alias for selected libraries. Never resolve via host.
    """
    source = prefix / "lib"
    require(source.is_dir(), "pinned OCCT prefix lacks lib/")
    source_root = source.resolve(strict=True)
    candidates = {p.name: p for p in source.iterdir()
                  if TOOLKIT_NAME.fullmatch(p.name)}
    require(all(f"lib{name}.so" in candidates for name in TOOLKITS),
            "missing OCCT toolkit linker aliases")
    pending = {f"lib{name}.so" for name in TOOLKITS}
    if worker is not None:
        pending.update(_needed_toolkits(worker))
    inspected: set[Path] = set()
    selected: set[Path] = set()
    seen_names: set[str] = set()
    while pending:
        name = min(pending)
        pending.remove(name)
        if name in seen_names:
            continue
        seen_names.add(name)
        original = candidates.get(name)
        require(original is not None and original.is_file(),
                f"missing transitive pinned OCCT toolkit: {name}")
        resolved = original.resolve(strict=True)
        require(resolved.is_relative_to(source_root),
                f"toolkit points outside pinned prefix: {original}")
        require(resolved.name in candidates
                and not candidates[resolved.name].is_symlink()
                and candidates[resolved.name].resolve(strict=True) == resolved,
                f"unlisted physical toolkit in SONAME chain: {name}")
        selected.add(resolved)
        if resolved not in inspected:
            pending.update(_needed_toolkits(resolved) - seen_names)
            inspected.add(resolved)

    target.mkdir()
    for name, original in sorted(candidates.items()):
        # Only install aliases for an actually needed physical OCCT library.
        if not original.is_file() or original.resolve(strict=True) not in selected:
            continue
        require(original.resolve(strict=True).is_relative_to(source_root),
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
    require(all((target / name).is_file() for name in seen_names),
            "incomplete physical DT_NEEDED OCCT toolkit closure")


def _imported_kernel_contracts(path: Path) -> set[str]:
    """Collect explicit local OCCT contract imports without executing KERNEL code.

    The bridge evolves alongside KERNEL-002. A fixed list of first-foundation
    modules silently omits its profile/orthogonal contract dependencies and
    makes an otherwise correct compiled archive fail on fresh replay.
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (UnicodeError, SyntaxError, OSError) as exc:
        raise BundleError(f"cannot inspect source-matched KERNEL imports: {path}") from exc
    dependencies: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 0:
            names = [node.module] if node.module else []
        elif isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        else:
            continue
        for name in names:
            if name and re.fullmatch(r"occt8_[a-z0-9_]+_contract", name):
                dependencies.add(name)
    return dependencies


def copy_bridge(kernel: Path, target: Path) -> None:
    """Copy the exact checked-out KERNEL bridge plus transitive contracts.

    No floating package install or independent bridge implementation. Only
    imported occt8_*_contract.py modules from the immutable KERNEL checkout are
    admitted, recursively; missing/escaping dependencies fail before release.
    """
    native = kernel / "native"
    require(native.is_dir(), f"missing pinned KERNEL native source: {native}")
    target.mkdir()
    for name in BRIDGE_FILES:
        source = native / name
        require(source.is_file() and not source.is_symlink(),
                f"missing/unsafe Kernel bridge dependency: {source}")
        shutil.copy2(source, target / name)

    remaining = list(sorted(_imported_kernel_contracts(native / "occt8_bridge.py")))
    visited: set[str] = set()
    while remaining:
        module = remaining.pop(0)
        if module in visited:
            continue
        source = native / f"{module}.py"
        require(source.is_file() and not source.is_symlink()
                and source.resolve().is_relative_to(native.resolve()),
                f"missing/unsafe source-matched Kernel contract: {source}")
        for dependent in sorted(_imported_kernel_contracts(source) - visited):
            if dependent not in remaining:
                remaining.append(dependent)
        shutil.copy2(source, target / source.name)
        visited.add(module)

    oracle = native / "occt8" / "part21_oracle.py"
    require(oracle.is_file() and not oracle.is_symlink()
            and oracle.resolve().is_relative_to(native.resolve()),
            "missing/unsafe Kernel Part 21 plate-subset reader")
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


def relocate_toolkits(directory: Path) -> None:
    """Rewrite copied OCCT toolkit RPATHs, never the verified vendor prefix.

    OCCT's installed libTK*.so files can retain a build-prefix RPATH of their
    own. Merely patching the worker and setting LD_LIBRARY_PATH conceals that
    dependency while the original prefix still exists on a hosted runner.
    Every physical toolkit copy must instead resolve sibling dependencies
    through its own $ORIGIN directory, including transitive dlopen cases.
    """
    patcher = shutil.which("patchelf")
    require(patcher is not None, "patchelf required to relocate OCCT toolkit RPATHs")
    physical = [p for p in sorted(directory.iterdir())
                if p.is_file() and not p.is_symlink()]
    require(bool(physical) and all(
        re.fullmatch(r"libTK[A-Za-z0-9]+\.so(?:\..+)?", p.name)
        for p in physical),
        "unexpected or absent physical OCCT toolkit libraries")
    for library in physical:
        patched = subprocess.run(
            [patcher, "--force-rpath", "--set-rpath", "$ORIGIN", str(library)],
            capture_output=True, text=True, timeout=30, check=False)
        require(patched.returncode == 0,
                f"failed to relocate toolkit {library.name}: {patched.stderr}")
        dynamic = subprocess.run(
            ["readelf", "-d", str(library)], capture_output=True,
            text=True, timeout=30, check=False)
        require(dynamic.returncode == 0 and "(RPATH)" in dynamic.stdout
                and "[$ORIGIN]" in dynamic.stdout
                and "(RUNPATH)" not in dynamic.stdout,
                f"toolkit {library.name} lacks exact origin-only DT_RPATH")


def validate_elf_resolution(worker: Path, lib: Path) -> str:
    command = subprocess.run(["ldd", str(worker)], capture_output=True, text=True,
                             # No loader overrides: prove packaged ELF/RPATH
                             # closure, not a host-prefix or injected-env pass.
                             env={k: v for k, v in os.environ.items() if k not in
                                  ("LD_LIBRARY_PATH", "LD_PRELOAD", "LD_AUDIT", "LD_DEBUG")},
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
# The executable and each bundled OCCT toolkit carry origin-only DT_RPATH.
# Remove ambient linker overrides instead of masking a broken relocated ELF.
unset LD_LIBRARY_PATH LD_PRELOAD LD_AUDIT LD_DEBUG
exec python3 -B "$ROOT/native/occt8_bridge.py" --worker "$ROOT/bin/intuit3d_occt8_plate" "$@"
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
        # Python's import cache is runtime-derived and changes when canonical
        # tar extraction resets source mtimes. Never inventory it as payload.
        require("__pycache__" not in p.parts and p.suffix not in (".pyc", ".pyo"),
                f"runtime Python bytecode must not enter offline bundle: {relative}")
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
    replay_evidence = (args.replay_evidence.absolute()
                       if args.replay_evidence is not None else None)
    require(replay_evidence is None or (
            not os.path.lexists(replay_evidence)
            and not replay_evidence.is_relative_to(output)
            and not output.is_relative_to(replay_evidence)),
            "fresh STEP evidence path must be new and outside bundle output")
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
        copy_toolkits(args.prefix, output / "lib", worker)
        relocate_toolkits(output / "lib")
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
        shutil.copy2(Path(__file__).with_name("replay_evidence.py"),
                     output / "replay_evidence.py")
        (output / "README.txt").write_text(
            f"Official OCCT {VERSION} C++ Linux, commit {COMMIT}\n"
            "python3 verify.py\n"
            "./run.sh --part21-step-audit --step-output /tmp/plate.step < requests/plate-8mm.json\n"
            "Offline pinned native C++ 8/12 mm plus dimensional edit/restoration STEP replay; requires compatible Linux glibc/libstdc++ and Python 3.\n"
            "Part 21 plate-subset and OCCT readback do not certify external CAD interoperability.\n")
        resolution = validate_elf_resolution(
            output / "bin/intuit3d_occt8_plate", output / "lib")
        smoke = smoke_relocated(output, args.qualification)
        elf_abi = symbol_profile(output / "bin/intuit3d_occt8_plate", output / "lib")
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
            "abiResolution": resolution, "elfAbiProfile": elf_abi,
            "occtToolkitClosure": sorted(p.name for p in (output / "lib").iterdir()
                                         if p.is_file() and not p.is_symlink()),
            "nativeCppExecuted": True,
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
        write_archive(output, archive)
        # A source-prefix-relative smoke test does not prove that the
        # *distributed* archive works. Extract the exact published bytes into
        # a fresh path and require fresh 8/12mm real C++ / STEP replay.
        with tempfile.TemporaryDirectory(prefix="intuit-occt801-archive-") as temp:
            with tarfile.open(archive, "r:gz") as packaged:
                packaged.extractall(path=temp, filter="data")
            extracted = Path(temp) / ARCHIVE_ROOT_NAME
            command = [sys.executable, str(extracted / "selftest.py")]
            if replay_evidence is not None:
                command.extend(["--evidence-dir", str(replay_evidence)])
            actual = subprocess.run(
                command, cwd=temp, capture_output=True, text=True, timeout=210,
                check=False)
            require(actual.returncode == 0,
                    "EXTRACTED_ARCHIVE_CXX_REPLAY_FAIL: "
                    + actual.stdout[-2000:] + actual.stderr[-2000:])
            extracted_replay = json.loads(actual.stdout)
            require(extracted_replay.get("status") == "OFFLINE_CXX_REPLAY_PASS"
                    and set(extracted_replay.get("cases", {})) == {"8", "12", "edited8", "restored8"}
                    and extracted_replay.get("dimensionEditExecuted") is True
                    and extracted_replay.get("dimensionsRestored") is True
                    and extracted_replay.get("kernelSourceCommit") == kernel_sha,
                    "extracted archive returned incomplete or mismatched proof")
            if replay_evidence is not None:
                fresh = extracted_replay.get("freshStepEvidence")
                require(isinstance(fresh, dict)
                        and fresh.get("directory") == str(replay_evidence)
                        and replay_evidence.is_dir()
                        and set(fresh.get("stepSha256", {})) ==
                            {"8", "12", "edited8", "restored8"},
                        "extracted STEP replay evidence was not durably preserved")
                for case, expected in fresh["stepSha256"].items():
                    require(sha256(replay_evidence / f"fresh-{case}.step") == expected
                            and expected == extracted_replay["cases"][case]["stepSha256"],
                            f"preserved fresh {case} STEP changed after receipt")
        print(json.dumps({
            "status": "OFFLINE_BUNDLE_PASS", "archive": str(archive),
            "archiveSha256": sha256(archive), "archiveBytes": archive.stat().st_size,
            "kernel": kernel_sha, "relocatedCpp8And12": smoke,
            "extractedArchiveCppReplay": extracted_replay,
            "freshStepEvidence": extracted_replay.get("freshStepEvidence")
        }, indent=2))
        return manifest
    except BaseException:
        shutil.rmtree(output, ignore_errors=True)
        archive.unlink(missing_ok=True)
        if replay_evidence is not None and replay_evidence.is_dir():
            shutil.rmtree(replay_evidence, ignore_errors=True)
        raise


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    for arg in ("qualification", "prefix", "kernel-tree", "output"):
        p.add_argument("--" + arg, required=True, type=Path)
    p.add_argument("--replay-evidence", type=Path,
                   help="preserve four extracted C++ STEP outputs, requests and hashes")
    try:
        build(p.parse_args())
    except (ArchiveError, BundleError, ABIError, OSError, ValueError, KeyError,
            subprocess.SubprocessError) as exc:
        print("OFFLINE_BUNDLE_BLOCKED:", exc, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
