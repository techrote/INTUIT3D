# `@intuit3d/model` — intent-first semantic document v1

Dependency-free TypeScript package for authoritative CAD feature intent and derived evaluation planning. This is **not** a geometry solver or B-rep provider.

## Contract

- `newProject(projectId)` creates a versioned `intuit3d.project` document.
- `commitEvent(document, event, expectedRevision?)` appends a validated command with revision fencing; does not mutate the input.
- `serializeProject(document)` and `deserializeProject(json)` preserve intent and deterministic replay, rejecting unknown versions or inconsistent histories.
- `featuresOf(document)` replays the journal, retaining stable IDs, original authored order and recoverable deletion/restore history.
- `planProject(document)` reports a stable execution order **only for admissible features**. Missing future references remain `pending`, cycles and unordered writes become `conflicted`, their descendants become `blocked`. Unrelated valid subgraphs continue.

Each feature has `id`, `kind`, `dependsOn`, `writeTargets` (semantic mutable resource IDs, not B-rep names) and JSON `payload`. Two writes to the same resource must be ordered by an explicit dependency path: chronological authoring order is **not** automatically semantics. Feature IDs cannot be reused after removal; `feature.restore` preserves identity.

The plan is derived; persist **only** the journal. No kernel face IDs, solver results, render meshes or last-good geometry can be declared authoritative through this API. Last-known-valid geometry and semantic topology lineage require later versioned contracts, not an implicit fallback here.

## Example

```ts
import {newProject, commitEvent, planProject} from '@intuit3d/model';
let project = newProject('project.example');
project = commitEvent(project, {
  eventId: 'event.cut', type: 'feature.create',
  feature: {id: 'feature.cut', kind: 'cut', dependsOn: ['feature.plate'],
            writeTargets: ['body.plate'], payload: {depthMm: 2}},
});
// Cut is pending: it can be authored before its target exists.
project = commitEvent(project, {
  eventId: 'event.plate', type: 'feature.create',
  feature: {id: 'feature.plate', kind: 'extrude', dependsOn: [],
            writeTargets: ['body.plate'], payload: {heightMm: 5}},
});
console.log(planProject(project).executableOrder);
// ['feature.plate', 'feature.cut']
```

## Run tests

From `packages/model`: `npm test` (Node >=22.6 with TypeScript strip support) and `npm run typecheck` (requires TypeScript CLI). No installation is required for runtime tests. The root integration lane owns workspace scripts/CI and should integrate package tests into shared checks.

## Known bounds / next increments

- No evaluator executes B-rep geometry; `ready` means **dependency-admissible**, not a physically valid solid or exported STEP.
- The structural `writeTargets` contract conservatively refuses unordered writes; it does not determine geometric commutativity. Future intent schema must distinguish declared independent/commutative operations using separately justified evidence.
- Journal revision fencing is optimistic within a single project document. Durable filesystem atomic save / multi-user merge / crash recovery need an independent storage transaction.
- v1 has full replay and explicit remove/restore but no user-level undo stack, schema migration, parameter expression evaluation, topology ancestry or incremental diff cache yet. Add these in scoped tested revisions without silently changing existing v1 document meaning.

## Dimension-aware user parameters (v1 additive subpath)

Import `evaluateParameterPlan` from `@intuit3d/model/parameters`, then evaluate the **derived** plan returned by `planProject(doc)`. The original project journal and feature payloads remain authoritative; parameter values, diagnostics and admission gates are recalculated after each edit/replay and are not persisted as exact geometry.

A parameter feature has `kind: 'parameter'` and payload:

```json
{
  "parameter": {
    "name": "plate_width",
    "unit": "mm",
    "expression": {
      "op": "multiply",
      "left": {"op": "ref", "featureId": "param.base_width"},
      "right": {"op": "literal", "value": 2, "unit": "unitless"}
    }
  }
}
```

Include every referenced semantic parameter ID in `feature.dependsOn`. These dependencies may be authored later: the base planner keeps them pending until resolved. References never bind by human-readable names or transient geometry indices. The supported expression AST consists of `literal`, `ref`, `negate`, `add`, `subtract`, `multiply` and `divide`. Supported v1 units are explicitly `unitless`, `mm`, `deg`; addition/subtraction requires matching units, multiplication requires at least one dimensionless operand, and dividing by a matching unit yields `unitless`. Area/volume derived units and implicit conversions are deliberately unsupported rather than guessed.

`evaluateParameterPlan(plan)` returns `parameterValues` (in authored feature order), `featureGates` (including pending/unready features) and `admissibleExecutableOrder` (the model order filtered to exclude invalid parameter chains). A bad unit, missing explicit reference edge, divide by zero, nonfinite/underflow result or malformed/overly deep AST produces a typed diagnostic and blocks descendant features without erasing their intent.

**Evidence boundary:** scalar expressions use JavaScript IEEE-754 binary64, not an exact engineering numeric kernel; `admissible` does **not** attest B-rep correctness, STEP interchange or provider acceptance. The v1 parameter layer is an additive subpath contract, not a replacement for `planProject` or a silent alteration of the authoritative document schema.

## Semantic topology roles and explicit lineage (v1 additive subpath)

Import parseSemanticTopologyReference and resolveSemanticTopologyReference from @intuit3d/model/topology.
A selection is versioned JSON with projectId, atRevision and an application-owned
featureId/roleId/kind anchor. It may be saved in an existing feature payload;
no authoritative journal schema or existing model API is changed.

The resolver consumes a source-revision snapshot of observed roles and explicit
per-revision mapping reports. Each mapping declares the *complete predecessor set*
and successor set for one provenance event (including split/merge/deletion).
Complete coverage without a mapping means deletion; partial coverage or uncertain
mapping means pending evidence, never inferred identity. A missing revision step
is also pending. All candidate roles are returned without choosing kernel face order.

A split, merge or partial loss requires reconciliation even if later paths converge.
An explicit manual binding must identify an observed successor at the exact target
revision and is labelled resolved_manual, not provider-verified. Revalidate after
each revision; UI should preserve the unresolved selection and diagnostic codes.

This is a deterministic semantic-evidence interpreter, not an OCCT topology
oracle, exact B-rep validator or geometric equivalence proof. Native lineage
reports remain derived evidence; a provider may be wrong. Integration should
wire the versioned subpath to WORKBENCH/KERNEL without modifying those lanes here.
