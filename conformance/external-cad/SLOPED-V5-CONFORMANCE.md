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
