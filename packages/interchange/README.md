# @intuit3d/interchange — runnable DXF sketch interchange v1

**Owner:** INTERCHANGE #134. Pure ESM/TypeScript declarations, no network, CAD engine or new solver. Runs against the existing `packages/sketch/**` provider. All code/test/example/fixture files are owned by `packages/interchange/**` only.

## First working feature

Read real ASCII AutoCAD R2000+ model-space drawings with **explicit** header `$INSUNITS` 4 (millimetres) or 1 (inches). Supported: planar LINE, CIRCLE, ARC and *closed* LWPOLYLINE (including minor circular-arc bulges), with source handles, named layers and analytic circles/arcs. Internally all positions and radii are millimetres. Export a stable standalone ASCII R2000 DXF with a LAYER table and preserved source units (or requested mm/in override); a polyline may be emitted as individual connected analytic LINE/ARC entities.

```sh
node --test packages/interchange/test/*.test.mjs
node packages/interchange/examples/roundtrip.mjs /tmp/intuit3d-edited-plate.dxf
# Once root workspace lockfile registration has been accepted by INTEGRATION:
npm test --workspace @intuit3d/interchange
npm run typecheck --workspace @intuit3d/interchange
```

`importAsciiDxf(raw)` -> normalized `DxfSketch` -> `toLinearSketch(dxf)` or `toArcSketch(dxf)` -> use existing SKETCH `editConstraint`/`editArcConstraint` and `solveSketch`/`solveArcSketch` -> `exportSolvedSketch(admitted, editedDocument, solution)` -> `exportAsciiDxf(...)`. `sketchImportPreview` returns the actual solver result with explicit non-authoritative flags. The `provenance` map lets the Workbench show imported DXF layers, entity IDs and source handles, while the public `document` supplies actual editable sketch entities.

The linear importer uses the existing SKETCH **fixed-point and radius constraints** to make every DXF coordinate deterministically editable through existing APIs. It does not invent parameter names or dimension relationships; users can replace constraints with their chosen dimensional/relational intent. A rectangular plate example edits two right-side fixed points, plus one circle radius, and reexports from the actual solved SKETCH geometry. The arc adapter uses actual `@intuit3d/sketch/arc-constraints/v1` points and arcs, not faceted substitutes; arcSketch is a preview, not exact B-rep.

## Explicit limitations / product admission

This is a bounded file-exchange subset, **not** general DXF conformance or independent external-CAD certification. No INSERT/BLOCKS, SPLINE, ELLIPSE, HATCH, XLINE, 3D polyline, paper-space geometry, custom object transforms, extrusion, wide polylines, arbitrary OCS or major bulge arcs. Unsupported material entities and nonplanar input reject rather than disappear; unknown non-geometric HEADER/TABLES records are ignored. No automatic entity welding by an approximate tolerance: shared linear vertices require exactly matching DXF coordinates. Imported arcs use trigonometry (with exact cardinal-angle handling); general CAD topology equivalence and rounding near coincident endpoints require separate explicit user admission. No derived sketch preview is an authoritative INTENT journal event, physical B-rep, STEP, or verified manufacturing geometry.

## INTEGRATION / WORKBENCH handoff

The add-on is located entirely in `packages/interchange/**`; register `@intuit3d/interchange` in the root package-lock/workspace checker/CI under INTEGRATION. Consume the new `sketchImportPreview(importAsciiDxf(text), {arcs:false})` result in a browser `File` open handler; show layer/provenance and precise failure reason; commit the returned *SKETCH document* through an explicitly approved INTENT command only after user confirms a target sketch. On export, select the current corresponding SKETCH result, require `status:'solved'`, run `exportSolvedSketch` and download `exportAsciiDxf` as a local file. Retain all explicit pending/ambiguous state. The WORKBENCH owner, not this worker, owns actual browser interaction and end-to-end screenshots; Integration owns guarded merge and root changes. A browser workflow and independent external CAD round-trip have **not** been executed in this lane.
