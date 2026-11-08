# Machined family base reconfiguration — v1

Public API: @intuit3d/feature-ops/machined-family-base/v1

Exports: inspectMachinedFamilyBase(history, request, services) and
applyMachinedFamilyBase(history, request, services).

## User-facing operation

Select two to eight existing machined bodies, including their explicit
source extrusion and dependency-ordered pockets. Select a new uniquely
solved SKETCH contour and positive depth in millimetres for each body.
Apply to selected bodies **once**. The feature composes accepted
extrusion-reconfiguration/v1 on disposable histories, validates every
SKETCH candidate and MODEL cut chain, and commits all events as **one
RUNTIME transaction and one undo frame**. Failure on the final body
leaves earlier selected bodies entirely unchanged.

The versioned request contains format FAMILY_BASE_FORMAT, version 1,
expectedProjectId, expectedRevision, expectedDocumentFence
(model.serializeProject(history.document)), units "mm", frame "local_xy"
and edits[]. Each edit is the accepted single-body request without its
outer envelope: eventId, extrudeFeatureId, outputBodyId,
from {sourceSketchId, depthMm}, and
to {sourceSketchId, profileCandidateId, depthMm}.
Use the existing @intuit3d/model/body-cut-chain inspector in services
for bodies with multiple cuts. Revisions, project, archive fence and
semantic IDs must all match the accepted source.

A read-only inspect performs validation on discarded histories, returning
selected body IDs, cut order, new dimensions and proposed event IDs. Apply
returns a canonical-history receipt and invalidation plus a single undo frame,
ordered cut IDs, rebind evidence, feature statuses and event IDs. WORKBENCH
should replace its session history **exactly once**, show edited body and
cut statuses, and save through the existing RUNTIME archive flow. No
second browser-side journal commit, inferred placement, mating condition
or transform is authorized.

Inadmissible or ambiguous profiles, source/depth mismatch, unknown/foreign
body writers, malformed or forked cut chains, duplicate target identities,
stale sources and no-op edits refuse before touching the caller's history.
Existing cuts retain semantic identities, source SKETCH, extent, target
body and predecessor order. Legacy implicit first-cut source inheritance
is explicitly rebound when changing the base profile.

## Runnable mechanical assembly

Run in an accepted INTUIT3D workspace:

    node --experimental-strip-types packages/feature-ops/examples/machined-family-base.mjs
    node --experimental-strip-types --test packages/feature-ops/test/machined-family-base.integration.test.mjs
    npm test --workspace @intuit3d/feature-ops
    npm run check:workspace

The fixture includes a multi-pocket L-shaped guard, a separately machined
backing rail with its own two ordered cuts, and an independent shim. One
transaction changes guard thickness 10 to 14 mm and backing rail 5 to
8 mm, each selecting a different admitted replacement profile. Four cuts
remain ordered and identified, independent shim remains unchanged.
Negative selections, one-transaction undo/redo, archive reopen, a later
14 to 16 mm revision and legacy source edge rebind are exercised.

## Truth and admission

Only MODEL/SKETCH semantic and analytic proof plus RUNTIME preview/pending
are established by this API. This operation does not execute pinned C++
Booleans, produce physical STEP bytes or demonstrate independent STEP
readback or graphical Windows/Firefox acceptance. Product #74 is a separate
end-to-end gate. Integration owns source-matched hosted CI, independent
review and guarded merge; no self-merge.
