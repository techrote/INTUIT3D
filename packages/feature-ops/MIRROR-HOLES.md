# FEATUREOPS hole-mirror/v1 — mirrored cut-hole authoring

This is a **one-shot**, non-associative mirror of 1–16 selected circular through-holes in an existing SKETCH already targeted by a named extrude/cut/body chain. It is not a new SKETCH solver, a boolean, an associative pattern feature, a mesh operation, or an exact native CAD provider.

Consumer import: `@intuit3d/feature-ops/hole-mirror/v1`. Call `mirrorProfileHoles(history, request, {runtime,model,sketch})` with a current expectedRevision, explicit `local_xy`/`mm`, sketch/extrude/cut/body IDs, a signed local mirror axis `{xMm,yMm,dx,dy}` and explicit `{sourceHoleId,outputHoleId}` pairs. Example: reflect a circle at (-60,30) across axis `{xMm:0,yMm:0,dx:1,dy:0}` to an independently editable circle (-60,-30), retaining the original.

The implementation reads the actual **solved SKETCH circle and centre** (not seed coordinates), calculates reflection, then delegates the complete additive edit to `runtime.editPlateHoles` with `require_admissible`. RUNTIME commits a single INTENT edit only if SKETCH admits the new cut profile; otherwise it returns a refused candidate without mutating the original history. It refuses stale revisions, ambiguous body lineage, occupied IDs, zero axes, coincident reflections, non-finite coordinates and over-capacity configurations. The original hole keeps its identity; new entities have stable explicit IDs and can subsequently be edited independently.

Real tests should exercise SKETCH -> INTENT/RUNTIME mirror -> invalidated extrude/cut -> undo/redo -> archive reopen, plus refusal for off-plate/overlapping reflections. The accepted experimental OCP plate provider may support compatible results after RUNTIME checks; this package **never** returns STEP, `validated_exact`, or a claim of independent interchange.

```sh
npm test --workspace @intuit3d/feature-ops
```

**Handoffs:** WORKBENCH may implement a mirror command with selected circle(s), axis and preview; RUNTIME remains the authority for application state and any native request; KERNEL controls the B-rep/STEP. INTEGRATION exclusively reviews, qualifies and merges this source. This API does not add a root workspace or new dependency.
