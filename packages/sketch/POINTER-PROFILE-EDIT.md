# SKETCH pointer-to-semantic handle editing v1

**ESM/TypeScript:** `@intuit3d/sketch/pointer-profile-edit/v1`.

## Real user journey

1. WORKBENCH converts a 2D pointer to sketch-local millimetres, calls `selectContourAtPointer` on the current **authoritative sketch**, and keeps the returned source-fenced contour selection.
2. `inspectPointerEditableHandles(sketch, selection)` returns only genuine, solver-authored dimension handles and atomic XY hole-center handles for the selected contour.
3. `pickProfileHandleAtPointer(sketch, selection, {kind:'pick-profile-handle', version:1, sourceSignature, point, maxDistanceMm, filter})` returns a semantic handle ID. Its explicit mm hit radius is supplied by WORKBENCH. Coincident handles result in `ambiguous` with choices; the client must display them for explicit selection or use a declared dimension/hole-center editing mode.
4. `dragProfileHandleAtPointer(sketch, selection, {kind:'drag-profile-handle', version:1, sourceSignature, handleId, target})` delegates the edit to established exact authored-linear solver/selected-profile admission. Only `accepted` yields a successor sketch and successor selection; other results carry refusal and diagnostics.
5. RUNTIME must commit the accepted `sketch` and `selection` in **one revision-fenced, undoable transaction**; it must never write the transient pointer pick as an authoritative CAD edit. WORKBENCH renders applied position and deviation feedback, not merely the requested pointer.

**Executed example:** `node packages/sketch/examples/pointer-profile-edit.mjs`. It selects an L contour by click, picks its authentic length dimension by position, drags to 150 mm, saves/reopens and resolves an intentionally ambiguous hole-centre overlay explicitly.

## Constraints and integration boundary

- New module does **not** create a new solver or modify constraints outside the existing dimension/XY atomic editors. Fully solved selected contour required; conflict, stale source, missing handle, invalid pointers and geometry rejection are explicit. Other disjoint contours and circular holes remain reference-bound and unchanged except for selected geometry deliberately edited.
- No automatic closest-handle guessing: multiple handles inside a hit radius are ambiguous even when one is nearer. Caller can explicitly choose a listed semantic ID or filter with a mode declared to the user.
- Source signature is `serializeSketch(sketch)`, **not** the model's session revision. RUNTIME must also check its authoritative project/workflow revision before journal commit.
- This is **analytic sketch-only** (`nativeExact:false`). No C++ OCCT8 Boolean, same-revision STEP readback, Firefox/Windows UX or independent STEP qualification is asserted. Integration owns merge and cross-package wiring.
