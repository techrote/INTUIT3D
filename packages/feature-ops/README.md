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

\`reconfigureMountingFlange(history, request, services)\` changes the *entire*
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

Run \`npm test --workspace @intuit3d/feature-ops\` for unit and **real**
INTENT/SKETCH/RUNTIME undo/archive fixtures; an independently managed native
STEP regression remains Integration-owned ([#90](https://github.com/techrote/INTUIT3D/pull/90)).
