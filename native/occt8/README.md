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
      --cross-version-step-audit \
      --worker /tmp/intuit3d-occt8-build/intuit3d_occt8_plate \
      --step-output /tmp/new-cxx-plate.step \
      < native/examples/plate-two-holes.request.json

For an additional **independent implementation of a bounded STEP plate reader**,
pass `--part21-step-audit` to the same command (it may be combined with
`--cross-version-step-audit`). The new `native/occt8/part21_oracle.py`
runs as a separate deadline-supervised standard-library process. It parses
the **actual ISO 10303-21 file**, checks one closed manifold B-rep solid,
two-sided edge usage, explicit millimetre units, vertex envelope, vertical
cylindrical surfaces and both bore-circle boundaries. It computes a
plate-subset analytic volume from these read-back entities, then binds the
report to the exact STEP SHA-256 before publication. Executable standalone
usage, after generating a STEP and matching plate request:

    python3 native/occt8/part21_oracle.py \
      --step /tmp/new-cxx-plate.step \
      --intent native/examples/plate-two-holes.request.json \
      --report /tmp/plate-part21.json

This is **not** a general-purpose STEP reader or full CAD interoperability
certification; it cannot independently integrate arbitrary trimmed curved
surfaces, test other CAD applications or establish OCCT 8.0.1 C++ execution.
The typed Node contract exposes `part21Audit` separately, still with
`exactAuthority:false` and `independentInteroperability:false`. The
existing optional cross-version OCP verification remains distinct.

The optional `--cross-version-step-audit` flag requires the pinned **OCP 7.9.3.1**
Python dependency. It loads the actual staged STEP file in a *second isolated
process*, verifies the measured geometry, independent arithmetic, authored
plate envelope, holes, digest, and shared deadline **before** publication. It
is a cross-version OCCT corroboration, **not** an independent STEP engine or
independent interchange certification. Without the flag, the C++ worker's
same-engine readback remains the only geometric STEP readback. Responses label
`stepVerification` as `occt-8.0.1-same-engine` or
`occt-7.9.3.1-separate-process`. The browser-safe consumer retains
`exactAuthority: false` and `independentInteroperability: false` in both modes.

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


## Node consumer: real C++ provider (experimental)

Once the **actual pinned** binary exists, RUNTIME/WORKBENCH can invoke the
provider using the shared revision-fenced artifact transaction instead of
spawning the Python OCP prototype:

```js
import {runPinnedOcct8Plate} from '@intuit3d/kernel-contract/local-occt8-provider';
const result = await runPinnedOcct8Plate(plateRequest, {
  workerExecutable: '/absolute/path/to/intuit3d_occt8_plate',
  readCurrentRevision: () => currentModelRevision,
  stepOutput: '/path/to/new-export.step',
  part21StepAudit: true,
  crossVersionStepAudit: true, // requires pinned OCP 7.9.3.1 in this Python env
  timeoutMs: 30000,
  signal: abortController.signal,
});
```

This Node API uses the *real* `native/occt8_bridge.py`, invokes the isolated
C++ worker once per operation, validates both the versioned native report and
the SHA-256 of the actual private STEP bytes, checks revision again before and
after atomic exclusive publication, and cancels pending work on abort. The
independent Part 21 plate-subset audit is required by default for exports.
It deliberately returns `exactAuthority: false` and
`independentInteroperability: false` even when that audit passes; the browser
must not relabel the result production exact. Disabling the optional cross-
version OCP audit does not change this authority boundary.

`node --test packages/kernel-contract/test/local-occt8-provider.test.mjs`
executes a cross-platform **synthetic bridge transport** regression with
cancellation, digest substitution, malformed geometry and exclusive file
publication. It is **not** proof of an 8.0.1 C++ build or valid STEP geometry.
The actual geometry/STEP qualification remains the `INTUIT3D_OCCT8_WORKER`
Python test and a separately implemented full CAD STEP consumer.

## Evidence and remaining qualifications

The existing Python OCP 7.9.3.1 source executed two-hole B-rep/STEP on Linux
with volumes 74990.44263153226 and 112485.66394729842 cubic mm at 8 and
12 mm thickness, respectively. These establish a stepping-stone baseline, not
results from the C++ code. The new staged-STEP publication test exercises real OCP-generated STEP bytes
and a separately supervised reader against a simulated C++ producer report.
It does **not** execute the C++ binary and cannot establish 8.0.1 equivalence.
The native 8.0.1 C++ executable requires a pinned installation before a
**real C++ pass** can be asserted. The 8.0.1 C++ same-
engine STEP read-back does not constitute a genuinely independent external
consumer. Windows native process-tree containment is also unqualified.

Implementation disposition: **repair then adopt** after exact-head C++ build,
representative 0/1/2-hole native fixtures, output artifact verification and
independent STEP consumer. Retain the current OCP experimental provider until
then. Shared root workspace/CI changes belong to INTEGRATION.

OCCT 8.0.1 uses LGPL-2.1 with special exception; dynamically link toolkits
and preserve third-party notices. This PR commits no OCCT source/binaries.

## Versioned C++ ordered pocket/cut product increment (candidate)

`intuit3d/kernel/plate-cut-chain-v1` extends the original plate-v1 *without changing it*. A plate has up to 64 nonintersecting circular through-bores and 1–16 explicitly ordered, identified axis-aligned rectangular cuts. Each cut has a strictly positive `cutDepthMm`, measured **downward from the top face**; `cutDepthMm == plate.thickness` is a true through-window. This conservative first OCCT8 slice rejects bore/cut intersection, overlapping/tangent cuts, out-of-bounds tools, ambiguous target body, wrong units and silently widened fuzzy tolerance. Stable `featureId` values are carried in the request; no transient OCCT face numbering is persisted.

**Actual C++ route, once the pinned worker has been compiled:**

```sh
python3 native/occt8_bridge.py \\
  --worker /absolute/path/to/intuit3d_occt8_plate \\
  --step-output /tmp/new-ordered-cxx.step \\
  < native/examples/occt8-ordered-rect-cuts.request.json
node packages/kernel-contract/examples/pinned-occt8-cuts.mjs \\
  /absolute/path/to/intuit3d_occt8_plate /tmp/fresh-cut-output
python3 -m unittest discover -s native/tests -p test_occt8_cut_chain.py -v
node --test packages/kernel-contract/test/occt8-cut-chain.test.mjs
```

The C++ code constructs real `BRepAlgoAPI_Cut` solids sequentially, checks one valid solid plus analytic material volume, area, face and through-bore invariants, writes genuine STEP and requires same-engine reconstruction. The bridge shares the existing isolated subprocess deadline and exclusive artifact publication. The Node contract preserves revision/abort fencing and reports `exactAuthority:false`, `independentInteroperability:false` until production/external CAD gates are independently demonstrated. **Do not enable the plate-only independent Part 21 structural reader or cross-version bore-only audit for this new profile:** they intentionally do not handle extra pocket faces. They fail closed rather than silently grant STEP provenance.

The synthetic/source-only regressions do **not** qualify C++ execution. Only tests executing with a real `INTUIT3D_OCCT8_WORKER` and retaining binary/STEP evidence establish native qualification; full non-OCCT external CAD reconstruction and a browser-operated authoring path are separate requirements. This is a narrow initial production-facing cut shape, not general curve/profile support.
