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

## Explicit orphaned dimension dependency release (v1 additive subpath)

Import `previewDimensionDependencyReconciliation` and
`commitUndoableDimensionDependencyReconciliation` from
`@intuit3d/model/dimension-dependency-reconcile`. Clearing or replacing a
binding **never** automatically deletes a feature dependency. To release an
orphaned edge, the author must name it, supply a fresh revision/event ID,
inspect any independent intent and set
`confirmIndependentIntentReviewed: true`.

Preflight accepts only existing edges whose **latest introduction** occurred
in a journal edit that simultaneously added a matching dimension binding.
Edges authored on initial feature creation, edges introduced by generic
dependency edits, and later reintroductions without a matching binding are
**not** eligible. Every current binding is scanned, so shared live parameter
references cannot be released. Existing non-parameter dependencies are
ineligible even with a coincidental prior witness. Unknown future parameter
IDs are permitted only with an actual binding-introduction witness. Original
other dependencies, authored payloads and feature IDs are retained.

The witness demonstrates **co-occurrence, not exclusive ownership**:
arbitrary other semantics might have acquired meaning after the binding was
added. Explicit human/user confirmation remains necessary and the API never
infers that permission. `require_admissible` refuses an unresolved result or
a regression of formerly admissible affected features; `permit_unresolved`
retains a pending graph and null derived payload, not fabricated exact
geometry. Each successful release is a journal event and a single durable
undo frame, with deterministic replay and structural invalidation.

These checks prove only conservative *semantic graph repair*; no B-rep,
kernel geometry, browser UX, STEP exchange or operator authorship
authentication is attested. Other kinds of dependency must be reconciled
through explicit general-purpose semantic editing; this v1 adapter does not
claim they are dimension-owned.


## Retrospective parameter expression editing — v1 authoring API

The additive `@intuit3d/model/parameter-edit` package export provides
`previewParameterEdit(document, request)` and
`commitUndoableParameterEdit(undoHistory, request)`. Both accept a
`intuit3d.parameter-edit` version-1 request with fresh `eventId`, stable
`featureId`, `expectedRevision`, replacement scalar `expression` and
`admission` (`require_admissible` or `permit_unresolved`).

A valid reauthoring operation changes the existing parameter feature's source
expression as **one append-only journal event** and (on commit) one durable undo
frame, without overwriting authored numeric geometry fields or changing IDs.
References to a newly used parameter gain explicit dependency edges; previous
edges are intentionally retained and require explicit reconciliation if they
cease to be semantically necessary. The preview returns a revision-fenced
dimension evaluation and old/new-DAG invalidation frontier. Strict admission
also protects previously admitted dependent scalar bindings from becoming
unready or invalid. Permissive edits retain pending/cyclic/invalid intent with
null resolved payloads: **a previous numeric value must not be reused as a
current solved dimension**. Scalar admission does not validate that an extrusion
thickness is positive or that any solid is exact; those are RUNTIME/SKETCH/KERNEL
responsibilities.

Example:

```ts
import { commitUndoableParameterEdit, PARAMETER_EDIT_FORMAT } from
  '@intuit3d/model/parameter-edit';

const next = commitUndoableParameterEdit(history, {
  format: PARAMETER_EDIT_FORMAT,
  version: 1,
  eventId: 'edit.thickness.2',
  featureId: 'parameter.thickness',
  expectedRevision: history.document.revision,
  expression: { op: 'literal', value: 12, unit: 'mm' },
  admission: 'require_admissible',
});
```

To execute a representative real-public-package consumer workflow with an
actual SKETCH solver and accepted WORKFLOW RUNTIME (sketch with two holes,
extrude preview, retrospective 8→12 mm edit, dependent invalidation, undo/redo
and archive save/reopen):

```sh
npm ci
node --experimental-strip-types packages/model/examples/plate-parameter-lifecycle.mjs
```

The example explicitly reports `cutStatus: "pending_exact_provider"` and
`exactGeometryAvailable: false`. It does not generate a native B-rep, export
STEP or establish browser/human acceptance. These require independent
qualification and must never be inferred from successful model replay.


