# @intuit3d/workflow-runtime — version 1 (experimental native provider opt-in)

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

## Revision-aware invalidation (additive v1)

`runtime.diff(previousUndoHistory, nextUndoHistory)` re-plans **both** immutable
INTENT histories and calls `diffWorkflowPlans(previousPlan, nextPlan)`. This is a
derived structural change cut, not a replacement graph, solver or cached
geometry evaluator. It compares authoritative feature records/status/diagnostics,
includes dependencies from **both** revisions, and traverses affected descendants
iteratively, including deleted and reparented branches, future dependencies,
cycles and long chains. It rejects cross-project, reversed revisions,
same-revision state changes, malformed/duplicate IDs and incomplete authored
orders. It returns deterministic `changedFeatureIds`,
`invalidatedFeatureIds`, `removedFeatureIds`, `unchangedFeatureIds`,
project/revision fences and **`exactReuseAllowed: false`**.

`unchangedFeatureIds` means *structurally unaffected according to these INTENT
plans*, NOT B-rep equivalence, current numeric validity or permission to retain a
previous STEP/geometry receipt. Consumers must treat any previous exact or
approximate geometry as unverified against a new revision unless their own
qualified provider performs the appropriate revalidation. No last-good state
is stored, and runtime inspection still reports `exactGeometryAvailable:false`.

The dependency-free `test/invalidation.unit.test.mjs` covers revised
parameters, reparented/deleted ancestors, newly satisfied future targets, cycles,
12,000-feature iterative closure, and unsafe revision/cross-project inputs.
`test/runtime.integration.test.mjs` additionally exercises actual model-backed
sketch edits, dependent plate/cut invalidation and archive replay.


## Experimental native plate+cut execution (additive, versioned API)

The browser-safe `@intuit3d/workflow-runtime/experimental-plate` entry point
exports `createExperimentalPlateWorkflow`, accepting the **actual**
`createWorkflowRuntime` instance, INTENT's `featuresOf`, the public
`@intuit3d/kernel-contract/plate-v1` parser, and the trusted Node host's
`runExperimentalPlate` from `@intuit3d/kernel-contract/local-plate-provider`.
It does **not** import or bundle Node filesystem/process functionality into
WORKBENCH. A future local desktop/loopback bridge must own host IPC and safe
filesystem access; do not call the Node provider directly inside React.

`evaluate(history, {cutFeatureId, requestId, readCurrentHistory, exportStep?,
stepOutput?, timeoutMs?, signal?})` derives the live INTENT report and
SKETCH-admitted analytic profile, matches one explicit body-targeted dependent
cut and rectangular extrude, and maps the **off-origin** SKETCH rectangle/circles
to the centred plate-v1 native fixture. It refuses arbitrary/rotated polygons,
unsupported profile geometry, ambiguous competing body writes, invalid sketch
states or missing holes. The public KERNEL parser independently checks physical
plate dimensions, unsupported numerical ranges and hole contact. A revision
callback checks the live model/solver snapshot, so altered same-revision source
cannot be passed as current to native STEP publication. The trusted KERNEL
provider owns subprocess cancellation, bounded timeout, revision-aware SHA-256
verification and exclusive STEP output publication.

Outputs are only `experimental_plate_evaluated` or `unresolved`; there is **no**
`validated_exact` return. The local host constructs an actual OCP 7.9.3.1
B-rep with Boolean bores and same-engine STEP readback. This is deliberately
*not* a general chained cut evaluator, production OCCT 8.0.1 authority,
independent STEP consumer, reusable exact-shape cache, Windows native gate,
or proof of crash-durable external file publication. Keep
`exactAuthority:false` and `independentInteroperability:false`.

**One command for real native plate/two-hole/edit/reopen/STEP demonstration**
(run on a host where pinned Python/OCP is installed):

```sh
npm run demo:native --workspace @intuit3d/workflow-runtime
```

This constructs an authoritatively journalled SKETCH plate with two circular
holes and dependent cut, invokes the actual local native worker to emit
same-engine-checked STEP, then adds a retrospective INTENT thickness binding,
reopens the saved model and repeats native evaluation. It checks both STEP
files and their changed SHA-256 hashes across 8 mm -> 10 mm thickness,
removing temporary files afterward. **Missing OCP must fail, not count as a
native pass.** This command is deliberately separate from `npm test`, which
tests contract wiring with an explicitly stubbed native provider on both OSes.

