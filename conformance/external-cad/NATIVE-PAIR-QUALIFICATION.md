# Native OCCT 8.0.1 STEP pair → independently reconstructed non-OCCT geometry

This supplementary PLATFORM / external-CAD acceptance path reuses the **original**
GitHub Actions pinned-C++ output, not a new OCP fixture, mock JSON, Part 21
text parser or same-engine OCCT readback. It is deliberately limited to the
qualified **120 × 80 mm plate with two Ø12 through-holes**, at 8 and 12 mm
thickness. Generalized profile-based blind and through cuts remain KERNEL-002
(#154) and require separate physically defined predicates.

## Offline execution

Download the **original** occt801-cxx-and-step-evidence ZIP from an actually
successful hosted native C++ run. The ZIP must retain versions.txt,
qualification/qualification.json, qualification/worker-build/intuit3d_occt8_plate
and both qualification/plate-{8,12}mm.step files. The producer's exact KERNEL
commit is recorded in versions.txt; supply that full 40-character SHA, rather
than assuming that a moving branch or an older run matched accepted source.

Compile the independently implemented AnvilCAD STEP probe using
run-pinned-anvil.sh (the upstream source is locked to commit
50c053840933c92d598976e837e63ccd7626c312) and retain its executable
SHA-256 and full compiler provenance. The existing hosted BRL-CAD fallback
build produces this executable at
anvilcad-independent/anvilcad/target/release/examples/intuit_step_probe
within the fallback's evidence directory.

Run, with a **new** evidence directory:

    python3 conformance/external-cad/native_pair.py \
      --native-zip /path/to/occt801-cxx-and-step-evidence.zip \
      --kernel-sha FULL_40_CHARACTERS_FROM_PRODUCER_VERSIONS \
      --probe /path/to/source-pinned/intuit_step_probe \
      --output-dir /tmp/native-pair-independent

The runner compares the producer's reported native compilation and OCCT commit
to actual artifact bytes: it SHA-256-verifies the **worker executable**, both
**original STEP files**, physical dimensions and source SHA. It independently
executes the non-OCCT probe on each unchanged STEP. It rejects missing/non-exact
B-reps, non-watertight meshes, nonzero warnings, wrong 8/12 mm volume/thickness,
misplaced bores/material/exterior samples, stale source and unchanged geometry.
Reports, raw stdout/stderr, original STEP bytes, source identities and hashes
are saved in the fresh evidence directory even if physical verification fails.

A NON_OCCT_SOURCE_MATCHED_NATIVE_PAIR_ACCEPTED receipt means **two actual
STEP files were independently imported and physically sampled**, with one
exact reconstructed B-rep and a watertight triangulation each. The reported
volume is computed from independent **triangles**, with an explicit 1%
comparison budget; it is not an independent analytic mass property, universal
STEP interoperability, generalized cut acceptance, a Windows-native pass or
human CAD usability approval.

## Executed example (7 November 2026)

This runner was executed in Debian 13 x86_64 against **the actual**
[hosted #158 native source-matched artifact](https://github.com/techrote/INTUIT3D/actions/runs/42388335518/artifacts/13581127658),
not mock STEP files:

- Producer KERNEL SHA: c46d02847468b69a106fbfa6fad715c10399ff2c
- Producer Platform checkout: d5c2c3f54466479bf5bec3b04c3b66ed00549ec4
- OCCT source: b8f597c677811d1f9f4d8a97f5ae2825c0353a42
- Native worker SHA-256: a91ecf0a5ece0b4f887d029acfab6fe14a37cc21c052662e2f37909930a88e0f
- Original 8 mm STEP SHA-256: 810ab4cd70b13c1d91be069d4a2d778cfe05de9b8f106fdff5a192395a3c3bd3
- Original 12 mm STEP SHA-256: 30fc62a9a4b439f73e2fc544902b79e7894450184b67c51e151b4d829d449169
- Independent AnvilCAD compiled probe SHA-256:
  bfdeb68255af27c47fcc90085659c1d38568345e20795cd4e7b8846fc42ea96c

Both samples PASS native producer source/hash admission, non-OCCT B-rep import,
watertightness, coordinate-anchored bore/material/exterior rays, 0–8/0–12 mm
material heights and independently measured volume. This example does **not**
automatically qualify later KERNEL heads.

## INTEGRATION handoff

The production .github/workflows/external-cad.yml remains Integration-owned.
After the original four OCP flange fixtures and pinned AnvilCAD source build
complete, download the occt801-cxx-and-step-evidence artifact of the *selected,
source-matched* KERNEL run and invoke native_pair.py using that run's full
source SHA. Retain both acceptance results and raw artifacts. Do not substitute
the older OCP flange success for this native C++ pair. The hosted C++ compilation
need not be repeated if its original artifact remains available, and the same
AnvilCAD build can be reused without downloading/building the source again.
