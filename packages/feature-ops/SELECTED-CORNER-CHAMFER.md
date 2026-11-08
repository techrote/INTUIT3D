# Selected corner chamfer — live mechanical FeatureOps v1

**Public command:** `@intuit3d/feature-ops/selected-corner-chamfer/v1`.

One named convex, perpendicular, axis-constrained corner of a *persisted* SKETCH-driven
extrusion is chamfered by two independently editable signed setbacks, without
manufacturing a mesh, guessing the target body or replacing original edge IDs.
This is the actual accepted SKETCH `selected-corner-chamfer/v1` service, not
a duplicate chamfer solver or a native B-rep chamfer.

- `authorSelectedCornerChamfer(history,request,services)` adds one genuine bevel
  line to the selected analytic contour. The user supplies `cornerPointId`,
  `incomingMm`, `outgoingMm` and unique `chamferId`.
- `editSelectedCornerChamfer` retrospectively changes both dimensions.
- `dragSelectedCornerChamfer` commits one SKETCH-projected grip gesture.
  Pointer target and projection deviation are returned; no silent 3D snap.
- Every request is project/revision fenced and names source SKETCH, extrusion,
  target body, **all current same-body cut IDs** and a genuine discovered SKETCH
  profile candidate with its exact source signature. A stale selection,
  independently edited profile, missing/aliased body, unexpectedly added cut,
  unsupported corner, no-op or invalid setback is refused before any history
  mutation. The original model feature IDs and persistent chamfer entity IDs
  remain stable, including after undo, archive and another body edit.
- SKETCH's successor sketch **and** successor selected-profile token commit as
  one INTENT `feature.edit` event and one RUNTIME undo frame. The resulting
  dependency invalidation includes the selected extrusion and all named
  downstream cuts, never the independent brace.

## Live consumer

```sh
npm ci
node --experimental-strip-types packages/feature-ops/examples/chamfered-instrument-cover.mjs
npm test --workspace @intuit3d/feature-ops
npm run ci
```

The runnable instrument cover has four fixed clearance holes and two **asymmetric
top-corner chamfers**. It creates both, retrospectively changes the first pair
of setbacks, projects a drag on the second, undo/redoes, reopens the archive,
then changes extrusion depth from 8 to 13 mm. An independently authored
perforated support brace retains its body, hole, cut, thickness and SKETCH.
The tests also exercise negative/stale/aliased selections and downstream
invalidation through the real INTENT/SKETCH/RUNTIME consumer.

## Workbench / Runtime / Integration handoff

WORKBENCH can display selected contour corners and two numeric setback controls
plus incoming/outgoing direct grips. Supply the full semantic selection and
current source revision, preview the fail-closed refusal, and visually distinguish
the altered *analytic* body from exact B-rep geometry. RUNTIME remains the only
history/rebuild/undo authority and receives no package change. INTEGRATION
owns independent exact-head Windows/Ubuntu CI, merge and any shared registration.

**Provider status:** `analytic_profile_only` SKETCH;
`preview_only` extrusion; `pending_exact_provider` target cut. The
`rebuild_selected_profile_body` return is merely a typed handoff, not
executed pinned C++ geometry. `exactAuthority:false` and
`independentInteroperability:false` remain explicit. No source-matched native
Boolean chamfer, production OCCT8 STEP, independent CAD readback, browser
gesture or human user acceptance is asserted by this feature.