## Authored semantic target selection + explicit split/merge recovery (v1)

`@intuit3d/model/semantic-selection` is an additive public API for cut/fillet
consumers to **write actual selection intent into the journal**, not a saved
kernel face number. `previewSemanticSelectionEdit` and
`commitUndoableSemanticSelectionEdit` create a revision-fenced
`feature.edit` with a `SemanticTopologyReference` in a named payload field,
preserve unrelated payload and all existing dependency edges, and add the
selected source-feature dependency. `require_ready` rejects unresolved model
dependencies; `permit_pending` deliberately retains forward-reference intent.
The preview exposes the dependency-aware invalidation frontier.

`assessSemanticSelection` combines the persisted source with **fresh, explicit**
provider snapshots and per-revision mappings. Missing evidence returns
`pending_evidence`; incomplete model dependencies return `pending_model`.
A one-to-one observation is only a `candidate`, **not exact geometry**.
Splits/merges return `requires_reconciliation` and candidate roles without
choosing one. An explicit user choice can be committed with
`commitUndoableSemanticSelectionRecovery` only if that role is present in
the ambiguous trace; this re-anchors authored intent in a new revision.
Undo/redo and archive/reopen replay the original or newly authored anchor.
Subsequent edits require new provider evidence even if the role names match.
Old dependency edges are not silently dropped when selecting another source
feature; release requires separate audited intent reconciliation.

Run `node --experimental-strip-types packages/model/examples/face-recovery.mjs`
from the repo root for an actual semantic plate + cut + split/recovery +
undo/redo + thickness edit + archive demo. No provider is invoked; the
explicit analytic split fixture represents **synthetic provider hints**.
This package never attests OCCT topology equivalence, solid validity or STEP
interoperability. RUNTIME and WORKBENCH should consume the selection gate
rather than treating model `ready` as an exact shape signal.

## Journal-backed authored timeline moves (additive v1 event)

Import `moveHistoryFeature` from `@intuit3d/model/history-move`. This
versioned consumer operation moves an **active feature** after another active
feature (or to timeline start), checks project + revision, and appends one
`feature.move` event in one undoable transaction. `featureTimelineOf`
exposes positional tombstones for removed features so an undo or subsequent
restore does not silently change the authored location. The core
`planProject().authoredOrder` now reflects deliberate moves; the separate
`executableOrder` remains topologically sorted by declared dependencies and
does not infer dependencies from timeline positions.

The request result returns updated `UndoHistory`, both timeline indices,
changed UI rows, and the existing structural incremental invalidation hint.
Moving independent operations requires no native recalculation: **zero
invalidation does not mean cached B-rep geometry is verified**. Two writers
to the same body remain conflicted without an explicit dependency edge.
Invalid, removed, self-target or stale moves are rejected without modifying
the original document. The journal and undo/archive round-trip the result.

The v1 file format can now contain a new `feature.move` event. Earlier
INTUIT3D builds whose strict v1 parser does not know that event will reject
such a document; they must be upgraded, not silently downgraded. Existing
v1 documents without moves remain readable. Integration must assess and
admit this cross-consumer compatibility change before exposing drag-to-reorder.

Run the representative no-native-intent fixture:

```bash
node --experimental-strip-types packages/model/examples/plate-history-move.mjs
```

The example authors a two-hole sketch, extrude and cut, moves the cut after
the extrusion, changes the upstream thickness 8→12 mm, verifies that only
parameter/extrude/cut need structural reevaluation, undoes/redoes and
serializes/reopens the full model archive. It does **not** run SKETCH/OCCT,
show a browser interaction or certify STEP interoperability.


## Model-owned semantic selection inventory (v1; INTENT-002 #62)

Import `inspectSelectionInventory` and `SELECTION_EVIDENCE_FORMAT` from
`@intuit3d/model/selection-inventory`. This is a **derived, browser-safe**
project-wide summary of the existing authored `semantic-selection/v1` fields;
it does not add an authoritative document type or persist provider results.

