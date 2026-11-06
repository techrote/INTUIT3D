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
- The v1 core journal does not itself persist a user-level undo stack; the additive `transactions` subpath provides a versioned, explicit undo-history sidecar. Schema migration and durable filesystem-level atomic persistence are not yet implemented. Parameter evaluation, topology lineage and structural incremental invalidation are separate derived v1 subpaths.

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


## Incremental dependency replay (v1 additive subpath)

\`planIncrementalEvaluation(previousDocument, currentDocument)\` is available from
\`@intuit3d/model/incremental\`. The transition must be an **append-only prefix**
of the same authoritative project journal. Branch divergence, rollback, and a
different project ID throw \`ProjectRevisionError\`; consumers must discard old
derived caches and perform a full rebuild rather than guessing equivalence.

The result lists direct semantic changes, retired features, all living features
invalidated through **both** old and new dependency graphs, current executable
features to re-evaluate in topological order, structurally unchanged ready
features, and unresolved/pending/conflicted features with diagnostics.
Appending an independent operation does not invalidate unrelated features.
Retrospective dimension changes, dependency rewiring, future-target recovery,
feature deletion/restoration and previously unordered same-body writes do.

This is **structural invalidation**, not geometric cache certification:
\`unchangedReady\` alone never means a cached B-rep/STEP is current. Cache
consumers must additionally fence project/revision provenance, backend/build
version, kernel tolerances/options, feature input signatures, and any material
data external to the semantic dependency graph. Missing explicit dependency
edges are a contract defect; provider provenance cannot be silently invented
here. Full replay remains the safe fallback on cache uncertainty or rejection.


## Transactional speculative commands + durable undo/redo (v1 additive subpath)

Import from \`@intuit3d/model/transactions\`. \`previewTransaction(doc, events,
expectedRevision)\` validates a **whole 1–64 event group** against the same
append-only semantic journal and returns its projected document, derived
dependency plan and compensating commands. The caller's document never changes;
a missing dependency remains pending and an unordered write remains conflicted.
\`commitTransaction\` returns the accepted immutable document or throws without
partial commits.

For user-visible undo/redo, \`startUndoHistory(project)\` creates a versioned
\`intuit3d.undo-history\` v1 session. \`commitUndoableTransaction\` groups user
events atomically and records their inverse semantic commands. Use
\`undoTransaction(session, freshEventIds, expectedRevision)\` and
\`redoTransaction(...)\` to append new, validated remove/restore/edit events
rather than rewinding the journal. Undo of a creation removes its feature;
redo restores its existing semantic ID, **never** calls create a second time.
An undo of an edit records the *previous authored fields*, including units,
references, payload and declared targets, not cached geometry. New user edits
clear the redo stack. Save/reopen the entire session with
\`serializeUndoHistory\` and \`deserializeUndoHistory\`.

The caller must allocate a unique semantic **event ID for each inverse event**
(typically one ID per item in the most recent stack frame). The library refuses
missing/reused IDs, revision mismatches, bad command metadata and unsupported
versions. The persisted exact-document fence detects mismatched sidecar/history
state on reopen; it is neither a cryptographic signature nor an atomic
cross-tab filesystem lock. There is an explicit 256-group retention ceiling,
not an undocumented truncation policy. Consumers must checkpoint/archive on
reaching that limit; no event is silently dropped.

**Qualified scope:** application-owned feature.create/edit/remove/restore
semantics and derived planning only. No geometric solution, STEP identity
validation or browser storage atomicity is implied. This interface is additive
to v1 journal serialization and uses the existing TypeScript package; shared
workspace/CI and consumer integration remain Integration-owned.


## Self-contained archive, checked recovery and explicit undo checkpoint (v1 additive subpath)

Import `createModelArchive`, `serializeModelArchive`,
`deserializeModelArchive`, `inspectModelArchiveRecovery` and
`checkpointUndoHistory` from `@intuit3d/model/archive`. The
`intuit3d.model-archive` v1 format contains **one complete authoritative
document plus its undo/redo session**. It does not store meshes, native B-rep,
solved geometry or a STEP-validity assertion.

Example consumer flow:

```ts
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
  checkpointUndoHistory, inspectModelArchiveRecovery,
} from '@intuit3d/model/archive';
import {serializeUndoHistory} from '@intuit3d/model/transactions';

