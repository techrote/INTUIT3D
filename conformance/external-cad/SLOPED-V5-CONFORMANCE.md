# KERNEL-002 v5 selected sloped-profile: independent non-OCCT conformance

**Candidate, not yet a physical PASS.** The accepted original U-bracket
evidence cannot qualify draft KERNEL #195's new selected sloped part.

## Independently authored physical oracle

Both C++ producer consumers model the selected six-edge polygon
(0,0), (120,0), (120,20), (65,20), (45,80), (0,80), with a
14 x 8 mm through-window centred (95,10). This polygon contains a true
diagonal edge and a concave junction. Direct uses a radius-5 circular blind
pocket centred (15,50) with depth 3 mm; authored INTENT/SKETCH/RUNTIME
uses a different 10 x 10 mm rectangular blind pocket at the same position
and depth. Both have 8 mm and retrospectively edited 12 mm STEP outputs.

| Case | Analytic material volume mm³ | Surface area mm² formula |
|---|---:|---|
| direct 8 | 44468.38055098 | 11176+(364+sqrt(4000))*8+30*pi |
| direct 12 | 66820.38055098 | 11176+(364+sqrt(4000))*12+30*pi |
| authored 8 | 44404 | 11176+(364+sqrt(4000))*8+120 |
| authored 12 | 66756 | 11176+(364+sqrt(4000))*12+120 |

The separately compiled, source-pinned AnvilCAD importer must reconstruct
one exact closed warning-free solid per STEP, oriented watertight triangles,
triangle-derived material volume and exposed area, and **38 world-space
material/void/pocket-floor rays each**. The ray oracle crosses three distinct
segments of the real diagonal, the re-entrant corner, each window wall,
and both blind pocket variants. The four additional diagonal pocket rays distinguish the R5 circle from the 10x10 square even when cardinal walls and the 1% mass/area budgets match. **Four imports / 152 physical rays**.

The Python runner checks original STEP byte SHA-256 against unmodified native
producer receipts, exact KERNEL git SHA and C++ source hash, actual worker
binary SHA, probe binary SHA and AnvilCAD source pin. It retains original STEP
bytes, raw logs and qualification output. It is a bounded fixture gate, not
general curved-geometry, multi-body assembly or browser acceptance.

## One-command external replay, after a genuinely built v5 producer

Use the existing Integration/Native Build immutable OCCT 8.0.1 C++ worker
build for the actual #195 source SHA. On its original checkout execute:

    INTUIT3D_OCCT8_WORKER=/absolute/worker python3 -m unittest discover -s native/tests -p test_occt8_linear_contract.py -v
    INTUIT3D_SOURCE_SHA=FULL_KERNEL_SHA node packages/kernel-contract/examples/pinned-occt8-sloped-profile.mjs /absolute/worker /fresh/direct
    INTUIT3D_SOURCE_SHA=FULL_KERNEL_SHA node packages/kernel-contract/examples/runtime-occt8-sloped-profile-native.mjs /absolute/worker /fresh/authored

Retain sloped-receipts.json, authored-receipts.json, four original STEP
files, compiler log and worker SHA. Compile the **new** independent
anvil_step_probe.rs through the accepted AnvilCAD source-pinned build path
(commit 50c053840933c92d598976e837e63ccd7626c312), preserving actual
cargo log and compiled probe hash. The older compiled U-bracket executable
does not implement this new mode.

    python3 conformance/external-cad/sloped_v5.py \
      --direct-dir /fresh/direct --authored-dir /fresh/authored \
      --kernel-tree /path/to/exact-kernel-195-checkout \
      --kernel-sha FULL_KERNEL_SHA \
      --worker /absolute/compiled/intuit3d_occt8_plate \
      --anvil-source-sha 50c053840933c92d598976e837e63ccd7626c312 \
      --probe /absolute/new-anvilcad/intuit_step_probe \
      --probe-sha256 FULL_COMPILED_PROBE_SHA256 \
      --output-dir /fresh/sloped-independent-evidence

Success prints/records NON_OCCT_SLOPED_V5_FOUR_STEP_PHYSICAL_PASS only after
the binary actually executes four non-OCCT imports and verifies all 152
material rays. **Still review the hosted C++ binary/source compile binding
and independent AnvilCAD build log**; source and binary digests alone do not
prove the producer was compiled at that source revision.

## Physical negative qualification and scope

Once real source-matched STEP bytes exist, execute the same probe on the
8 mm direct STEP with the **12 mm** oracle; on the 8 mm authored STEP with
the **direct** circular-pocket oracle; and on an actually translated or
modified STEP which preserves volume but changes selected diagonal material.
Every real adversary must exit 3 and retain logs. Python receipt/parser
unit tests are source-only and are not substitute physical negative evidence.

Until the newer KERNEL #195 v5 producer and the new independently compiled
probe are genuinely executed on hosted infrastructure, the gate remains
**unqualified**. No shared CI/workflow changes or merge may be made by this
lane. Accepted original U-bracket evidence and unrelated product progress
remain unaffected.

## v6 zero/one/two-cut selected sloped-profile physical consumer (candidate)

The same independently compiled AnvilCAD probe now accepts
`--progressive-v6 STEP direct|authored 0|1|2 8|12` alongside the existing
unchanged v5 mode. This is an additive physical-import **capability**, not
an assertion that v6 STEP files have been compiled/imported yet.