`inspectSelectionInventory(document)` lists every live feature's versioned
top-level face/body/edge selection, with `await_provider`, `repair_model`,
`choose_successor` and `replace_deleted_reference` actions. A runtime or
trusted native adapter may optionally provide `intuit3d.selection-evidence`
v1 receipts bound to the **exact** project, revision, consumer feature, field
and stored source reference. Each receipt carries the existing
`TopologySnapshot` and ordered `TopologyStep[]` plus an honest provider label
(`deterministic_fixture`, `experimental_native`, or `native`). Stale,
duplicate, foreign, replaced or unowned body references fail closed.

One-to-one provider-observed continuations are `candidate`, not exact B-rep
admission. Split/merge targets expose all semantic successor candidates for
explicit `commitUndoableSemanticSelectionRecovery`, never a guessed face.
Missing/partial provider reports remain `pending_evidence`; unresolved model
features remain `pending_model`. `allReferencesObserved` is only a semantic
observation summary, **not permission to export STEP**.
`exactGeometryAuthority` is hard-coded `false`. The actual experimental
plate-v1 provider currently does **not** report physical face provenance, so
only deterministic fixtures demonstrate split/merge recovery until native
contract adoption is separately qualified by KERNEL/RUNTIME/INTEGRATION.

Run the compact two-hole plate → retrospective 8→12 mm thickness edit →
branch invalidation → reported face split → explicit repair → undo/redo →
archive/reopen demonstration:

```bash
node --experimental-strip-types packages/model/examples/selection-inventory.mjs
```

The fixture is model-only and its lineage receipts are explicitly synthetic.
The consumers should use the inventory for **repair UI and selection readiness**,
and independently use RUNTIME/KERNEL's actual provider-validation gates for
geometric truth, STEP bytes and any exact/independent claims.


## Atomic named parameter creation + retrospective binding (v1)

Import `previewParameterAuthoring` and `commitUndoableParameterAuthoring` from
`@intuit3d/model/parameter-authoring`. This is the supported user-command
adapter for creating a named scalar parameter and connecting one or more
existing numeric feature fields **in one undoable journal transaction**.
It composes the existing audited expression and dimension-edit contracts;
RUNTIME consumes the resultant document without a second authority.

```js
const request = {
  format:'intuit3d.parameter-authoring',version:1,
  expectedRevision:history.document.revision,
  admission:'require_admissible',
  parameter:{
    eventId:'create.thickness',featureId:'parameter.thickness',
    name:'thickness',unit:'mm',
    expression:{op:'literal',value:8,unit:'mm'},
  },
  bindings:[{eventId:'bind.plate',featureId:'extrude.plate',field:'thicknessMm'}],
};
const preview = previewParameterAuthoring(history.document,request);
const next = commitUndoableParameterAuthoring(history,request);
```

The command validates source IDs, expression references, target fields,
uniqueness and the final graph/scalar gates before any commit. Strict
`require_admissible` refuses unresolved or regressing changes. Explicit
`permit_unresolved` retains future-parameter dependencies and null derived
values for later repair. Existing independent dependencies are never erased.
This is a **model/scalar admission API**, not a geometry or STEP certification.

Consumer demonstration:
`node --experimental-strip-types packages/model/examples/create-bind-replay.mjs`
after workspace dependencies are linked. It exercises the accepted SKETCH and
RUNTIME modules, 8→12 mm retrospective parameter editing, partial invalidation,
undo/redo and archive roundtrip, with the cut kept `pending_exact_provider`.


## Freeze resolved dimensions into independent authored values (v1)

`@intuit3d/model/parameter-freeze` exports `previewParameterFreeze` and
`commitUndoableParameterFreeze`. A user can unbind a dimension after
retrospectively editing a parameter **without reverting to its stale fallback**.
Only the current finite, model-admitted scalar is written to the journal; a
pending or invalid binding refuses the operation. This is scalar-intent
admission, not a 2D solver, native B-rep or STEP validation.

