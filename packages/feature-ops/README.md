# @intuit3d/feature-ops — executable authored mounting-flange operations v1

**Owner:** FEATUREOPS (#80), exclusive source `packages/feature-ops/**`.

This is a real authoring **consumer** of the accepted INTENT, SKETCH and RUNTIME boundaries, not another CAD source of truth. `authorMountingFlange` atomically constructs three standard INTENT features (`sketch`, `extrude`, `cut`) with arbitrary dimensions and **1–64 stable-ID named holes**. `mountingFlangeSketch` constructs fully constrained SKETCH geometry, calls SKETCH's genuine solver and admits only a unique analytic profile. Refuses overlapping/out-of-bounds holes via the SKETCH profile implementation, without reimplementing its contact predicates. `editExtrudeThickness` preserves identity and delegates revision-fenced undoable edits and rebuild invalidation to RUNTIME.

A four-hole 180×100×10 mm mounting flange is a different parameterized mechanical part from the original two-hole plate, with the same experimental native subset available *when* the runtime/kernel are appropriately configured. Explicit local-centred XY millimetres and source/target IDs are required. No silent target/body inference, geometry fabrication, standalone Boolean, export or native correctness claim.

## Tests / demo

```sh
npm test --workspace @intuit3d/feature-ops
node --experimental-strip-types packages/feature-ops/examples/four-hole-flange.mjs
```

The package's local unit test suite uses injection fakes to check command shape, invalidation wiring and fail-closed guards; the separate `test/live-contract.test.mjs` actually imports accepted INTENT/SKETCH/RUNTIME and validates the four-hole flange, thickness edit, invalidation, undo/redo and archive save/reopen. **A skipped real-consumer test is not a PASS**. Any actual native STEP must run via the existing trusted RUNTIME/Kernel host; this package returns an explicitly `experimental_plate_only` handoff instead of manufacturing STEP output.

## Integration-only prerequisite

The new workspace requires Integration to register the `FEATUREOPS` lane in `tooling/check-workspace.mjs`, to update the root lockfile for its dependencies and to coordinate exact-head Linux/Windows CI. Neither shared path is owned here. Until that happens **the PR remains DRAFT / not merge-ready**, regardless of isolated tests. Integration and WORKBENCH/RUNTIME should consume public `@intuit3d/feature-ops` v1 when qualified; no other worker's files are modified by this PR.


## Atomic layout-and-thickness reconfiguration

`reconfigureMountingFlange(history, request, services)` changes the *entire*
dimensioned rectangle, named circle layout and extrusion thickness in **one
undoable INTENT transaction**. This is not a one-shot array that requires
manual subsequent edits: the caller supplies the full new desired spec with
an explicit revision fence; existing named holes retain semantic identities,
new holes receive predictable IDs and omitted holes are explicitly removed.
The authoritative sketch, extrude, cut and body IDs remain unchanged.

All changes are validated through the accepted SKETCH solver/profile admission
and RUNTIME model evaluation. Ambiguous/overlapping/out-of-bounds profiles,
wrong cut-to-body lineage, third-party body writers, stale revisions and no-op
reconfigurations refuse before committing. The operation does not execute
native Booleans: it returns an **experimental-only** revision-fenced native
handoff for the existing RUNTIME/KERNEL bridge.

Run `npm test --workspace @intuit3d/feature-ops` for unit and **real**
INTENT/SKETCH/RUNTIME undo/archive fixtures; an independently managed native
STEP regression remains Integration-owned ([#90](https://github.com/techrote/INTUIT3D/pull/90)).


## Generalized profile extrusion / explicit body cut v1 — FEATUREOPS-002 #97

The additive `profile-solid` contract requires explicit `mm` units and a `local_xy` frame; it imports an **existing persisted SKETCH feature**
and an explicitly selected `cycle:...` semantic line-loop ID from
`@intuit3d/sketch/profile-discovery/v1`. It replays SKETCH's exact current
admission and RUNTIME's authoritative solved profile before committing any
model event. It does not infer which body, loop or cut target a user meant.

`authorProfileExtrusion(history, request, services)` creates a real
dependency-linked `extrude` feature for an arbitrary solved simple polygon
(with any admitted circular holes), positive millimetre depth and a named new
body. Its output is explicitly `preview_only`. The editable geometry is
authored in SKETCH; no tessellation or geometric predicates are duplicated.

`authorProfileBodyCut(history, request, services)` creates a real target-body
`cut` feature. Its selected cut sketch can be the extrusion's sketch or a
distinct existing sketch; the latter retains both dependency edges. In either
case the exact Boolean remains `pending_exact_provider`. The returned
`nativeHandoff` is an **unverified RUNTIME request**, NOT a native result or
proof of support. The current experimental plate worker supports a stricter
rectangle-with-circular-holes subset, and correctly refuses other polygons.

Concrete runnable example and live regression:

```sh
node --experimental-strip-types packages/feature-ops/examples/l-profile-solid.mjs
npm test --workspace @intuit3d/feature-ops
```

These perform real SKETCH/INTENT/RUNTIME authoring of a six-corner L-shaped
bracket with a clearance hole, cut intent, retrospective 8→14 mm extrusion
edit, transitive dependency invalidation, undo/redo and archive replay.
The L-shape is intentionally rejected by the experimental plate-only native
adapter. Tests also demonstrate a general pre-authored rectangular sketch
that the accepted RUNTIME plate adapter **can map as a request**, and a
different sketch for the explicit cut. Neither case claims a real new
native C++ geometry operation or independent STEP interchange.

**Consumer handoff:** WORKBENCH can offer a profile selector and new-body/
target-body controls using these two commands; RUNTIME remains responsible
for evaluating current revisions, native provider compatibility and status.
The browser UI and real Chromium interaction are WORKBENCH/INTEGRATION-owned
and are not qualified by these package tests. Additional generalized B-rep
operations require KERNEL support and explicit Integration acceptance.
