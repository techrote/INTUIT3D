# @intuit3d/workflow-runtime — version 1 (experimental, no exact provider)

**Issue:** [RUNTIME-001 #49](https://github.com/techrote/INTUIT3D/issues/49). **Code owner:** RUNTIME; this package and its tests only. No changes to INTENT, SKETCH, KERNEL, WORKBENCH or shared integration source are authorized.

This is an **executable adapter over accepted public package modules**, not a second document model, solver, geometry engine, or viewport. Its `createWorkflowRuntime(services)` constructor receives the authentic module namespaces from `@intuit3d/model`, `@intuit3d/model/transactions`, `@intuit3d/model/dimension-bindings`, `@intuit3d/model/dimension-batch-edit`, `@intuit3d/model/archive`, `@intuit3d/sketch` and `@intuit3d/sketch/profile-discovery/v1` (see `test/runtime.integration.test.mjs`). Runtime inspection derives a revision-fenced dependency plan and scalar binding evaluation from the authoritative undo-history document. It never mutates the journal.

## Deliberately narrow v1 modelling contract

The project document is the sole authority. A feature with `kind: 'sketch'` supplies its versioned SKETCH document in `payload.sketch`. The runtime validates/solves it using SKETCH, discovers candidate profiles, and **replays** the sole admissible profile through SKETCH's admission function. The outcome is `analytic_profile_only` and cannot be exported as a B-rep.

A feature with `kind: 'extrude'` must explicitly depend on a sketch feature, name that source via `payload.sourceSketchId`, have positive finite `payload.thicknessMm` (including an INTENT-derived retrospective binding where applicable) and declare exactly one output semantic body in `writeTargets`. Such a feature can be **`preview_only`**, carrying the admitted analytic profile and thickness. Hole circles in the admitted profile are only **intended** holes, not a verified Boolean cut. No geometry provider is installed: `exactGeometryAvailable` is always `false`, and `kind:'cut'` is `pending_exact_provider` rather than a fabricated solid. Unsupported feature kinds are `intent_ready` for their semantic plan only; no geometric meaning is inferred.

`inspect(history)` preserves authored order independently from executable order. Unresolved/cyclic/unordered model dependencies, failed scalar bindings, contradictory/underconstrained sketches, ambiguous/crossing profiles, invalid extrudes and unsupported exact cuts stay explicit. There is **no fallback** to authored numeric values after a dimension-binding failure, and no last-good cache is persisted or promoted to authoritative data.

Commands `commit`, `editDimensions`, `undo` and `redo` delegate to the model's real journal/history APIs with their revision/atomicity checks. `save` and `reopen` delegate to the versioned model archive and contain no derived geometry; writing the serialized archive to disk still requires crash-atomic file replacement by its consumer.

## Tests and adoption

- `node --test test/runtime.unit.test.mjs`: dependency-free orchestration safety tests with clearly labelled service doubles. **Not CAD solver/native evidence.**
- `npm test`: both unit tests and `runtime.integration.test.mjs` against the actual installed workspace model and sketch public APIs; use Node >=22.6.0.
- `npm run typecheck`: package consumer contract, requires accepted workspace dependencies and TypeScript 5.8.3.

**INTEGRATION dependency:** adding this workspace to the root lockfile and exact-head Ubuntu/Windows CI is integration-owned. The RUNTIME branch intentionally does not edit `package-lock.json`, shared `tooling/**` or `.github/**`. Once the lockfile is reconciled, use `npm ci && npm run ci`, verify real integration fixtures, qualify the candidate and only then merge. **WORKBENCH dependency:** consume `@intuit3d/workflow-runtime` as a model-backed adapter in its own branch; preserve preview labels and do not infer exact geometry. **KERNEL dependency:** a future versioned/native exact provider must carry independent correctness/STEP evidence before any exact status can be added.

**v1 non-goals:** interactive browser wiring, physical STEP, asynchronous native cancellation/timeout, 3D topology lineage, arbitrary sketch features, physically exact holes, human acceptance. These remain tracked in #49 and must not be claimed as implemented by this package.
