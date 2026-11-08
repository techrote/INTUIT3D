# Atomic multi-target machining recipe v1

**Public API:** `@intuit3d/feature-ops/multi-target-cut-recipe/v1` provides
`inspectMultiTargetCutRecipe` and `applyMultiTargetCutRecipe`.

## User outcome

An engineer selects **2–8 adjacent cuts**, potentially an interior block
followed by unrelated finishing work, and applies the recipe to **2–4 explicitly
selected existing bodies** with one **Apply to selected bodies** command.
Maximum transaction size is 16 new cuts. For each destination the engineer
chooses **Copy unchanged** (shared authoritative SKETCH profiles/extents)
or **Adapt** (explicit profile and blind/through extent per cut). A change to
the source machined guard after the copy does not automatically edit the
targets' extrusion dimensions; edits to an intentionally shared SKETCH source
invalidate all its dependent machining branches.

This composes the existing accepted single-target recipe/cut-chain planners.
No new Boolean, solver, material intersection heuristic, coordinate-transform
inference, event-source authority or second journal is introduced.

## WORKBENCH / RUNTIME integration

1. Build a fresh `MultiTargetRecipeSelection` from the current persisted
   UndoHistory. Include `format:MULTI_TARGET_CUT_RECIPE_FORMAT`, `version:1`,
   canonical `expectedDocumentFence:model.serializeProject(history.document)`,
   project/revision, `mm`, `local_xy`, source body, ordered cut IDs and
   `targets:[{targetBodyId,targetAfterBodyWriterId}]`. Do not infer target bodies
   from meshes or 3-D screen coordinates.
2. Call `inspectMultiTargetCutRecipe(history,selection,services)` and display
   `sourceWriterOrder` (including unselected later cuts), ordered current
   sources/extents, all target writer orders and pending-provider status.
3. On Apply, use the same selection plus `expectedSourceCuts` from inspection
   and one matching `targetPlans` entry per target. A `copy` plan supplies
   fresh `newCutFeatureIds`/`eventIds` per cut. An `adapt` plan additionally
   supplies `targetCuts:[{sourceCutFeatureId,sourceSketchId,profileCandidateId,
   extent}]`, with every explicit selected profile admitted by SKETCH and
   INTENT. New semantic/event IDs must be unique across **all** destinations
   and the existing document. Request schemas remain versioned and strict.
4. Call `applyMultiTargetCutRecipe` **once**. On success replace the local
   authoritative RUNTIME history exactly once with `result.history`; propagate
   `result.invalidation`, new cut statuses, and `nativeHandoff.bodyIds` at
   `nativeHandoff.sourceRevision`. On refusal display the specific error;
   the original history remains untouched. No partial destination may commit.

The implementation stages each destination on a **disposable history** through
accepted single-target INTENT preview, verifies event delta and exact canonical
result, then commits all admitted events once to original RUNTIME history.
It refuses duplicate/source body targets, stale journal/revision, nonadjacent
cuts, invalid profiles/extents, ambiguous body-writer history, bad later target,
reused semantic IDs, and unsupported provider-specific payloads.

## Executed semantic fixture / qualification commands

```sh
node --experimental-strip-types packages/feature-ops/examples/multi-target-cut-recipe.mjs
node --experimental-strip-types --test packages/feature-ops/test/multi-target-cut-recipe.integration.test.mjs
npm test --workspace @intuit3d/feature-ops
npm run check:workspace
```

The example authors an L-shaped guard, backing rail and shim, with an interior
relief-and-bore machining block followed by a later finishing cut. It copies
the two cuts onto the backing rail and adapts a shallow relief on the shim in
one undo frame. Tests cover bad second-target rejection without partial
mutation, stable IDs, differing blind depths, source-tail preservation, undo,
redo, archive replay, selective guard extrusion revision, shared SKETCH
dependency invalidation and explicit unrelated-body preservation.

**Provider truth:** these are genuine persisted MODEL/SKETCH/RUNTIME semantic
operations. Neither this contract nor an unrelated experimental OCP job proves
these new cuts physically intersect the selected bodies or generate a valid
OCCT8 Boolean/STEP. Independent non-OCCT readback and a real browser click
flow remain Integration/WORKBENCH product qualification under #74.