The command is one optimistic-revision-fenced undo frame and can (a) bake
several bound fields, (b) release explicitly user-reviewed edges only when
`dimension-dependency-reconcile` proves their binding-introduction witnesses,
and (c) retire a parameter **only after no living feature depends on it**.
Unproven or independently meaningful edges remain authored and visible, not
silently deleted. Omit `release` and `retire` to keep that conservative state.

```js
const proposal=previewParameterFreeze(history.document,{
  format:'intuit3d.parameter-freeze',version:1,
  expectedRevision:history.document.revision,admission:'require_admissible',
  edits:[{eventId:'freeze.thickness',featureId:'extrude.plate',field:'thicknessMm'}],
  release:[{eventId:'release.thickness.edge',featureId:'extrude.plate',
    dependencies:['parameter.thickness']}],
  confirmIndependentIntentReviewed:true,
  retire:{eventId:'retire.thickness',parameterId:'parameter.thickness'},
});
const next=commitUndoableParameterFreeze(history,sameRequest);
```

`confirmIndependentIntentReviewed` is a deliberate author confirmation, not
an inference from co-occurrence. Consumers should show which edges will be
released and obtain explicit approval before commit.

Executable public INTENT/SKETCH/RUNTIME plate demonstration:

```sh
node --experimental-strip-types packages/model/examples/freeze-parametric-plate.mjs
```

It builds a two-hole plate, retrospectively binds its extrusion thickness,
edits 8→12 mm, freezes the current 12 mm value, releases the reviewed
parameter-only dependency, retires the parameter and verifies undo/redo plus
save/reopen. RUNTIME deliberately retains `preview_only` extrusion and
`pending_exact_provider` cut; there is no STEP or production-exact claim.

## User-operated feature removal and restoration (v1)

The additive `@intuit3d/model/feature-lifecycle` contract lets a
WORKBENCH/RUNTIME timeline delete a selected feature without silently deleting
its dependents or treating stale solid geometry as current. Call
`inspectFeatureRemoval(document, featureId)` first to show direct and
transitive consequences. Then call `previewFeatureRemoval` and
`commitUndoableFeatureRemoval` with fresh event IDs:

- `reject_if_referenced` prevents deleting a feature with living dependents.
- `keep_dependents_pending` retires only the selected feature; cut/fillet
  descendants remain authored and visibly unresolved until restored or repaired.
- `cascade_descendants` retires the entire dependent branch only after
  explicit confirmation, as one undoable transaction (maximum 64 events).

`previewFeatureRestoration` / `commitUndoableFeatureRestoration`
restore explicitly selected tombstones, retaining their original stable feature
IDs, dependencies and authored timeline positions. `require_ready` refuses
a restoration that would introduce unresolved features or regress previously
ready ones; `permit_unresolved` preserves forward/deferred intent explicitly.
Both operations are revision/project-fenced, transactionally validated and return
a dependency-aware invalidation plan. All values are **semantic model evidence,
not exact B-rep or STEP authority**.

Run the executable workflow with:

```sh
node packages/model/examples/recoverable-plate-cut.mjs
node --experimental-strip-types --test packages/model/test/feature-lifecycle.test.mjs
```

A consuming timeline must generate a fresh event ID for each operation and
must invalidate any formerly current geometry for deleted/upstream-dependent
features; it must not reuse preview meshes or STEP receipts based on this model
API alone.

## Recover a cut after replacing its extrusion (v1)

Use the additive public subpath **@intuit3d/model/cut-reattachment**:
`inspectCutReattachment`, `previewCutReattachment` and
`commitUndoableCutReattachment`. A designer can remove the original plate
extrusion, create a replacement extrusion for the **same semantic body**,
and explicitly reattach the original cut rather than deleting its work.
The cut and downstream fillet keep their IDs, payloads and body targets.

