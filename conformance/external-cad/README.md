# INTUIT3D — independent BRL-CAD STEP and ray conformance

**PLATFORM-001 / #81.** This is an executable independent CAD import and geometry acceptance harness, not a claim of completed interoperability. It uses BRL-CAD's STEPcode/OpenNURBS importer and native ray geometry tools (step-g, mged, gqa and nirt). None of these are OCCT or OCP; a custom STEP text parser is not substituted.

## Original CAD fixtures

Download the original [accepted-main CI artifact #13563062028](https://github.com/techrote/INTUIT3D/actions/runs/42345301755/artifacts/13563062028) (run #42345301755, source main 1604afd9c7d1f8ae9c0dcb13fcdc2d68908c0244) before its retention expiry. It includes four real experimental OCP 7.9.3.1 flange STEP files: 10 mm / four bores; 16 mm / four bores; 16 mm / five bores; then undo the fifth bore. flange-cases.json pins the original SHA-256, byte counts, size, thickness, bore centers and radii. Binaries are not checked into Git.

## Executable usage

~~~bash
python3 -m unittest discover -s conformance/external-cad -p 'test_*.py' -v
python3 conformance/external-cad/brlcad_flange.py \
  --bundle /path/to/original-artifact-13563062028.zip \
  --output-dir /tmp/intuit-flange-input --verify-input-only
# INPUT_VERIFIED_NOT_EXTERNAL_CAD is not external CAD acceptance.

# On a host with genuine BRL-CAD binaries, run the complete importer and
# physical volume/ray checks. If each imported database has exactly ONE root,
# its name is discovered automatically from "mged -c ... tops" per case:
python3 conformance/external-cad/brlcad_flange.py \
  --bundle /path/to/original-artifact-13563062028.zip \
  --output-dir /tmp/intuit-flange-external-unique

# If a database has MULTIPLE top-level objects, the run rejects ambiguity.
# Inspect the exact import with step-g/mged, then explicitly select a root
# verified in every case; substring matches and unknown roots are rejected:
#   step-g --strict --exact --repair none --report /tmp/first-import.json \
#     -o /tmp/first-import.g /tmp/intuit-flange-input/flange.four.step
#   mged -c /tmp/first-import.g tops
#   python3 conformance/external-cad/brlcad_flange.py ... --object EXACT_ROOT_NAME
~~~

The importer must expose a single unambiguous top-level object **in each fixture** for automatic selection; roots may have different names between cases. For multiple roots, explicit `--object` must match an actual top-level object **exactly** in every case or qualification fails. BRL-CAD `tops` lists combination markers `/` and region markers `/R`; these are normalized, and all extra/duplicate/unrecognized top-level records are rejected. The selected root and full top-level inventory are retained per case in the evidence manifest. This discovery enhancement removes an unnecessary manual step, but only an **actual installed BRL-CAD execution** can qualify geometry. The evidence output directory must not exist already. The script saves original STEP bytes, imported BRL geometry databases, logs, tool SHA-256, ray results and a manifest.

Each fixture undergoes strict exit/diagnostic, populated geometry, and physical-predicate acceptance (the pinned 7.44.0 step-g has **no** --strict/--exact/--repair/--report options), a gqa independent approximate ray-volume comparison (explicit 1% tolerance), and individual nirt rays through every bore, four material points, the exterior and the optional central fifth-hole location. These physical ray checks reject a displaced hole that leaves overall volume unchanged.

Classification: INPUT_VERIFIED_NOT_EXTERNAL_CAD is source evidence only; BLOCKED_OR_REJECTED disallows a success claim; NON_OCCT_SAMPLE_ACCEPTED requires a real successful BRL-CAD import and physical sampling of all four fixed fixtures. This is bounded non-OCCT physical interchange evidence, NOT general STEP interoperability, independent exact analytic area, a native OCCT 8.0.1 C++ execution claim, or human usability acceptance. Production-native provisioning remains separately blocked in KERNEL Draft #67 and PLATFORM Draft #89.

This repository does not bundle or install BRL-CAD, and the local host used for implementation had no BRL-CAD executables. Integration alone owns shared CI and guarded merges. Source ownership is limited to conformance/external-cad/**.

## Model-space ray anchoring

In addition to the original immutable STEP digests, strict importer exit code, volume and bore/material ray checks, the acceptance runner now validates the **actual NIRT origin and direction** for every probe, along with the solid-ray entry X/Y and the expected top-face Z coordinate (0→thickness mm). This detects translations or disconnected geometry that preserve the volume and measured thickness. Receipts contain the measured 3D entry points. Synthetic parser regressions are not independent CAD execution; only actual BRL-CAD CLI artifacts can qualify exchange.

## Actually observed hosted importer limitation and independent alternate

The actual [Actions run 42383946537, attempt 2](https://github.com/techrote/INTUIT3D/actions/runs/42383946537) proved the corrected BRL-CAD 7.44.0 `step-g -o file.g input.step` **exits 0**, parses all 686 AP214 entities with zero schema errors/warnings, **but then reports** `Error: ::LoadONBrep(...) not implemented for Curve`, followed by failed Edge_Curve, Closed_Shell and Manifold_Solid_Brep conversions. The generated 7,928-byte `.g` is not acceptable solid evidence. The harness now rejects any real `Error:` line even when the vendor returns success, preserving its raw logs, rather than treating a populated file as a pass.

For exactly this verified BRL-CAD implementation limitation (and no generic failures), `run-pinned-brlcad.sh` also attempts a **distinct source-pinned non-OCCT Rust CAD kernel**, [AnvilCAD `anvil-step` commit `50c053840933c92d598976e837e63ccd7626c312`](https://github.com/swperb/anvilcad/commit/50c053840933c92d598976e837e63ccd7626c312). It compiles `anvil_step_probe.rs` in that pinned source checkout and independently verifies imported one-solid/topology, triangle volume, coordinate-anchored 4/5-hole rays, thickness and fifth-bore undo using original SHA-pinned source STEP bytes. It produces a separate `anvilcad-independent/qualification/qualification.json` and Rust binary/source provenance. This path is **experimental until a genuine hosted execution succeeds**; no BRL-CAD PASS is inferred from an AnvilCAD result, and sampled mesh volume does not certify exact analytic surfaces. The existing GitHub job name references BRL-CAD; Integration must rename the shared workflow before treating a successful fallback as non-OCCT product acceptance.
