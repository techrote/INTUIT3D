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

# On a host with the genuine BRL-CAD binaries installed, discover import root:
step-g --strict --exact --repair none --report /tmp/first-import.json \
  -o /tmp/first-import.g /tmp/intuit-flange-input/flange.four.step
mged -c /tmp/first-import.g tops

python3 conformance/external-cad/brlcad_flange.py \
  --bundle /path/to/original-artifact-13563062028.zip \
  --output-dir /tmp/intuit-flange-external-unique \
  --object ACTUAL_SINGLE_IMPORTED_ROOT_OBJECT
~~~

The importer must expose the same unambiguous top object name in each fixture; otherwise the runner refuses it. The evidence output directory must not exist already. The script saves original STEP bytes, imported BRL geometry databases, logs, tool SHA-256, ray results and a manifest.

Each fixture undergoes strict, exact, no-repair import, a gqa independent approximate ray-volume comparison (explicit 1% tolerance), and individual nirt rays through every bore, four material points, the exterior and the optional central fifth-hole location. These physical ray checks reject a displaced hole that leaves overall volume unchanged.

Classification: INPUT_VERIFIED_NOT_EXTERNAL_CAD is source evidence only; BLOCKED_OR_REJECTED disallows a success claim; NON_OCCT_SAMPLE_ACCEPTED requires a real successful BRL-CAD import and physical sampling of all four fixed fixtures. This is bounded non-OCCT physical interchange evidence, NOT general STEP interoperability, independent exact analytic area, a native OCCT 8.0.1 C++ execution claim, or human usability acceptance. Production-native provisioning remains separately blocked in KERNEL Draft #67 and PLATFORM Draft #89.

This repository does not bundle or install BRL-CAD, and the local host used for implementation had no BRL-CAD executables. Integration alone owns shared CI and guarded merges. Source ownership is limited to conformance/external-cad/**.