Inspect exposes deleted body producers and active replacements. Preview
checks an explicit, versioned and revision-fenced request, retains the
old producer's journal tombstone, and returns a real dependency plan plus
partial-rebuild invalidation. Commit appends one `feature.edit` event as one
undoable action. It refuses an active old producer, wrong body, stale
revision, duplicate event ID, unsupported type, and any regression of
a previously ready feature. `require_ready` refuses incomplete repairs;
`permit_unresolved` retains authentic pending/blocked/conflicted intent.

This bounded v1 operates on a cut with explicit `payload.targetBodyId`
and same-body `writeTargets`, replacing one deleted `extrude` dependency
with a live `extrude` writing the identical body ID. It never guesses
face equivalence, remaps a different body, changes cut parameters or
promotes an experimental geometry-provider result to exact authority.

Run `node packages/model/examples/reattach-cut.mjs` from the repo root.
The runnable demonstration covers a dimensioned plate with two holes,
cut and fillet, original extrusion deletion and replacement, one-shot
repair, undo/redo, archive reopen, a retrospective width edit and a
dependency-aware partial rebuild preserving an unrelated body. Its
geometry state is **semantic only**: fresh native B-rep reconstruction
and independent STEP validation remain separate provider gates.

## Sequential same-body cuts (v1 additive contract)

Import `inspectBodyCutChain`, `previewBodyCutAppend`, and `commitUndoableBodyCutAppend` from `@intuit3d/model/body-cut-chain`. The caller explicitly chooses an existing semantic body, the last dependency-ordered extrusion/cut writer, a SKETCH source and a discovered profile candidate. An append creates one new `cut` feature that depends on **both** the preceding body writer and the sketch. A cut can therefore follow another cut without the planner incorrectly reporting unordered mutation. No authoring chronology or inferred target-body heuristic substitutes for dependency edges.

A request declares `extent: {kind: 'through_all'}` or `{kind: 'blind', depthMm: 3}`, plus project/revision fences and an admission policy. `require_ready` refuses an absent sketch or an unresolved cut; `permit_unresolved` intentionally leaves a not-yet-created sketch pending. Ambiguous/parallel same-body writers, unsupported terminal operations, duplicate semantic IDs, stale revisions and invalid depths are rejected without modifying the source. The returned structural invalidation identifies affected upstream/downstream features; unrelated bodies stay unaffected. Undo/redo and archive reopening preserve the original feature/body IDs and authored cut selection.

Run `node packages/model/examples/sequential-body-cuts.mjs` for a plate with an existing through-cut, a new blind pocket, retrospective plate-width edit, partial replay, undo/redo and save/reopen. **This contract is semantic only.** The SKETCH/RUNTIME consumer must re-admit the `profileCandidateId`; KERNEL must separately evaluate the actual B-rep and STEP under a current-revision receipt. A planner status of `ready` is not physical Boolean success, a certified volume or an independent STEP reader result. The established FEATUREOPS profile authoring restriction on second writers remains its own consumer change; this API provides the explicit safe dependency contract rather than bypassing it.


### Retrospective cut-extent editing (body-cut-chain/v1)

The public `@intuit3d/model/body-cut-chain` subpath now additionally exports
`inspectBodyCutExtent`, `previewBodyCutExtentEdit` and
`commitUndoableBodyCutExtentEdit`. A selected existing cut can switch between
`through_all` and positive finite `blind.depthMm`, preserving semantic
feature identity, explicit body target, source sketch/profile and dependency
ordering. An earlier edited cut invalidates its dependent cuts while independent
bodies remain structurally reusable. One revision-fenced journal edit is one
undo/redo frame and survives model archive reopening.

The request pins project/revision, selected cut, body and original authored
extent. Stale/mismatched/ambiguous or invalid edits reject atomically. The
preview always reports `exactGeometryAuthority: false` and
`requiresNativeRebuild: true`; actual sketch admission, physical Boolean
construction, native STEP receipts and external CAD import remain distinct
RUNTIME/KERNEL/PLATFORM responsibilities.

```bash
node packages/model/examples/retrospective-pocket-depth.mjs
node --experimental-strip-types --test packages/model/test/body-cut-extent-edit.test.mjs
```