WORKBENCH can consume the versioned entry point now, but must introduce its
own controlled local host bridge before any real native or STEP UI operation.
INTEGRATION retains exact-head CI/qualification and cross-lane integration.


## Local experimental plate bridge — Node host ↔ authoritative browser client (v1)

The new **Node-only** `@intuit3d/workflow-runtime/local-plate-bridge`
and **browser-safe** `@intuit3d/workflow-runtime/local-plate-client` connect
the admitted model-backed WORKBENCH flow to the existing experimental
`@intuit3d/kernel-contract/local-plate-provider`. This is an executable
local end-to-end adapter, **not** a separate project journal, solver or B-rep.

Start a trusted Node process with the existing public INTENT/SKETCH namespaces
and kernel provider (do **not** bundle the local native provider in Vite):

```js
import {startLocalPlateBridge} from '@intuit3d/workflow-runtime/local-plate-bridge';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {runExperimentalPlate} from '@intuit3d/kernel-contract/local-plate-provider';
// Compose the actual accepted model, transactions, bindings, dimensions,
// archive, sketch and profile-discovery namespaces, as in the runtime demo.
const runtime = createWorkflowRuntime(services);
const host = await startLocalPlateBridge({
  runtime, model, plateContract, runExperimentalPlate,
  origin:'http://127.0.0.1:5173', port:0, timeoutMs:45000,
});
console.log(host.url); // token must be handed only to a trusted local UI
// await host.close() on application shutdown
```

The browser consumes its live authoritative model history (not a copied
preview journal). The token and host URL must be entered/passed only by the
trusted local UI; there is intentionally no token-discovery endpoint.

```js
import {evaluateLocalPlate} from '@intuit3d/workflow-runtime/local-plate-client';
const response = await evaluateLocalPlate({
  url:hostUrl,token:pairedToken,runtime,
  readCurrentHistory:()=>latestHistoryRef.current,
  cutFeatureId:'cut',requestId:'plate.edit.1',exportStep:true,
  signal:controller.signal,
});
if (response.kind==='experimental_plate_evaluated' && response.step) {
  // Before actually offering a download, check the model revision AGAIN.
  // response.step.bytes is a Uint8Array, SHA-256 verified by the client.
  // It is a *same-engine checked experimental* STEP, not independent CAD truth.
}
```

The HTTP protocol is `POST /v1/plate/evaluate` with exactly
`{archive,cutFeatureId,requestId,exportStep}` as JSON. It returns
`intuit3d.local-plate-bridge` v1 with source project/revision/archive digest,
the strictly experimental result, and optional bounded verified STEP bytes.
The host enforces a per-launch random token, exact local origin and Host,
loopback binding, 2 MiB request limit, 8 MiB STEP limit, single active native
job, cancellation when the HTTP response closes, bounded native timeout and
server-owned temporary STEP staging with deletion after reply. It does not
accept any file path from a browser. No cloud service, telemetry or login is
involved. Unsupported profiles/cuts remain `unresolved`.

The HTTP server cannot see a browser's live state while native work is
running: the client compares an authoritative serialized model snapshot both
before and after asynchronous evaluation and after STEP verification. The UI
must repeat that fence immediately before offering/saving bytes, especially
if its state can change after the promise resolves. A local token is a pairing
secret, not hostile local-process or browser-extension containment. No automatic
production/native/external-STEP equivalence may be inferred.

**Executable checks:**

```sh
npm ci
npm test --workspace @intuit3d/workflow-runtime
npm run typecheck --workspace @intuit3d/workflow-runtime
# Requires actual pinned Python/OCP research installation:
npm run demo:bridge --workspace @intuit3d/workflow-runtime
```

The integration test exercises real INTENT and SKETCH through live localhost
HTTP with an **explicit synthetic provider double**; it verifies a step payload,
archive replay, later dimension edit, origin/token/path rejection and stale
browser revision containment. It is **not native geometry evidence**. The
`demo:bridge` command, when actually run on a pinned OCP machine, performs
two genuine native cut/STEP runs (thickness 8→10 mm) through the loopback
browser client and verifies material volume/STEP digest differences. Report
its result separately from ordinary Node tests and from independent STEP
interoperability (which is not established).

Consumer ownership: WORKBENCH integrates these browser APIs and a paired
local-host UI only within `apps/web/**`; INTEGRATION qualifies full host/browser
interaction, source/lock/CI and merging. RUNTIME changes only
`packages/workflow-runtime/**`.
