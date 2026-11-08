# Body-owned selected profile dimensions v1

**Public import:** @intuit3d/feature-ops/body-profile-dimensions/v1

This is a **body-aware Apply action** for already accepted, solver-authored SKETCH dimensions. A user selects a persisted linear contour, a real extrusion/body and its semantic dimensions, reviews all potentially affected downstream features, then updates several dimensions or drags a named dimension handle. The command commits **one** authoritative RUNTIME sketch edit/undo frame, preserving the original feature, body, hole, constraint and cut identities.

The existing SKETCH selected-profile-dimensions/v1 owns geometric validation, conflict diagnosis and handle projection. FEATUREOPS does not reproduce a solver. INTENT/RUNTIME own the project journal, revision, dependency invalidation, undo/redo, archive and provider states.

## Consumer contract

1. **Inspect:** inspectSelectedBodyProfileDimensions(history, selection, services) takes the versioned format, explicit mm/local_xy, project/revision, source SKETCH ID, extrude ID, body ID and **persisted canonical profile selection**. It returns editable dimension rows (constraintId, solver value and semantic handle), and complete transitive affectedFeatureIds including cuts and other bodies sharing that sketch.
2. **Batch edit:** editSelectedBodyProfileDimensions(history, request, services) applies **1–16 dimensions** together using changes with constraintId, expectedValueMm and valueMm. Expected values, exact affected set, sketch signature, revision and body writer are rechecked before mutation.
3. **Direct drag:** dragSelectedBodyProfileDimension(history, request, services) applies one actual constraint handle gesture. gesture.applied and projectionDeviationMm expose off-axis projection without inventing visual geometry.

**RUNTIME/WORKBENCH wiring:** import the v1 subpath and inject actual runtime, model, sketch, discovery and profileDimensions namespaces. Render dimensions and affected-feature list in a selected-body inspector. Apply or pointer release sends a fresh request. Re-inspect after every commit; source signatures and affected dependency sets are per revision. Display preview_only, pending_exact_provider and blocked_dependency from the actual RUNTIME report; never label the edited solid native-exact.

The API refuses wrong body, mismatched extrusion lineage, old revision or selected SKETCH signature, stale dependency set, unselected constraint, no-op, contradictory/unsolved dimensions, invalid radius, unsupported drag and unauthorized geometry before issuing any journal event. SKETCH provides conflict reasoning; this bridge currently throws a refusal message.

## Executable mechanical fixture

Run from the registered workspace with Node 22:

    node --experimental-strip-types packages/feature-ops/examples/motor-sensor-profile-revision.mjs
    node --experimental-strip-types --test packages/feature-ops/test/body-profile-dimensions.integration.test.mjs
    npm test --workspace @intuit3d/feature-ops

The fixture creates a real solved 120-mm L-web motor/sensor mount with two durable circular clearance holes, an independently targeted wiring-relief cut and a separate shim. One retrospective action changes length **120→144 mm**, flange height **30→36 mm** and clearance radius **5→6 mm**; one semantic drag adjusts the radius to **7 mm**. It checks dependent invalidation, stable identities, undo/redo, archive reopening and a later extrusion depth change **9→13 mm**. The independent shim remains 3 mm.

**Geometry provenance:** SKETCH analytic geometry is solved and admitted; the extrusion remains preview-only and the cut pending exact provider. No native Boolean, pinned OCCT 8.0.1 STEP, independent CAD readback or human browser acceptance is claimed. Integration owns source-matched CI and guarded merge. WORKBENCH owns actual controls and interaction acceptance.
