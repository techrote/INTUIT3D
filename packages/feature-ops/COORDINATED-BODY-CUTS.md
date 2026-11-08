# Coordinated selected-profile pockets across multiple named bodies — v1

**FeatureOps source only.** One user action creates **2–8 independently ordered cuts** from one already admitted canonical SKETCH profile into distinct explicitly selected bodies. Useful for a guard + backing rail or separately authored fixture plates sharing the same local XY sketch. This is **not** assembly mating/registration, cross-body Boolean, exact STEP, native drill penetration, or a persistent derived-pattern feature.

## Consumer contract

Public subpath: @intuit3d/feature-ops/coordinated-body-cuts/v1

- authorCoordinatedBodyCuts(history, request, services) takes format = intuit3d.feature-ops.coordinated-body-cuts, version = 1, expectedProjectId, expectedRevision, units = mm, frame = local_xy, sourceSketchId, canonical profileCandidateId and 2–8 entries with cutFeatureId, targetBodyId, afterBodyWriterId, eventId and extent. Each extent is through_all or blind plus positive depthMm. Every target is an existing distinct body with a uniquely ready terminal writer; no body/source inferred. Every INTENT preview is checked before a **single RUNTIME commit/undo frame**.
- reconfigureCoordinatedBodyCutExtents(...) accepts the same header and entries with cutFeatureId, targetBodyId, afterBodyWriterId, eventId, fromExtent and toExtent. It verifies each original extent/profile/dependency/body and obtains an accepted previewBodyCutExtentEdit for **all** targets before one batch commit. Stable cut/body IDs and dependency order. An invalid second target refuses before editing the first.
- Both return per-body cut, extent, current pending_exact_provider or blocked_dependency status, RUNTIME invalidation, history and non-exact runtime_evaluation_required handoff. They reuse accepted INTENT body-cut-chain, SKETCH solver/discovery and workflow RUNTIME.

WORKBENCH can present a "Pocket selected profile into selected bodies" command, one body-terminal selector per target, distinct through/blind extent per body, and a grouped retrospective change. The caller passes a fenced current selection; it must not infer a source-plane-to-target transform or promise physical penetration. RUNTIME remains journal/status authority. KERNEL/PLATFORM/INTEGRATION own native, independent STEP and graphical acceptance.

## Runnable mechanical proof

    npm ci
    node --experimental-strip-types packages/feature-ops/examples/coordinated-pockets.mjs
    npm test --workspace @intuit3d/feature-ops
    npm run ci

The example constructs an **L-guard (10 mm)**, **backing rail (5 mm)** and separate **shim (3 mm)** through accepted SKETCH and BODY-SET. It cuts guard/backer in one transaction using a common 16×8 mm selected rectangular relief: blind 3 mm on guard, through-all on backer. It retrospectively edits both extents (through-all/2 mm), undoes/redoes the grouped change, saves/reopens, changes the guard extrusion to 14 mm, and edits the common relief SKETCH. Both dependent cuts invalidate on shared sketch edit; shim unchanged. Negative tests cover stale selections, incorrect terminals, duplicate event/feature/target IDs, inadmissible profiles/extents, replay, dependency-sensitive invalidation and preflight atomic refusal.

**Qualification limits:** SKETCH and model admission do not establish physical cut solids. This package returns no STEP and asserts no source-matched OCCT8 execution, independent Boolean equivalence, physical assembly placement, WORKBENCH graphical acceptance or external CAD readback. Those remain Integration #74/production consumer obligations.

**Admission handoff:** Integrator independently runs exact-head Ubuntu/Windows FeatureOps tests, workspace CI and inspects scope limited to packages/feature-ops/** before guarded merge. Development base is main 09fd567c16163e9104532dca19eb0b3102d1fad5. Founding #80 and follow-on #97 are closed; do not reopen.
