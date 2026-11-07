# Multi-feature dimensions v1 — one user action, multiple body chains

**API:** `@intuit3d/feature-ops/multi-feature-dimensions/v1` exports
`editMultipleBodyDimensions(history, request, services)`.

This operation changes **2–16 existing extrusion depths and ordered-cut blind/
through-all extents**, across one or more **explicitly selected bodies**, in
one RUNTIME/INTENT transaction and one undo frame. It is useful for real
assembly revisions such as simultaneously adjusting a valve housing's wall
thickness and several pocket depths while separately editing a mating cap.

Every edit supplies its target body and feature identity, source SKETCH and
canonical profile, old expected value, new dimension, unique event ID and the
shared project/revision fence. For cut edits, the immediate predecessor
writer is also explicitly selected. The operation preflights *all* edits;
duplicate targets, ambiguous or changed body chains, stale/unsolved SKETCH
profiles, inconsistent original values and inadmissible cut previews fail
before the RUNTIME commit. There is no partial success or inferred target.

**Authority:** INTENT's `inspectBodyCutChain`,
`inspectBodyCutExtent`, and `previewBodyCutExtentEdit` own cut-chain and
extent admission. SKETCH discovery and RUNTIME's current solved evaluation
own source-profile admissibility. RUNTIME owns the single transaction,
invalidation, undo/archive and pending/preview statuses. This package does
not implement a journal, numeric solver, geometry kernel or exporter.

Run the real consumer with Node 22 and registered local workspace:

```sh
npm test --workspace @intuit3d/feature-ops
node --experimental-strip-types packages/feature-ops/examples/valve-housing-dimension-batch.mjs
```

The demonstration constructs a 110 mm stepped air-valve housing with two
ordered cuts, a separate ported cap, and an untouched spacer. It changes
housing thickness 10→14 mm; the first pocket 3→5 mm; the second pocket
blind→through-all; cap thickness 6→9 mm; and cap port depth 2→3 mm in one
undoable transaction. It checks transitive invalidation, wrong-target and
stale-selection refusal, single-frame undo/redo and archive reopening.

**WORKBENCH:** expose a multi-selection Dimensions inspector with a reviewable
before/after table, exact selected body/feature/preceding-writer and source
profile fences, and a single **Apply dimensions** action. Display individual
`preview_only`, `pending_exact_provider` or `blocked_dependency` statuses
from the returned report. Failed preflight must leave the prior document
unchanged.

**RUNTIME:** no new service required; use accepted `commit/inspect/diff`.
**KERNEL/PLATFORM:** physically execute/qualify chosen Boolean chains and
STEP independently. A returned native handoff is only a revision-fenced
request for evaluation, **not** a B-rep/OCCT8 or interoperability result.
**INTEGRATION:** register no new root dependency; run exact-head Node 22
Linux/Windows and type/exports checks, reconcile current main and perform
guarded merge only when qualified.

The existing #97 product issue was already closed/accepted; this incremental
extension does not reopen it or claim independent CAD geometry acceptance.


## Direct WORKBENCH consumer: inspect → edit rows → Apply

The same `multi-feature-dimensions/v1` entry now exposes two read-only
consumer helpers, both usable without browser-side CAD authority:

1. `inspectSelectedFeatureDimensions(history, {expectedProjectId,
   expectedRevision, selections:[{featureId,targetBodyId}, ...]}, services)`
   returns 2–16 currently admissible, explicitly selected dimension rows.
   Rows contain SKETCH-selected profile identity, body and predecessor IDs,
   current depth/extent, exact source revision and truthful RUNTIME status.
   A stale or ambiguous source is refused rather than guessed.
2. `prepareSelectedFeatureDimensionEdits(snapshot, proposed)` takes only
   the selected feature ID, a fresh user event ID and proposed depth/extent for
   each row; it builds the complete expected-value edit request. The caller
   passes that to `editMultipleBodyDimensions(history, request, services)`.

```js
const snapshot=inspectSelectedFeatureDimensions(history,{
  expectedProjectId:history.document.projectId,
  expectedRevision:history.document.revision,
  selections:[{featureId:'extrude.housing',targetBodyId:'body.housing'},
              {featureId:'cut.inlet',targetBodyId:'body.housing'}]
},services);
const request=prepareSelectedFeatureDimensionEdits(snapshot,[
  {featureId:'extrude.housing',eventId:'ui.depth.1',toDepthMm:14},
  {featureId:'cut.inlet',eventId:'ui.pocket.1',
    toExtent:{kind:'blind',depthMm:5}}
]);
const result=editMultipleBodyDimensions(history,request,services);
```

The snapshot is **not** an authorization or native geometry result: the
commit API independently rechecks every feature, body chain, SKETCH profile
and old value against the authoritative history. A subsequent revision
invalidates old Apply requests. No root/workspace, RUNTIME, model or browser
modification is required for the versioned API itself.
