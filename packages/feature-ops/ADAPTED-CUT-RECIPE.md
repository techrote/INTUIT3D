# Adapted cut recipe v1 — reusable mechanical machining with independent profiles

Public API: `@intuit3d/feature-ops/adapted-cut-recipe/v1`,
`inspectAdaptableCutRecipe` and `applyAdaptedCutRecipe`.
Unlike shared-source `cut-recipe-copy/v1`, this operation transfers the last
2–8 ordered cuts from one explicitly chosen body to another, substituting an
**explicitly selected SKETCH profile and blind/through extent for each cut**.
It creates new stable cut IDs, never alters source cuts, never clones sketches,
and never guesses profile geometry or coordinate transforms.

### Browser and RUNTIME contract

1. Select source 2–8 ordered terminal cuts, a different target body and its
   unique terminal writer. Call `inspectAdaptableCutRecipe(history,selection,services)`.
   Supply `format:ADAPTED_RECIPE_FORMAT,version:1,expectedProjectId,
   expectedRevision,expectedDocumentFence:model.serializeProject(history.document),
   units:'mm',frame:'local_xy',sourceBodyId,targetBodyId,sourceCutFeatureIds,
   targetAfterBodyWriterId`.
2. Show source order, original profiles/extents and a **per-cut** target
   SKETCH/profile selector and blind depth/through-all selector.
3. On **Adapt machining recipe → Apply**, retain that same selection, add
   `expectedSourceCuts` from inspection and matching ordered
   `targetCuts:[{sourceCutFeatureId,sourceSketchId,profileCandidateId,extent}]`,
   `newCutFeatureIds` and `eventIds` (fresh, one per cut).
4. Commit by calling `applyAdaptedCutRecipe` exactly once. Replace the
   authoritative session history with `result.history`, propagate
   `result.invalidation`, display `copiedCuts` statuses and the provider
   `nativeHandoff`. No duplicate browser-side transaction.

All selected sketches must be authoritatively admitted by SKETCH/RUNTIME.
Canonical project/revision, source writer lineage, target terminal, exact cut
order, target profiles, extent and new identities are checked. Successive
INTENT append previews run on a disposable history before the full batch is
committed in one RUNTIME undo frame. Invalid *second* cuts cannot partially
persist the first. An unchanged recipe must use existing shared-source copy.

### Executable mechanical acceptance

```sh
node --experimental-strip-types packages/feature-ops/examples/adapted-cut-recipe.mjs
node --experimental-strip-types --test packages/feature-ops/test/adapted-cut-recipe.integration.test.mjs
npm test --workspace @intuit3d/feature-ops
npm run check:workspace
```

The fixture builds an L-shaped machine guard, backing rail and independent shim,
copies relief/vent operations to separately authored target sketches and
different blind dimensions, tests 16 rejected selections, single undo frame,
undo/redo, archive replay, a 10→14 mm guard depth edit and dependency-sensitive
invalidation. The target sketch is independent from its source counterpart.

**Provider truth:** these are semantic/analytic pending operations, not
pinned-C++ exact solids, physical intersection tests, STEP, external CAD
readback or Firefox acceptance. #74 remains the cross-lane product gate.
