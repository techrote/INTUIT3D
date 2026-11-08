# Selected-contour orthogonal edge-relative hole placement v1

**Consumer import:** `@intuit3d/sketch/selected-edge-hole-placement/v1`

`inspectSelectedEdgeHolePlacement(sketch, {candidateId,sourceSignature})`
returns the genuinely solved **selected** boundary edges, semantic start/end
point IDs, orthogonal dimensions and inward directions, plus every selected
circle's real X/Y/radius constraint IDs. Existing authored X/Y pairs relative
to a boundary edge's oriented start vertex are reconstructed as persistent
`edgeBinding: {edgeId,anchorPointId,alongMm,insetMm}`. No separate nonreplayable
metadata is needed. Sloped or unconstrained edges are visible but **not**
editable by this linear solver adapter; they are not silently projected.

A completed pointer drag or numeric inspector operation submits **one**
`setSelectedEdgeHoles(sketch,selection,{kind:'set-edge-holes',
sourceSignature,edits:[{holeId,edgeId,alongMm,insetMm,radiusMm}]})`.
An unknown `holeId` authors a new circular cutout with a stable semantic
centre and three real signed solver dimensions. An existing selected hole
keeps its IDs while both X/Y references are explicitly rebound to the named
boundary start point. The edge's winding defines inward as positive, and
its signed axis defines along. Geometry is checked **after all edits at once**,
so even cross-hole swaps do not commit transient overlapping shapes.

All edits enforce source revision, exact selected contour identity, actual
orthogonal edge constraint, finite dimensions, final solver convergence,
circle/boundary clearance, other holes and explicit coordinate/radius targets.
No edit may silently mutate an unselected contour's hole. A refusal supplies
no replacement sketch, with source status/diagnostics when available.
Accepted results include `changedConstraintIds`, `createdHoleIds`,
`reanchoredHoleIds`, `affectedHoleIds`, `edits`, replacement `sketch`,
and a fresh selected contour stamp for **one** INTENT/RUNTIME undoable event.

```sh
node --test packages/sketch/test/selected-edge-hole-placement.test.mjs
node packages/sketch/examples/selected-edge-hole-placement.mjs
npm run typecheck --workspace @intuit3d/sketch
npm test --workspace @intuit3d/sketch
```

**Consumer handoff:** WORKBENCH should use the returned `edges` to project
pointer coordinates into edge-local distances, render refused dimensions and
require explicit commit. RUNTIME must journal the full validated sketch
replacement with the selected `candidateId`, revision fence and unchanged
unselected contours; its ordinary single-auto-contour edit gate is not a
substitute. INTEGRATION owns cross-package wiring/guarded merge. A widening
L-bracket fixture shows actual persisted edge-relative geometry after save,
reopen and source-snapshot restoration; source snapshot restoration is **not**
a claim of working application journal undo.

**Authority:** analytic profile only (`previewOnly:true`,
`nativeExact:false`, `independentStepQualified:false`). No native B-rep,
physical slot/tangent arc, independent STEP, browser gesture or production
kernel qualification is implied. A future arc-backed selected-contour
slot/fillet adapter must use a genuine arc solver and a kernel provider.