const text = serializeModelArchive(createModelArchive(session));
// The application must write 'text' via a crash-atomic local replacement.
// Neither this package nor localStorage makes disk writes atomic.
const reopened = deserializeModelArchive(text);
const preview = inspectModelArchiveRecovery(primaryText, backupText);
// Admit preview.primary only when preview.status === 'primary_current'.
// backup_recovery, backup_ahead, history_ambiguity and diverged require
// explicit review before replacing the authoritative document.
const savedSession = serializeUndoHistory(reopened.history);
const afterExplicitCheckpoint = checkpointUndoHistory(
  reopened.history, savedSession, 'discard-undo-redo'
);
```

A checkpoint **discards only undo/redo frames**, requiring an exact full-session
snapshot fence and an explicit destructive-history acknowledgement. It retains
the *entire* append-only journal, original feature identities and revisions.
This allows new edit groups when the 256-frame limit is reached without silently
dropping undo history or rewriting source events. The original saved archive may
still be retained for an intentional historical restore.

`inspectModelArchiveRecovery(primary, backup)` checks both candidate sources
independently, refuses unknown formats, invalid journals and mismatched session
fences, and compares same-project journals by exact append-only prefix.
A newer backup is **not** silently made current; torn-primary restoration is
labelled `backup_recovery`; same-journal but incompatible undo stacks are
`history_ambiguity`; divergent branches remain `diverged`.

**Limitations:** serialization is a one-unit logical snapshot, **not** an
atomic filesystem API, secure signature, concurrent multi-tab CAS, history
compaction or interchange proof. The v1 JSON archive is bounded to 32 MiB
of UTF-8; larger projects require another explicitly versioned storage format.
A caller must save with a platform-appropriate temporary-file + fsync/rename
protocol (or a separately qualified browser persistence transaction), preserve
the previous good archive, validate after reopening, and present recovery
candidate status to the user before adoption. No current-state geometry claim
is implied by a successfully restored journal.


## Retrospective dimension bindings (v1 derived adapter)

Import \`evaluateDimensionBindingPlan(planProject(doc))\` from
\`@intuit3d/model/dimension-bindings\`. A geometry feature can carry an
**authoritative, versioned** \`payload.dimensionBindings\` manifest that
binds existing scalar top-level payload fields to the same parameter expression
AST and unit rules already implemented by \`@intuit3d/model/parameters\`:

\`\`\`json
{
  "widthMm": 1,
  "thicknessMm": 8,
  "dimensionBindings": {
    "format": "intuit3d.dimension-bindings",
    "version": 1,
    "entries": [
      {"field": "widthMm", "unit": "mm",
       "expression": {"op": "multiply",
         "left": {"op": "ref", "featureId": "parameter.width"},
         "right": {"op": "literal", "value": 2, "unit": "unitless"}}}
    ]
  }
}
\`\`\`

The consuming feature **must** declare \`parameter.width\` in its
\`dependsOn\`. This enables a future-authored parameter and retrospective
dimension edits without rewriting the earlier geometry feature or using a
human-readable name as a durable reference. Evaluation returns a
\`projectId\`/\`revision\`-fenced \`featureGates\` array in authored order and
an \`admissibleExecutableOrder\` in dependency order. Only a gate whose
\`status\` is \`bound\` or \`admissible\` supplies \`resolvedPayload\`;
other statuses **must not** fall back to a stale authored number.

All dimension bindings of a feature commit to its *derived payload together*;
bad units, undeclared edges, invalid expressions, absent/non-numeric fields,
repeated fields, unsupported manifest versions, failed upstream parameters,
cycles and unknown target features stay explicit. A failed binding blocks
dependent features but does not block unrelated subgraphs. Maximum 64
bindings/feature and 1,024/plan; top-level numeric fields only. Arithmetic is
the existing finite binary64 parameter evaluator, not exact geometry. This
adapter uses disposable internal evaluation IDs, never persisted feature IDs.

**For WORKBENCH/KERNEL:** consume the versioned, derived
\`resolvedPayload\` only after comparing the plan revision to the current
document; never overwrite the authoritative journal. This is an additive
interface; downstream admission must still validate sketch solutions, geometric
intent, B-rep metrics and STEP exchange. No geometric or graphical execution
is implied by these model tests.

## Retrospective dimension edit v1 — `@intuit3d/model/dimension-edit`

`previewDimensionEdit(document, request)` produces a single validated `feature.edit`
event, speculative revision, derived binding gates and structural invalidation
frontier. `commitUndoableDimensionEdit(undoHistory, request)` commits that event
as **one undoable journal frame**; both require an optimistic
`expectedRevision` and a fresh `eventId`.

Requests use `intuit3d.dimension-edit` version 1 with `featureId`, `field`,
`binding: { unit, expression }` (or `null` to remove), and `admission`:

- `permit_unresolved`: author a forward/missing/cyclic dependency while retaining
  explicit `unready` / null derived payload; **never** use the numeric authored
  field as a supposedly resolved fallback.
- `require_admissible`: reject the entire edit if the changed feature's
  derived binding gate is not `bound` (or `admissible` when clearing a binding).

Expressions are structurally validated before revision staging, even when the
parameter does not exist yet. Stable parameter references are introduced as
explicit `dependsOn` edges. The adapter deliberately **does not remove old
dependency edges** when unbinding: they may also represent independent
feature-graph intent and must be reconciled through an explicit user command.
The manifest's existing bindings and numeric authored fields are preserved.
The edit does not invoke SKETCH or OCCT and is **not evidence of exact geometry**.
Consumers must check the returned project/revision fence and
`resolvedPayload !== null`, then run solver/kernel qualification. The
invalidation frontier is structural only; it cannot authenticate a geometry cache.

Example (after creating a feature with numeric `widthMm`):
```ts
import { startUndoHistory } from '@intuit3d/model/transactions';
import { commitUndoableDimensionEdit, DIMENSION_EDIT_FORMAT } from '@intuit3d/model/dimension-edit';

