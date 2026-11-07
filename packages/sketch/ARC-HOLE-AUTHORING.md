# SKETCH — interactive analytic arc-profile hole authoring v1

`@intuit3d/sketch/arc-hole-authoring/v1` provides a **real typed edit API** for
round-corner line/arc plates already solved through `arc-constraints/v1`.
A consumer can add a circular through-hole, move its separately dimensioned
centre, change its diameter and remove it. The module does not create another
document or history authority; the authoritative SKETCH document remains
unchanged until INTENT/RUNTIME commits the returned immutable candidate.

Call `createArcHoleSelection` once with stable `profileId`, the authored ordered
`boundaryIds` and selected `holeIds`. The selection is separate from and
serialized alongside the authoritative sketch in the consuming feature.
`inspectArcHoleControls` returns semantic IDs, millimetre coordinates and
whether the centre can be edited without replacing other dependencies.
`editArcProfileHole(sketch, selection, edit, {sourceSignature,
selectionSignature})` refuses stale browser gestures and colliding IDs. On an
accepted edit, it re-runs the actual nonlinear solver and complete analytic
profile validator; no failed placement, overlap or dimensional contradiction
is silently repaired, clamped or committed. A removable bad hole can be deleted
to recover a previously invalid profile. Existing constraints and curve IDs
survive the operation, and width edits need no rebuilding of the circle IDs.

The caller remains responsible for INTENT journal undo/redo and archive of both
the sketch and the selection; this API deliberately does not duplicate them.

Execute `node packages/sketch/examples/arc-hole-authoring.mjs`.
Test with `node --test packages/sketch/test/arc-hole-authoring.test.mjs` and
`npm run typecheck --workspace @intuit3d/sketch`.

**Qualification boundary:** `providerSubmissionReady` is an analytic 2D
profile check only. It is not production B-rep, pinned OCCT 8.0.1, STEP or
independent CAD reader evidence. Workflow Runtime and Workbench must wire this
additive v1 API and submit it to actual qualified native geometry separately.
