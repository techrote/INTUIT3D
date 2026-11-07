# KERNEL OCCT 8.0.1 C++ candidate: plate/cut/STEP

This adds a real C++ exact-geometry implementation behind the already-used
intuit3d/kernel/plate-v1 semantic request. It is **not yet admitted as production
geometry**; C++ compilation and executed native/STEP evidence are required
before that disposition can change.

## Pinned source and build

Reuse radiCADSAC RCS-006 from
https://github.com/techrote/radiCADSAC/tree/main/research/rcs-006/harness .
Its actual source is Open-Cascade-SAS/OCCT commit
b8f597c677811d1f9f4d8a97f5ae2825c0353a42 (8.0.1),
profile release-shared-cxx17-worker-only-headless-v4.
The CMake adapter rejects absent/wrong install metadata and links only the
14 pinned toolkits. It does not download or silently use system OCCT.

Commands from repository root on an appropriately provisioned machine:

    export RCS006_OCCT_PREFIX=/absolute/path/to/occt-8.0.1
    cmake -S native/occt8 -B /tmp/intuit3d-occt8-build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release -DINTUIT3D_OCCT8_PREFIX="$RCS006_OCCT_PREFIX"
    cmake --build /tmp/intuit3d-occt8-build --parallel 2
    INTUIT3D_OCCT8_WORKER=/tmp/intuit3d-occt8-build/intuit3d_occt8_plate \
      python3 -m unittest discover -s native/tests -p test_occt8_bridge.py -v

For one independently supplied local project:

    python3 native/occt8_bridge.py \
      --worker /tmp/intuit3d-occt8-build/intuit3d_occt8_plate \
      --step-output /tmp/new-cxx-plate.step \
      < native/examples/plate-two-holes.request.json

The output STEP path must not already exist. Change thickness and revision in
the JSON to rebuild; the test fixture checks 8 mm and 12 mm. The native worker
runs one request in a process-isolated supervisor with deadline, finite input
validation, deterministic analytical volume/area and cylinder-topology gates,
fixed zero fuzzy tolerance, and same-engine STEP reimport. The host verifies
identity, revision, geometry reports and bytes before same-filesystem exclusive
hard-link publication. The SHA-256 is reported.

For Node/TypeScript consumers, import
@intuit3d/kernel-contract/occt8-v1 to assess the pinned backend's report.
The response deliberately remains experimental_report with exactAuthority=false
and independentInteroperability=false. Never take arbitrary backend versions
from project files.

## Evidence and remaining qualifications

The existing Python OCP 7.9.3.1 source executed two-hole B-rep/STEP on Linux
with volumes 74990.44263153226 and 112485.66394729842 cubic mm at 8 and
12 mm thickness, respectively. These establish a stepping-stone baseline, not
results from the C++ code. The native 8.0.1 C++ executable requires a pinned
installation before a **real C++ pass** can be asserted. The 8.0.1 C++ same-
engine STEP read-back does not constitute a genuinely independent external
consumer. Windows native process-tree containment is also unqualified.

Implementation disposition: **repair then adopt** after exact-head C++ build,
representative 0/1/2-hole native fixtures, output artifact verification and
independent STEP consumer. Retain the current OCP experimental provider until
then. Shared root workspace/CI changes belong to INTEGRATION.

OCCT 8.0.1 uses LGPL-2.1 with special exception; dynamically link toolkits
and preserve third-party notices. This PR commits no OCCT source/binaries.
