# Cut recipe copy v1 — model-backed machining reuse

`@intuit3d/feature-ops/cut-recipe-copy/v1` exposes **inspectCutRecipeCopy** and
**copyCutRecipeToBody**. Select any 2–8 **consecutive** machining cuts (including interior blocks) on one named
body and append copies to a **different, explicitly selected** body with one
undoable RUNTIME/INTENT transaction. This is not synthetic Boolean geometry,
body placement or implicit assembly mating. Uses the accepted INTENT
`body-cut-chain` planner, SKETCH solver/discovery and RUNTIME inspection.

New stable cut IDs preserve each selected `cycle:` profile, shared source
SKETCH ID, blind/through extent and dependency order. SKETCH is deliberately
**shared**, not cloned: subsequent SKETCH edits invalidate both source and copy.
There are no inferred body-to-body transforms. Both bodies must have mm /
local_xy frames, admitted source sketches and unambiguous writer chains.
The downstream provider still decides whether physical Boolean intersection
is possible; an incompatible cut must remain pending or fail.

## WORKBENCH/RUNTIME consumer gesture

1. Select a 2–8 cut ordered **terminal suffix** from `sourceBodyId`. Select
   a distinct `targetBodyId` and its unique `targetAfterBodyWriterId`.
2. Supply `{format:CUT_RECIPE_COPY_FORMAT,version:1,expectedProjectId,
   expectedRevision,expectedDocumentFence:model.serializeProject(history.document),
   units:'mm',frame:'local_xy',sourceBodyId,targetBodyId,sourceCutFeatureIds,
   targetAfterBodyWriterId}` to `inspectCutRecipeCopy`. Render its two
   writer orders and `sourceCuts`. Explain shared source sketches.
3. On **Copy machining recipe → Apply**, pass that same selection plus its
   unchanged `sourceCuts` as `expectedSourceCuts`, and fresh
   `newCutFeatureIds` and `eventIds` arrays (one ID per source cut).
   Invoke `copyCutRecipeToBody` and adopt `result.history`. Use receipt
   `copiedCuts`, `invalidation` and `nativeHandoff`; do not split the
   atomic operation into several browser journal writes.

Stale project/revision/canonical snapshot, mismatched source cut selection,
occupied IDs, incomplete/discontiguous source sequences, same-body copy,
ambiguous writer or unsupported topology-specific/cross-body source cuts,
invalid SKETCH and ambiguous extents refuse before committing. Each append
is previewed on a disposable staged journal using accepted INTENT authority;
only the complete previewed batch commits to original history in one undo frame.

The existing v1 inspector exposes the complete `sourceWriterOrder`, including
any later source cuts not selected for copying. These trailing source cuts
remain untouched, while the chosen block is reconstructed as NEW dependent
target cuts with fresh IDs. Only cuts with portable predecessor+SKETCH
dependencies are admitted; foreign/topology-specific dependencies and
discontiguous selections remain rejected.

## Runnable mechanical acceptance

```sh
node --experimental-strip-types packages/feature-ops/examples/cut-recipe-copy.mjs
npm test --workspace @intuit3d/feature-ops
npm run check:workspace
```

The example copies a blind rectangular relief and through vent from a guard
onto a backing rail. The guard's earlier extrusion dimension is then edited,
and a shared vent sketch is retrospectively resized. Source/copy invalidation,
an independent unaffected shim, invalid selections, undo/redo and archive
reopening are verified against real accepted packages.

**Provider boundary:** semantic and analytic evidence only. No operation-
specific pinned OCCT8 C++ Boolean, STEP export, independent non-OCCT reader,
actual browser interaction or physical-body intersection has been executed
by this feature contract. Integration #74 and the separate RUNTIME, KERNEL,
PLATFORM and WORKBENCH owners retain those acceptance gates.