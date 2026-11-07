# Multi-body selected-profile authoring — FEATUREOPS body-set/v1

`@intuit3d/feature-ops/body-set/v1` creates **2–8 independent named bodies in one undoable authoritative INTENT transaction** from previously saved and SKETCH-admitted profiles. Each entry explicitly identifies `sourceSketchId`, canonical `profileCandidateId`, `extrudeFeatureId`, `outputBodyId`, positive `depthMm`, and unique authoring `eventId`. An entry may optionally specify a cut, with its own saved/selected cut sketch, `cutFeatureId` and `eventId`. Both explicit output-body identity and the cut's target-body chain are mandatory; no silently inferred solids or Boolean operations.

All source sketches are re-admitted against current SKETCH discovery and current RUNTIME report before any journal commit. The operation rejects stale revisions, unadmitted/ambiguous profiles, occupied or aliased semantic IDs, existing body writers, invalid depths, malformed requests, and duplicated event IDs. Each cut depends explicitly on its owning extrusion, and also on a distinct cut sketch when selected. All specified feature creates are committed in **one RUNTIME `commit()` call**, with one undo frame; unrelated bodies have no artificial dependency edges.

The result reports each extrusion as `preview_only` and each requested cut as `pending_exact_provider`. It returns a revision-fenced, expressly *unqualified* native handoff for cuts and `null` for preview-only extrusions; neither the multi-body API nor the demo executes any native Boolean or creates STEP. The current plate-only native adapter is **not** assumed to support all selected profiles or multiple bodies. Native implementation, actual STEP and external interoperability remain KERNEL/RUNTIME/INTEGRATION responsibilities, not a claim of this operation.

## Runnable cross-package workflow

```sh
npm test --workspace @intuit3d/feature-ops
node --experimental-strip-types packages/feature-ops/examples/multi-body-assembly.mjs
```

The real INTENT/SKETCH/RUNTIME fixture creates a six-corner L-bracket with separate explicit cut sketch **and a distinct rectangular spacer body** in one transaction; retrospectively edits bracket depth 8→14 mm; checks that the spacer is not structurally invalidated; validates undo/redo and archive reopening; and verifies the journal's exact cut-body/sketch dependency edges. Negative tests cover stale revisions, duplicate IDs, foreign profiles, incorrect frame, occupied body writer and repeated events. No fake CAD source of truth is added.

**Cross-lane handoff:** WORKBENCH can offer multi-select profile extrusion and an explicit per-body cut selection using this contract, with truthful preview/pending states and real Chromium tests in its own tree. RUNTIME can inspect and evaluate the single batch journal revision. KERNEL must supply general multi-body/extrusion/Boolean geometry before physical STEP is possible. INTEGRATION owns guarded merge/CI/workspace registration. This is not a cross-lane source change.
