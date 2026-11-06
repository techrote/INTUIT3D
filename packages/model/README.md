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
