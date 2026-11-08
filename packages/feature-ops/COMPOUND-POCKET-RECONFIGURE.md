# Compound Pocket Reconfiguration — FeatureOps v1

**Public consumer API:** `@intuit3d/feature-ops/compound-pocket-reconfigure/v1`  
**Export:** `reconfigureCompoundPockets(history,request,services)`

A single **Edit Pockets → Apply** gesture changes **both the selected SKETCH
profile source and blind/through-all extent** of 2–8 previously authored cuts
in different bodies (or the same explicitly named body). The operation preserves
every selected cut ID, target body ID, its ordered predecessor writer, and all
other body features. It can optionally retire an unused displaced source SKETCH.

This differs from the accepted separate *shared-source retrofit* and
*multi-feature depth* operations: these two dimensions of a pocket edit are
validated together and committed as **one undo frame**, with no observable
intermediate half-edited CAD document. If a selected body, old source/profile,
old extent, revision, replacement sketch or optional retirement is invalid,
the complete action refuses without modifying history.

## Workflow / contract

The user selects each **cut and target body** and chooses the current writer
predecessor, expected old SKETCH/cycle, authored replacement SKETCH/cycle,
old blind/through extent and new extent. All IDs are semantic, not mesh face
indices. Request fields are:

- `format: 'intuit3d.feature-ops.compound-pocket-reconfigure'`,
  `version: 1`, `expectedProjectId`, `expectedRevision`,
  `units: 'mm'`, `frame: 'local_xy'`
- `edits`: 2–8 records each supplying `sourceEventId`, `extentEventId`,
  `cutFeatureId`, `targetBodyId`, `afterBodyWriterId`,
  `expectedSourceSketchId`, `expectedProfileCandidateId`,
  `sourceSketchId`, `profileCandidateId`,
  `releasePreviousSketchDependency`, `fromExtent`, `toExtent`
- Optional `retireSketch:{eventId,featureId}` names an explicitly displaced
  sketch and is refused if any active dependent still references it.

`fromExtent` and `toExtent` use either `{kind:'through_all'}` or
`{kind:'blind',depthMm:positiveFiniteNumber}`. An Apply must actually change
both source and extent per selected pocket; source-only and extent-only edits
already have independent accepted operations.

The implementation obtains real SKETCH/profile admission and RUNTIME status,
then stages one accepted INTENT batch **source** preview followed by an accepted
INTENT **extent** preview for each selected cut. It replays all events against
the original revision and commits exactly once through RUNTIME. It does **not**
synthesize a cut payload or bypass INTENT's dependency planner. A new SKETCH
must already exist as an accepted feature. Returned cut statuses remain
`pending_exact_provider` or `blocked_dependency`; native handoffs explicitly
say `compatibility:'not_claimed_ask_RUNTIME_provider'`.

## Executable acceptance / consumer handoff

```sh
node --experimental-strip-types packages/feature-ops/examples/compound-pocket-reconfigure.mjs
npm test --workspace @intuit3d/feature-ops
npm run check:workspace
```

The runnable consumer builds an **L-shaped machine guard**, an independent
backing rail and an unaffected shim. In one Apply it moves both relief cuts
from one shared SKETCH to a newly admitted SKETCH, switches the guard pocket
from blind 3 mm to through-all and the backing rail from through-all to
blind 2.5 mm, and retires the old SKETCH. It verifies wrong-target/stale-ID
refusals; one undo, redo, archive reopening, 10→14 mm retrospective guard
thickness editing and re-editing of the now-shared new profile. The unrelated
shim remains unchanged and is not invalidated.

**WORKBENCH:** present a multi-selection pocket inspector with current target
body, source SKETCH/canonical cycle, predecessor and extent; submit all edited
values with one project/revision fence through this v1 entry point. Show the
per-cut status as provider-pending, not as a completed Boolean. **RUNTIME:**
owns the journal, undo/replay and provider readiness. **INTEGRATION:** owns
exact-head Windows/Linux testing, source reconciliation and guarded merge.
There is no browser graphical acceptance in this package.

**Exactness boundary:** this operation has semantic and analytic SKETCH/INTENT/
RUNTIME truth only. It does **not** execute a generalized native C++ Boolean,
build a verified B-rep, independently read a STEP, or establish physical
interoperability. No native/exact claim follows from unrelated experimental
OCP/STEP checks.