const session = startUndoHistory(project);
const next = commitUndoableDimensionEdit(session, {
  format: DIMENSION_EDIT_FORMAT, version: 1,
  eventId: 'event.bind.width', featureId: 'feature.plate',
  field: 'widthMm', expectedRevision: project.revision,
  admission: 'permit_unresolved',
  binding: { unit: 'mm', expression: { op: 'ref', featureId: 'param.width' } },
});
// If param.width is authored later, the same persisted intent can become bound.
```

Adversarial suite: `node --experimental-strip-types --test
test/dimension-edit.test.mjs`. Schema and validator remain additive to v1;
existing project files and provider wire formats are unchanged.

## Atomic multi-feature retrospective dimension edits v1

Import `previewDimensionEditBatch` and `commitUndoableDimensionEditBatch`
from `@intuit3d/model/dimension-batch-edit`. This additive contract
(`intuit3d.dimension-batch-edit`, version 1) accepts **1–64 distinct
feature/field edits** under one optimistic project revision fence. Each entry
uses a fresh semantic journal `eventId`, `featureId`, top-level numeric
`field` and `binding` expression (or `null` to clear it).

```ts
import { startUndoHistory } from '@intuit3d/model/transactions';
import { commitUndoableDimensionEditBatch } from '@intuit3d/model/dimension-batch-edit';

const session = commitUndoableDimensionEditBatch(startUndoHistory(project), {
  format: 'intuit3d.dimension-batch-edit',
  version: 1,
  expectedRevision: project.revision,
  admission: 'require_admissible',
  edits: [
    { eventId: 'bind.plate.width', featureId: 'feature.plate',
      field: 'widthMm', binding: { unit: 'mm',
        expression: { op: 'ref', featureId: 'param.width' } } },
    { eventId: 'bind.plate.thickness', featureId: 'feature.plate',
      field: 'thicknessMm', binding: { unit: 'mm',
        expression: { op: 'literal', value: 8, unit: 'mm' } } },
  ],
});
```

The batch stages one canonical `feature.edit` event per entry and groups
all of them into **one undoable history frame**. Undo/redo still requires
one *fresh* event ID per compensating event. The preview returns the canonical
staged events, final document, revision-fenced feature gates and structural
invalidation frontier. **No partial edit is published** if any entry fails.
Duplicate targets or event IDs, malformed expressions, non-parameter
references, unsupported request shapes and batches over the event budget
are rejected. Strict admission evaluates all edited feature gates after
the final staged edit, and rejects any newly blocked formerly-admissible
invalidated features; permissive admission retains pending/conflicted intent
without producing an admissible numeric payload.

Clearing a binding intentionally does **not** prune its dependency edge;
that edge might encode independent user intent, so a missing dependency
can remain pending until explicitly repaired. Only source-level scalar and
journal correctness are qualified here. SKETCH/KERNEL must independently
validate dimensions, solids, tolerances and STEP; preview meshes are not exact.
Test entry: `node --experimental-strip-types --test
packages/model/test/dimension-batch-edit.test.mjs`.