Direct sequence: uncut stock → circular R5 blind pocket → that pocket and
14×8 through-window. Authored sequence: uncut stock → rectangular through
window → window and 10×10 square blind pocket. Each state at both 8 and 12 mm
has its own analytic material/surface oracles and **38 material/void ray
locations**, including no-cut solid where a future cutter will be, slope
positions, walls/floors, and circle-versus-square diagonals. The complete
next physical gate requires **12 genuine STEP files / 456 AnvilCAD rays**.

Prerequisite: Integration/Native Build must execute the two immutable KERNEL
#195 v6 producers using a source-matched OCCT 8.0.1 C++ binary:

```sh
INTUIT3D_SOURCE_SHA=FULL_KERNEL_SHA node packages/kernel-contract/examples/pinned-occt8-progressive-profile.mjs /absolute/worker /fresh/direct-v6
INTUIT3D_SOURCE_SHA=FULL_KERNEL_SHA node packages/kernel-contract/examples/runtime-occt8-progressive-profile-native.mjs /absolute/worker /fresh/authored-v6
# After compiling this exact revision of anvil_step_probe.rs against pinned AnvilCAD:
/path/to/anvil_step_probe --progressive-v6 /fresh/direct-v6/progressive-0-8.step direct 0 8
/path/to/anvil_step_probe --progressive-v6 /fresh/authored-v6/authored-1-12.step authored 1 12
```

Verify all original STEP hashes/producer receipt source pins, all 12 imports,
physical wrong-stage and shape-switch negatives and an exact source-to-binary
compilation log before admitting interoperability under #74. Source-only unit
receipts/old U fixtures do **not** qualify v6 physical correctness.

### All-in-one v6 independent CAD execution

After one exact-head hosted KERNEL #195 OCCT 8.0.1 build has produced the
**original** six direct plus six authored progressive STEP outputs, the
following command performs twelve independent physical imports, 456
material/void/floor rays, **four physical adversarial re-imports** (missing
blind, fabricated square pocket, circle vs square, incorrect thickness),
source/binary/hash custody, and atomic fail-closed evidence status:

\`\`\`sh
python3 conformance/external-cad/progressive_v6.py \
  --direct-dir /fresh/direct-v6 --authored-dir /fresh/authored-v6 \
  --kernel-tree /exact/KERNEL-195-checkout --kernel-sha EXACT_KERNEL_SHA \
  --worker /absolute/pinned-OCCT8-worker --probe /absolute/compiled-AnvilCAD-probe \
  --probe-sha256 ACTUAL_ANVIL_EXECUTABLE_SHA256 \
  --anvil-source-sha 50c053840933c92d598976e837e63ccd7626c312 \
  --output-dir /fresh/progressive-independent-evidence
\`\`\`

Preserves 12 original STEP copies, individually hashed AnvilCAD logs, four
negative replay logs, exact worker/engine SHA pins and qualification.json.
The four negative cases must exit via the independent probe's controlled
NOT_QUALIFIED rejection, not crash or timeout. A physical PASS remains
**unavailable** until genuine source-matched producer data and exact-head
compiler log are independently inspected. Synthetic tests cover contract
refusals only, never imported geometry.

## Independent mass-distribution acceptance (candidate, 8 November)

The sloped v5 and progressive v6 modes now also reconstruct **the 3D
material centroid and all six material-covariance components (XX, YY, ZZ,
XY, XZ, YZ)** from the independently imported, oriented closed triangle
mesh. These are real volume integrals of that CAD reconstruction, not
readback of the producer's mass-properties report or STEP text.

A separate analytic oracle applies Green's theorem to the immutable
six-edge selected polygon, extrudes its planar area/moments, then subtracts
the real cutter volumes with their actual 3D centres and intrinsic moments.
It covers both cutter histories and **all twelve direct/authored,
zero/one/two-cut, 8/12 mm stages**, rather than calibrating one historical
finished part. The Python receipt validator independently reconstructs
the same analytic reference and requires the nine measured observables.
It refuses missing/nonfinite/displaced readings. The legacy original
U-bracket mode is unchanged.

A correct imported solid must satisfy all existing one-solid, closed
topology, source/hash, volume, surface and 38 material/void rays **and**
the additional mass-distribution predicates. Acceptance thresholds:
each centroid axis within 0.15 mm; diagonal covariance within the larger
of 1% of the corresponding analytic reference or 0.1 mm²; mixed covariance
within the larger of 5% or 0.25 mm². No physical threshold was enlarged
on the earlier U-bracket gate.

The source-only adversaries deliberately displace centroid readings by 10 mm,
or covariance readings by 100 mm², or inject nonfinite values, across all
progressions. These verify only the parser's fail-closed contract. The
Rust implementation measures actual mesh tetrahedra, and **the physical
adversarial property is unqualified until a real sloped native STEP
is independently imported with this compiled candidate**. Do not report
the synthetic tests as real C++ or AnvilCAD physical evidence.

The v5/v6 source-matched pinned OCCT 8.0.1 producer build and its original
STEP exports remain an explicit dependency on KERNEL #195 and Integration
#74. The accepted older U-bracket physical evidence is not a substitute.
