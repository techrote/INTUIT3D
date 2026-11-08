# Rectangular hole-grid placement v1

`@intuit3d/feature-ops/rectangular-grid-placement/v1` exports `placeRectangularHoleGrid(history, request, services)`.

This operation *retrospectively* rotates and/or translates all holes in a previously authored, explicitly named rectangular grid, including its source hole, in **one revision-fenced RUNTIME transaction**. It does not create an associative CAD pattern or generate an actual Boolean/STEP solid.

The request supplies the exact project/revision, sketch/extrusion/cut/body identities, `mm/local_xy` frame, original source hole, ID prefix and 2–32-cell row/column counts. `stepX` and `stepY` are **current solved basis vectors** in mm, not guessed zero-rotation pitches. This allows moving an already rotated array again without assuming it is axis aligned. Include an explicit rotation pivot and signed rotation in degrees plus translation in mm.

Before mutation, FEATUREOPS validates the existing complete named grid against SKETCH's solved centers and radii, rejects a missing or independently altered copy, rejects ambiguous body writers and stale requests, and checks that RUNTIME's selected features are admitted. It invokes **only** `runtime.transformPlateHoles` with `admission: 'require_admissible'`; RUNTIME applies and admits geometry changes and owns the undoable journal. After a commit, FEATUREOPS verifies solved positions, unchanged hole IDs and downstream invalidation. Refusal returns `kind: 'refused'` without a new history.

The `EPS_MM=1e-6` comparisons are narrow **authored-pattern provenance assertions**, not tolerance adjustments to a native solver or physical Boolean. Unsupported exact geometry remains `pending_exact_provider` with `exactAuthority:false`.

## Executable consumer

```sh
npm test --workspace @intuit3d/feature-ops
node --experimental-strip-types packages/feature-ops/examples/fixture-grid-placement.mjs
```

The fixture creates a **160 × 100 × 8 mm** plate, a 4 × 3 hole grid and a separate 5 mm spacer; rotates the grid +10° and translates it (+2, −1) mm, undoes/redoes the command, then **places the already rotated grid again** by −4° and (−1, +0.5) mm using solved rotated row/column basis vectors; independently undoes/redoes that second command, changes plate thickness to 12 mm and saves/reopens through accepted INTENT/SKETCH/RUNTIME APIs. The consumer checks actual solved coordinates and independent-body noninvalidation. The new grid has no native B-rep/STEP evidence; production pinned OCCT8 and independent external CAD readback require separate qualified integration.

**WORKBENCH:** pass selected grid source ID/prefix, rows/columns, current solved row/column vectors, pivot, rotation and translation with captured project/revision and named target cut/body. Display `pending_exact_provider` or refusal; do not present the preview as physically validated.

**INTEGRATION:** admit the package subpath, qualify exact-head Ubuntu/Windows Node tests and static types, reconcile against main and merge only after independent acceptance. **RUNTIME/KERNEL:** retain native Boolean and STEP authority. No shared files are edited by this package.
