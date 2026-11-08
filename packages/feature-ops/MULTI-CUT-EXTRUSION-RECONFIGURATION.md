# Retrospective multi-cut base extrusion reconfiguration (v1 extension)

**Public API:** `@intuit3d/feature-ops/extrusion-reconfiguration/v1`

This extends the accepted `reconfigureProfileExtrusion(history, request, services)`
operation. Its original request envelope and legacy single-cut receipt remain
compatible. The operation can now change the **base SKETCH profile and extrusion
depth of an existing machined body with 2–16 ordered cuts**, keeping the
original body ID, every cut ID, cut source, cut extent and execution order.
That enables an already authored multi-pocket machine guard, mounting rail or
enclosure to acquire a different outer outline **without deleting and recreating
its machining recipe**.

## End-user gesture and RUNTIME/WORKBENCH handoff

Select an existing body that contains one extrusion followed by 2–16
dependency-ordered cuts. Choose **Edit base profile / depth**, pick an
existing, uniquely solved SKETCH cycle and positive millimetre extrusion
depth. The operation is **not** a mesh drag, face index replacement or
transformation of cut locations.

Pass the ordinary v1 `ExtrusionReconfigurationRequest`:
- `format=EXTRUSION_RECONFIG_FORMAT`, `version=1`, `units='mm'`,
  `frame='local_xy'`, fresh `eventId`, `expectedRevision`;
- explicit `extrudeFeatureId` and `outputBodyId`;
- `from: {sourceSketchId,depthMm}` from the selected authored extrusion;
- `to: {sourceSketchId,profileCandidateId,depthMm}` from current SKETCH
  profile discovery.

Supply `services={model,sketch,discovery,runtime,cutChain}`. The additional
accepted `@intuit3d/model/body-cut-chain` inspector is required only when
the target has **multiple cuts**; it verifies one unique, source-matched
dependency terminal, not a chronological guess. As before, MODEL/RUNTIME own
the actual journal and rebuild. The caller must replace its session history
with `result.history` once, consume `result.invalidation`, display the
ordered affected cuts and do **not** make an extra browser-side commit.

The receipt extends v1 with `orderedCutFeatureIds` (dependency order),
`reboundCutIds` and `cutDependencyChanges` (before/after edges). Legacy
`reboundCutId` and `cutDependencies` continue to work for one cut.
The new operation makes **one undo frame**, whether one or more cut SKETCH
dependencies require repair. Undo/redo and save/reopen are RUNTIME-owned.

## Invariants and refusal behavior

The edit rejects stale revisions, wrong original body/source/depth, missing
or ambiguous target SKETCH profile, unsupported foreign writers, a cyclic or
forked cut chain, missing independent cut source SKETCHes, unbound INTENT
inspection, invalid mm/frame, or an edit which leaves the selection unchanged.
Every cut's predecessor, body target, profile, thickness/through-all intent and
semantic identity remain unchanged.

An old first-cut dependency may have inherited its SKETCH from the original
extrusion. When switching the base source, the operation explicitly retains
that first cut's original source SKETCH edge. Conversely, when the first cut
uses the new base SKETCH, the duplicate edge can be removed. Later cuts
retain explicit SKETCH edges to preserve dependency provenance through
reordering and retrospective edits. All events commit **atomically** via one
RUNTIME transaction after SKETCH and INTENT checks; no partially edited body.

## Runnable production-consumer fixture

```sh
node --experimental-strip-types packages/feature-ops/examples/multi-cut-extrusion-reconfiguration.mjs
node --experimental-strip-types --test packages/feature-ops/test/multi-cut-extrusion-reconfiguration.integration.test.mjs
npm test --workspace @intuit3d/feature-ops
npm run check:workspace
```

The example authors an L-shaped guard, a separate backing rail and an
independent shim, then adds a blind relief and through vent to the guard.
It revises the guard base sketch and depth **10→14 mm**, preserving cut
identities, independent SKETCH references and extents; it checks rejected
selections, selective invalidation, one undo frame, undo/redo and durable
archive replay. The regression additionally exercises a legacy inherited
SKETCH edge and rejects noncommuting/forked target chains.

**Evidence boundary:** MODEL and SKETCH are authoritative for authored
intent and analytic profiles; extrusion remains `preview_only`, cuts
`pending_exact_provider` or `blocked_dependency`. This does not execute
a pinned OCCT8 C++ Boolean, reconstruct true physical solids, produce or
independently read STEP, establish Windows Firefox graphical interaction or
satisfy product #74. Integration must qualify exact HEAD and admit the
change; WORKBENCH can consume this existing published API without a new
unregistered package.
