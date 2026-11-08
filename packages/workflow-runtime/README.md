# @intuit3d/workflow-runtime — version 1 (experimental native provider opt-in)

**Issue:** [RUNTIME-001 #49](https://github.com/techrote/INTUIT3D/issues/49). **Code owner:** RUNTIME; this package and its tests only. No changes to INTENT, SKETCH, KERNEL, WORKBENCH or shared integration source are authorized.

This is an **executable adapter over accepted public package modules**, not a second document model, solver, geometry engine, or viewport. Its `createWorkflowRuntime(services)` constructor receives the authentic module namespaces from `@intuit3d/model`, `@intuit3d/model/transactions`, `@intuit3d/model/dimension-bindings`, `@intuit3d/model/dimension-batch-edit`, `@intuit3d/model/archive`, `@intuit3d/sketch` and `@intuit3d/sketch/profile-discovery/v1` (see `test/runtime.integration.test.mjs`). Runtime inspection derives a revision-fenced dependency plan and scalar binding evaluation from the authoritative undo-history document. It never mutates the journal.

## One-shot circular hole arrays (RUNTIME-002)

`runtime.patternCircularHoles(history, {sketchFeatureId,eventId,expectedRevision,sourceHoleId,idPrefix,instances,pivotXmm,pivotYmm,sweepDegrees})` creates 2–32 evenly spaced positions around a chosen pivot. The **solved** source circle is instance 0 and is not duplicated; the remaining instances are independent circles with stable IDs `idPrefix:p1`, `idPrefix:p2`, ... and real SKETCH-owned centre/fixed/radius constraints. `sweepDegrees` defaults to 360; negative values reverse direction. Full +/−360 sweeps omit the duplicate source endpoint, while partial arcs include the final endpoint. A pivot coincident with the solved source centre is refused.

It runs through the existing `editPlateHoles` single undoable INTENT event and the real SKETCH profile admission, with revision-fenced refusal if copies collide or cross the plate. Its return type, undo/redo/reopen and dependency invalidation are identical to the accepted rectangular-pattern API. This is **one-shot, not associative**, and is only an analytic authoring operation until a genuine native provider constructs and validates the resulting B-rep/STEP. The browser can consume the typed API without maintaining its own hole model.

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

## Atomic model-backed sketch edits (consumer-ready)

`runtime.editSketchConstraints(history, {sketchFeatureId, eventId, expectedRevision, edits, admission})` accepts **1–64 uniquely identified real SKETCH constraint patches**. It invokes the public SKETCH `validateSketch`/`editConstraint` for each edit, then speculatively commits **one** INTENT `feature.edit` journal event and re-runs the authoritative dimension/DAG/solver/profile pipeline. No separate CAD model, geometry solver, topology source or duplicate undo stack is created.

Use `admission:'require_admissible'` (default) for a consumer command that must produce a single solved analytic profile. On failure the result is `{kind:'refused',notCommitted:true,candidateFeature,...}` and the original undo history remains unchanged. Use `admission:'preserve_unresolved'` for intentional authoring of a temporarily contradictory or invalid sketch: it remains editable with typed blocked upstream/dependent feature statuses. On success the result is `{kind:'committed',history,report,sketchStatus,invalidation}`. Consumers should replace their live history **only** with the returned committed history and cancel/rebuild native work after every resulting revision change. Even a successful profile is `analytic_profile_only`, the downstream extrusion `preview_only`, and the cut `pending_exact_provider` until an actual experimental native evaluation is performed.

Example, usable from WORKBENCH's model-backed history:

```js
const result=runtime.editSketchConstraints(history,{
  sketchFeatureId:'sketch.plate',eventId:'edit.holes.'+history.document.revision,
  expectedRevision:history.document.revision,
  edits:[
    {constraintId:'holeA:diameter',patch:{value:5}},
    {constraintId:'holeB:diameter',patch:{value:5}},
  ],
});
if (result.kind==='committed') {
  // One undoable journal event; existing native STEP must be rebuilt.
  history=result.history;
} else {
  // Candidate diagnostics only; no saved/live state has been changed.
  showDiagnostics(result.candidateFeature);
}
```

`npm test --workspace @intuit3d/workflow-runtime` exercises actual INTENT/SKETCH hole, plate and profile editing, one-step undo/redo, archived replay, atomic refusal and repair of unresolved intent. `npm run typecheck --workspace @intuit3d/workflow-runtime` verifies the consumer declarations. With the pinned Linux OCP backend, `npm run demo:bridge --workspace @intuit3d/workflow-runtime` additionally exercises **real HTTP native STEP** for thickness edit, then both hole radii edit, then archived undo and new native reconstruction. Same-engine experimental STEP remains **neither production exact authority nor independent interchange qualification**.

## Atomic hole authoring — new consumer product API

`runtime.editPlateHoles(history,{sketchFeatureId,eventId,expectedRevision,admission,operations})`
adds or removes circular holes in a **single undoable authoritative INTENT feature.edit**.
Operations are `{kind:'add',id,x,y,radius}` or `{kind:'remove',id}`; all
coordinates and **radii** are in millimetres. Distinct stable IDs are required.
New circles receive a named centre point, a fixed-centre constraint and
a radius-valued constraint named `<id>:diameter` (matching the accepted SKETCH fixture/WORKBENCH convention) in the actual SKETCH document; existing holes can be
deleted only if their centre and radius are owned by exactly those two
constraints with no external references. Attempts to destroy shared
constraint intent are rejected rather than auto-healed. Multiple independent
holes may be authored in one batch.

```js
const added=runtime.editPlateHoles(currentHistory,{
  sketchFeatureId:'sketch.plate',
  eventId:'user.add.third.hole',
  expectedRevision:currentHistory.document.revision,
  admission:'require_admissible',
  operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}],
});
if(added.kind==='committed'){
  currentHistory=added.history;
  // WORKBENCH can display added.report, and request a fresh STEP using
  // evaluateLocalPlate({ ..., readCurrentHistory:()=>currentHistory }).
  // Native geometry is still OCP experimental, not certified production CAD.
}
```

This is actual model/solver/profile admission (not browser-owned sketch state).
`require_admissible` refuses an overlapping/outside hole without changing
history. `preserve_unresolved` deliberately retains an invalid but editable
hole for repair, while disabling dependent preview/cut. Undo, redo and
`runtime.save/reopen` preserve all stable identities and source constraints.
The runtime reports transitive invalidation of the sketch, plate and cut;
it **never reuses an old STEP receipt** across revisions.

`test/hole-edit.integration.test.mjs` covers actual model/solver admission,
new-hole kernel request mapping, remove, overlap refusal/recovery, undo/replay
and foreign-constraint preservation. Existing `demo:bridge` now adds a third
hole, exports a fresh actual OCP STEP, undoes the hole and rebuilds a
second native STEP (when the pinned Linux OCP environment is available).
The package does **not** claim interactive UI controls; WORKBENCH owns their
consumer wiring, and INTEGRATION owns exact-head admission and CI.

## Rectangular hole arrays — one-shot, authored CAD feature

`runtime.patternPlateHoles(history, {sketchFeatureId, eventId, expectedRevision,
sourceHoleId, idPrefix, rows, columns, pitchXmm, pitchYmm, admission})`
creates a bounded **one-shot rectangular array** from an existing solved circle
in the authoritative SKETCH document. The existing circle occupies row 0,
column 0; all remaining cells are independent circles with stable IDs like
`grid1:r0c1`, fixed centres and real radius constraints. The source centre
and radius come from the **SKETCH solved geometry**, not the possibly obsolete
authored seed coordinates. Signed pitches are in mm; 2–32 cells and the
experimental plate-v1 64-hole ceiling are enforced.

```js
const out=runtime.patternPlateHoles(currentHistory,{
  sketchFeatureId:'sketch.plate',
  eventId:'user.pattern.'+currentHistory.document.revision,
  expectedRevision:currentHistory.document.revision,
  sourceHoleId:'holeA',idPrefix:'grid1',
  rows:2,columns:2,pitchXmm:16,pitchYmm:-18,
});
if(out.kind==='committed') {
  currentHistory=out.history; // exactly ONE undoable INTENT model transaction
  // Cancel any in-flight native evaluation and rebuild on the new revision.
} else {
  showDiagnostics(out.candidateFeature); // the source history is unchanged
}
```

This is **not** an associative parametric pattern or a new feature-history
dependency: after authoring, changing the source hole does not silently edit
its copies. Consumers must clearly label it a one-shot rectangular array and
may edit its individual circles using `editSketchConstraints`. The exact
SKETCH profile gate refuses overlapping/outside copies by default; callers may
explicitly `preserve_unresolved` for repair. All copies, their IDs and
dimensions survive model archive, undo/redo, and transitive invalidation;
the KERNEL plate-v1 request maps all admitted holes to native Boolean bores.

`test/hole-pattern.integration.test.mjs` verifies real INTENT/SKETCH solver
admission (including changed source constraints vs seed geometry), journal
atomicity, archive replay, refusal/repair, and actual KERNEL parser mapping.
`npm run demo:bridge --workspace @intuit3d/workflow-runtime` additionally
creates the five-hole array via the live loopback/OCP STEP path, undoes the
array and produces a fresh two-hole STEP on Linux with pinned experimental
OCP. This is **not** OCCT 8.0.1 production or independent STEP import.
WORKBENCH owns the browser array interaction; INTEGRATION owns CI and merges.


## Persistent revision-fenced browser CAD session (v1)

The browser-safe `@intuit3d/workflow-runtime/live-plate-session` entry
point binds the **one existing** authoritative INTENT history ref to the
accepted RUNTIME command APIs and localhost native bridge. It introduces
no second journal, geometry engine, sketch authority or server.

```js
import {createLivePlateSession} from '@intuit3d/workflow-runtime/live-plate-session';
// historyRef.current must be updated synchronously (before React setState).
const session=createLivePlateSession({
  runtime,
  readCurrentHistory:()=>historyRef.current,
  publishHistory:next=>{historyRef.current=next;setHistory(next);},
});
const edit=session.applyEdit(h=>runtime.editPlateHoles(h,{
  sketchFeatureId:'sketch.plate',eventId:'user.add.hole.'+h.document.revision,
  expectedRevision:h.document.revision,admission:'require_admissible',
  operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}],
}));
if (edit.kind==='committed') {
  // edit.invalidation describes affected authored SKETCH / extrude / cut.
  // No STEP bytes from the previous revision remain available.
}
const result=await session.evaluate({url:hostUrl,token:pairedToken,
  requestId:'user.native.edit.1',exportStep:true});
if (result.kind==='experimental_plate_evaluated') {
  // Fetch AGAIN, synchronously and immediately before the download click:
  const currentStep=session.currentStep();
  if (currentStep) offerDownload(currentStep.bytes,currentStep.filename);
}
```

`session.applyEdit` accepts the actual RUNTIME/INTENT command or a
SKETCH-backed edit result and publishes its new `UndoHistory` synchronously,
only after checking project/revision fences, model inspection and dependency
invalidation. Refused edits leave the history and any still-current native
result intact. `session.reopen(saved)` requires
`{confirmReplacement:true}` to replace a different archive. `save()`
returns the canonical authoritative archive, never B-rep or STEP bytes.

`evaluate` cancels the previous in-flight client request, fences old
results even if a provider ignores cancellation, and retries a transient
host `busy` response at most three times with bounded backoff. Native
timeouts and crashes remain explicit unresolved results; they never
modify the authored project. External direct history updates are detected by
`refresh()`, `evaluate()` or `currentStep()`, which discards stale
receipts. The local host remains the existing authenticated Node bridge
and continues to own filesystem access, subprocess supervision and STEP
byte verification. The UI MUST call `currentStep()` immediately before
using the returned bytes; retaining its own STEP reference across edits
bypasses that protection.

**One-command real experimental OCP + localhost demonstration:**

```sh
npm run demo:bridge --workspace @intuit3d/workflow-runtime
```

The existing native demo now uses the live session, including authenticated
STEP fetch, atomic SKETCH hole-radius edits, add/remove hole, rectangular
hole array, archive reopen and undo-based native rebuild. It requires the
pinned OCP provider and is a genuine experimental physical run *only when
executed on that provider*. `npm test` includes a separate real INTENT/
SKETCH/localhost test using a clearly labelled synthetic native double;
neither test substitutes for independent non-OCCT STEP import, production
OCCT 8.0.1 qualification or human browser acceptance.

**WORKBENCH handoff:** its current `runtimeSession.ts` already owns a
synchronous history ref and the pairing/download UI. It can adopt this
single controller to wrap its existing `runtime.editPlateHoles`,
`runtime.editSketchConstraints`, `runtime.undo`, `runtime.redo` and
local STEP actions. WORKBENCH owns that UI change; INTEGRATION owns
cross-package admission and guarded merges.

## Single-call browser edit → native rebuild (live session v1)

`session.applyEditAndEvaluate(edit, {url,token,requestId,exportStep:true})`
composes the **existing** authoritative synchronous INTENT/SKETCH edit with the
already-qualified latest-revision local provider lifecycle. No second journal,
geometry solver, server or STEP cache is created. A refused sketch edit returns
`{kind:'refused',edit,evaluation:null}`, sends no native job and retains the
last still-current verified receipt. A committed edit publishes the new history,
invalidates the old STEP synchronously, starts evaluation, and returns
`{kind:'submitted',edit,evaluation}`. The nested evaluation may be unresolved
(`stale_revision`, cancelled, busy, timeout, provider failure); `submitted`
**does not mean a STEP was generated or that exactness was established**.

WORKBENCH can consume the typed method directly from its existing
`createLivePlateSession` instance (one caller-owned `historyRef`); use
`session.currentStep()` at download-click time rather than saving a prior
result. The real INTENT + SKETCH + localhost HTTP integration test exercises
refusal, three-hole construction, dependent invalidation, undo, save/reopen
and rebuilding; its native backend is explicitly synthetic. The separate
`npm run demo:bridge --workspace @intuit3d/workflow-runtime` exercises actual
experimental OCP when installed. Neither path substitutes for independent
external STEP or production OCCT 8.0.1 qualification.

## Rigidly reposition existing holes (RUNTIME-002)

`runtime.transformPlateHoles(history,{sketchFeatureId,eventId,expectedRevision,holeIds,translateXmm,translateYmm,rotateDegrees,pivotXmm,pivotYmm})` performs one user-authorized rigid translation/rotation of **1–32 selected, independently constrained existing circular holes**. Both pivot coordinates are required for rotation. Positions are read from **the real SKETCH solve**; this does not trust preview geometry, assign new hole IDs, modify radii or introduce a parametric pattern engine.

The operation patches the actual hole-centre fixed constraints, passes the batch through the accepted SKETCH edit/solve and profile-admission gate, and commits **one INTENT journal event** with dependency-aware invalidation. Invalid contacts/overlaps are refused without a write under default `require_admissible`; callers may explicitly preserve unresolved authoring intent for repair. Shared/externally referenced hole centres are refused rather than silently detaching constraints. Undo/redo/archive replay preserve the original IDs and operation history. This is a **one-shot** transform, not a live associative relationship.

**WORKBENCH adoption:** a multi-hole selection/drag/rotate inspector can pass selected stable circle IDs and a chosen pivot. Use the existing `createLivePlateSession().applyEditAndEvaluate(h => runtime.transformPlateHoles(h, request), pairedNativeOptions)` to trigger a revision-fenced experimental plate/cut rebuild. On refusal, retain the unchanged current STEP; on a committed edit, discard the prior receipt. `currentStep()` remains the only approved download-time accessor. The browser preview is analytic/tessellated; native OCP/STEP remains experimental until independently qualified.

**Qualification:** `npm test --workspace @intuit3d/workflow-runtime` includes actual INTENT/SKETCH solver, refusal, undo/save/reopen/redo and real KERNEL request-parser integration with an explicitly synthetic responder. `npm run demo:bridge --workspace @intuit3d/workflow-runtime` additionally physically rebuilds and same-engine-checks the repositioned holes **only when the pinned OCP backend is installed**. None of these is independent non-OCCT STEP interoperability.

## Retrospective multi-hole pitch and bore dimensioning (RUNTIME-002)

`runtime.resizePlateHoleLayout(history,{sketchFeatureId,eventId,expectedRevision,holeIds,pivotXmm,pivotYmm,scaleX,scaleY,radiusScale})`
resizes an already-authored selection of 1–32 circular holes in **one** journal
event. Scale factors are positive, dimensionless; `scaleX`/`scaleY` change
solved centre spacing around an explicitly chosen sketch-space pivot and
`radiusScale` independently changes the solved bore radii. Leave a factor at
1 to keep that dimension. This makes after-the-fact adjustments of rectangular
and polar bolt-hole layouts immediately practical without replacing the model
journal or recreating entity IDs. No persistent associative pattern is implied.

Both positional and radius edits pass through the actual SKETCH solver and
physical-profile admission. Stale requests, shared/external constraint
ownership, negative scales and invalid profiles are refused; an explicit
`preserve_unresolved` request can retain editable failed intent. The existing
`session.applyEditAndEvaluate(h=>runtime.resizePlateHoleLayout(h,request),options)`
provides an immediately consumable WORKBENCH edit/rebuild action, while
`session.currentStep()` still fences experimental STEP by current revision.
Consumers must label existing OCP 7.9.3.1 STEP experimental, not validated
production exactness. Real native demonstration:
`npm run demo:bridge --workspace @intuit3d/workflow-runtime`.

## Recoverable native refresh and one-command project reopen (RUNTIME-002)

The **existing** `createLivePlateSession()` now keeps a successfully verified
current-revision experimental STEP available when a *new evaluation of the
same canonical INTENT archive* is cancelled, returns unavailable, or runs with
`exportStep:false`. The current download accessor still checks the full
authoritative serialized archive. Any actual edit, external history mutation,
undo, or replacement archive revokes the old receipt immediately. This is
not an offline cache of a stale solid: the old bytes remain accessible only
while their exact authored inputs remain current. `refresh().lastResultKind`
reports the most recent provider outcome separately from
`refresh().hasVerifiedStep`.

WORKBENCH can restore a saved archive and physically rebuild with a single
typed consumer call:

```js
const result = await session.reopenAndEvaluate(savedArchive, {
  confirmReplacement: true,  // required if replacing a different document
  url: pairedHost.url, token: pairedHost.token,
  requestId: 'workbench.reopen.1', exportStep: true,
});
if (result.kind === 'submitted' &&
    result.evaluation.kind === 'experimental_plate_evaluated') {
  const current = session.currentStep(); // recheck at download-click time
}
```

Without explicit replacement confirmation, `kind:'refused'` returns without
altering the document **or submitting a native job**. With confirmation, the
previous revision's STEP is synchronously invalidated; the new current archive
must earn a fresh experimental native receipt. The demonstration
`npm run demo:bridge --workspace @intuit3d/workflow-runtime` exercises a
real OCP save → extra-hole edit → confirmed reopen → physical STEP rebuild
sequence. `npm test --workspace @intuit3d/workflow-runtime` also covers
the trusted localhost path and deterministic provider failure/retry behaviour.
These are **experimental** OCP/same-engine checks, not OCCT 8 production or
independent external STEP evidence.

### Bounded live native evaluation

`createLivePlateSession(...).evaluate({url,token,exportStep:true,deadlineMs:30000})` has a **total** 30-second default deadline (adjustable from 25 to 120000 milliseconds), covering provider execution and bounded host-busy retries. A hung HTTP/native adapter that ignores `AbortSignal` now resolves as `{kind:'unresolved',code:'timeout'}` instead of leaving the browser awaiting forever. Explicit cancellation likewise settles promptly; old workers remain fenced and their late responses cannot publish. `refresh().lastResultKind` records the failed attempt while `currentStep()` retains prior same-archive SHA-verified experimental bytes. Any committed edit, external project mutation or confirmed archive replacement still revokes them. Native host timeouts and browser deadlines are separate controls; none establishes production exactness or independent STEP validation.



## Solver-backed edits without publishing on every pointer move

`createLivePlateSession()` now supports a **two-phase model-backed edit** for
interactive dimensions, hole moves, and other actual INTENT/SKETCH commands.
A preview is an ephemeral candidate journal **inside the same authoritative
runtime**, not another project, preview-mesh geometry authority, or native solid.

```js
// Pointer move: create a real INTENT/SKETCH candidate without touching the
// current document, undo journal, native worker, or still-current STEP bytes.
const proposal = session.previewEdit(history => runtime.editSketchConstraints(history, {
  sketchFeatureId: 'sketch.plate',
  eventId: 'drag.holeA.' + history.document.revision,
  expectedRevision: history.document.revision,
  admission: 'require_admissible',
  edits: [{constraintId: 'holeA:fixed',patch: {x: 40, y: 40}}],
}));
if (proposal.kind === 'preview') {
  // Display proposal.report and its solver/profile diagnostics as a
  // NON-AUTHORITATIVE visual candidate, not as validated exact geometry.
  // Pointer release: the opaque token commits once only if the source
  // archive remains byte-identical; then one real native evaluation runs.
  const result = await session.commitPreviewAndEvaluate(proposal, nativeOptions);
  if (result.kind === 'submitted') {
    // Only result.evaluation can contain current-revision experimental STEP;
    // even that is NOT qualified exact or independent interoperability.
  }
}
```

Each `previewEdit()` replaces the previous sampled pose, including when
the latest pointer position fails SKETCH admission. Only the **latest**
successful proposal can commit. Earlier release callbacks return
`invalid_preview`, not silently commit an older geometry. On pointercancel /
Escape call `session.cancelPreview(proposal)`, which discards only that matching
gesture without changing history, STEP, or native evaluation. A delayed
pointercancel cannot discard a more recent proposal.
`session.refresh().hasActivePreview` is available to the UI.

If another edit, undo, project reopen or replacement occurs before release, the
preview commit returns `{kind:'refused',code:'stale_preview'}` without publishing
its candidate or dispatching a provider. A consumed/foreign token returns
`invalid_preview`. Normal SKETCH admission refusal also performs no commit.
A preview does not revoke an already verified current STEP; **a committed
preview does revoke it immediately**, and the new provider result is
revision-fenced by the existing live session.

Run the deterministic model/solver/local-host test with
`node --experimental-strip-types --test packages/workflow-runtime/test/live-plate-session.integration.test.mjs`
from a locked installed repository. The loopback provider in this test is a
synthetic native test double. The separately existing `npm run demo:bridge
--workspace @intuit3d/workflow-runtime` exercises experimental OCP; neither
is independent STEP verification. WORKBENCH owns wiring pointer
press/move/release to this API, and INTEGRATION owns cross-package admission.

### Safe repeated STEP downloads after interactive edits

At the moment of download obtain `const receipt=session.currentStep()`; never
reuse an older receipt across an edit, undo or reopen. The session retains an
independent copy of SHA-verified experimental STEP bytes: mutating or transferring
an `evaluation.step.bytes` response or a previously returned
`currentStep().bytes` buffer cannot alter a subsequent download. The latest
revision fence remains mandatory and a committed gesture still invalidates the
previous receipt. For a real saved file, use a fresh copy from
`session.currentStep()` and label it **experimental OCP / same-engine readback**,
not production-certified STEP. The real-INTENT/SKETCH localhost regression
exercises both mutation paths; native OCP and independent CAD qualifications
remain separate gates.


## Local pinned OCCT 8.0.1 C++ → authoritative browser CAD bridge

`startLocalPinnedOcct8Bridge` is the **Node-only** pinned native alternative
to `startLocalPlateBridge`. It reuses the already accepted authenticated
loopback route, INTENT/SKETCH source admission, revision/abort fencing and
browser-safe `evaluateLocalPlate` / `createLivePlateSession` consumers.
The browser supplies only authoritative archive, semantic cut/request IDs and
an export flag, never a native executable or filesystem destination.

```js
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {runPinnedOcct8Plate} from '@intuit3d/kernel-contract/local-occt8-provider';
import {startLocalPinnedOcct8Bridge} from '@intuit3d/workflow-runtime/local-plate-bridge';
const host=await startLocalPinnedOcct8Bridge({
  runtime,model,plateContract,runPinnedOcct8Plate,
  workerExecutable:'/absolute/path/to/intuit3d_occt8_plate',
  crossVersionStepAudit:false, // optional pinned OCP readback is distinct
});
// WORKBENCH continues to use host.url, host.token and the normal live session.
```

The pinned adapter **requires** KERNEL's separate Part 21 plate-subset
structural audit and labels its browser verified bytes
`occt8_part21_plate_subset`. A mismatched provider backend or version,
absent audit, archive digest disagreement, native artifact substitution and
corrupted STEP byte transport are rejected. The original OCP 7.9.3.1 path
still returns `same_engine_step_readback`. **Both paths always report
`exactAuthority:false` and `independentInteroperability:false`.** Real
OCCT 8.0.1 plus a narrow Part 21 audit is not production exact authority
or arbitrary STEP interoperation certification.

`npm test --workspace @intuit3d/workflow-runtime` executes real INTENT and
SKETCH through HTTP with an explicitly **synthetic** pinned native provider,
including edit/undo/save/reopen, wrong backend, wrong audit, artifact mutation
and mismatched serialized archive negative cases.

On a machine with an *actual provisioned pinned C++ binary*, run:

```sh
INTUIT3D_OCCT8_WORKER=/absolute/path/to/intuit3d_occt8_plate \
  npm run demo:occt8:bridge --workspace @intuit3d/workflow-runtime
```

That command uses the real KERNEL `runPinnedOcct8Plate` provider, builds
an 8 mm two-hole plate, retrospectively changes thickness to 12 mm, then
resizes the two *solved SKETCH* bore radii and centre spacing in one admitted
journal edit. It physically rebuilds the new cut, undoes both edits separately,
reopens both the edited and original archives, and rebuilds through the same
production-facing HTTP/browser-safe API. It validates actual STEP bytes, independent plate-subset
audit receipts, model revision, analytic volume and SHA-256. It **fails** if
the pinned binary is missing. This command is not a claim it ran on every
CI runner. WORKBENCH pointer/browser use and the external AnvilCAD/BRL-CAD
STEP checks still require their own executed integration qualification.


### One-command authoritative edit → pinned C++ → separately executed non-OCCT STEP sampling

The native demo now optionally reads back **the very STEP bytes returned by
the live INTENT/SKETCH session**, not an older standalone native fixture.
When a genuine source-pinned AnvilCAD probe has been compiled by PLATFORM,
execute the following command on a host with both native executables:

```bash
INTUIT3D_OCCT8_WORKER=/absolute/path/to/intuit3d_occt8_plate \
INTUIT3D_ANVIL_STEP_PROBE=/absolute/path/to/intuit_step_probe \
INTUIT3D_ANVIL_PROBE_SHA256=<actual-64-character-binary-sha256> \
npm run demo:occt8:independent --workspace @intuit3d/workflow-runtime
```

This deliberately requires both binaries: no mock or fallback substitutes for
a missing independent reader. The bounded Node-only
`@intuit3d/workflow-runtime/nonocct-step-probe` adapter checks the
probe's binary SHA-256, copies the exact verified downloadable STEP into a
private temporary path, executes the non-OCCT importer without a shell, and
requires one source-matched solid, mm units, exact B-rep import, closed mesh,
volume within the already-declared 1% sampled-mesh budget, zero warnings,
two material Z intersections and correctly located bore/exterior rays.
Each of **seven real user states** (8 mm, retrospective 12 mm, resized
hole centres/radii at 12 mm, undo hole layout, undo thickness, edited-project
archive reopen, and original-project archive reopen) produces a source-archive/
STEP/probe/transcript-SHA-bound receipt. The independent reader checks the
new bore coordinates and material rays, not merely the extrusion volume. Neither STEP bytes nor binaries are committed.

**Evidence boundary:** ordinary package tests use *synthetic text transcripts*
to exercise refusal of mislocated holes, bad units/topology, and false volume.
These do not execute AnvilCAD. The command above executes the actual supplied
non-OCCT binary and C++ provider, but binary origin, pin, license and completed
hosted execution still require separate PLATFORM/INTEGRATION verification.
`exactAuthority:false` and `independentInteroperability:false` remain
unchanged at the application boundary. No general/arbitrary STEP or browser
qualification is inferred. Integration alone wires native provisioned executables
into official CI or accepts this new evidence.


### Current revision-fenced external STEP receipt (Node host)

The pinned C++ seven-stage demonstration calls
\`verifyCurrentLivePlateStep({session,evaluation,probeExecutable,expectedProbeSha256})\`
for each STEP. This obtains \`session.currentStep()\` rather than importing an
unrelated old buffer. It checks project ID, exact saved archive SHA-256, revision,
Part21 audit and STEP content SHA **before and after** asynchronous external
CAD import. An edit, undo, reopen or replacement during import makes the receipt
stale, never a successful check of the new active project. The function is a
trusted Node-host consumer API; the browser cannot pick local executable paths.
The synthetic subprocess test proves only revision fences. Real C++ and AnvilCAD
executables, binary-source attestation and graphical interaction remain separate
gates. Exact and general interoperability authority remain false.


## Authenticated local provider pairing and pinned-only export

A browser intending to export through pinned OCCT 8.0.1 C++ must not silently
fall back to experimental OCP 7.9.3.1. The trusted loopback host now provides
**GET \`/v1/plate/capabilities\`**, protected by the same per-launch token,
Origin and Host checks as native evaluation. Its response identifies the
configured backend, version and expected STEP verification. It does **not**
prove the executable is provisioned, that native geometry executed, or that
independent CAD import passed. No host filesystem path is disclosed.

The browser-safe API exposes strict opt-in:

\`\`\`js
import {inspectLocalPlateBridge} from '@intuit3d/workflow-runtime/local-plate-client';

const identity=await inspectLocalPlateBridge({url:hostUrl,token:pairedToken});
if(identity.kind==='paired' && identity.backend==='OCCT-cxx-8.0.1') {
  const result=await session.evaluate({
    url:hostUrl,token:pairedToken,requestId:'model.native.1',
    requiredBackend:'OCCT-cxx-8.0.1',exportStep:true,
  });
  if(result.kind==='experimental_plate_evaluated') {
    // Read session.currentStep() again at the moment of download.
    // Keep experimental/native provenance and exact-authority=false.
  }
}
\`\`\`

Supplying \`requiredBackend\` to \`evaluateLocalPlate\` or through
\`session.evaluate\` / \`applyEditAndEvaluate\` /
\`reopenAndEvaluate\` / \`commitPreviewAndEvaluate\`
performs authenticated pairing *before* dispatch. A mismatched provider
returns \`unresolved/provider_mismatch\` without executing a native job.
The actual response backend, version, STEP SHA and Part21 evidence remain
separately checked after execution. Omitting this option preserves the
existing dual-provider client.

**Tests:** \`npm test --workspace @intuit3d/workflow-runtime\` and
\`npm run typecheck --workspace @intuit3d/workflow-runtime\` exercise actual
INTENT/SKETCH histories across authenticated HTTP with explicitly synthetic
native doubles. Genuine combined C++→AnvilCAD evidence still requires
\`npm run demo:occt8:independent --workspace @intuit3d/workflow-runtime\`
with physical source-qualified provisioned binaries. WORKBENCH owns UI adoption.


## Persistent WORKBENCH command boundary (Draft #190)

The live session can use one canonical INTENT archive as its durable source.
No preview model, second undo stack, or alternate native host is introduced.
With a *single writer per storage key* (localStorage is atomic per key, but not
compare-and-swap across tabs), WORKBENCH can opt in as follows:

```ts
import {createPersistentHistorySource} from '@intuit3d/workflow-runtime/persistent-history-source';
import {createLivePlateSession} from '@intuit3d/workflow-runtime/live-plate-session';

const source=createPersistentHistorySource({
  runtime,storage:window.localStorage,key:'intuit3d.cad-project.v1',
  initialHistory:initialAcceptedModelHistory,
});
const session=createLivePlateSession({runtime,...source});
const state=session.refresh();
const result=await session.applyCommandAndEvaluate({
  kind:'model.events',projectId:state.projectId,expectedRevision:state.revision,
  events:[{eventId:'ui.thickness.12',type:'feature.edit',featureId:'plate',
    patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}}}],
},{url:nativeHost.url,token:nativeHost.token,requestId:'ui.rebuild.12',
  exportStep:true,requiredBackend:'OCCT-cxx-8.0.1'});
if(result.kind==='submitted' && result.evaluation.kind==='experimental_plate_evaluated'){
  // Always request the latest, source-verified bytes at download time.
  const step=session.currentStep();
}
```

Typed commands: `model.events`, `model.undo`, `model.redo`,
`dimensions.batch`, `sketch.constraints`, `sketch.holes`,
`sketch.holes.rectangular`, `sketch.holes.circular`,
`sketch.holes.transform`, `sketch.holes.resize`. Every command requires
`{projectId,expectedRevision}` from `session.refresh()`; specialized
`request` objects omit `expectedRevision`, which is injected at dispatch.
The genuine RUNTIME services perform validation, solver admission, transaction
commit and dependency invalidation. A stale command returns `kind:'refused'`
without publishing history or dispatching native evaluation. Undo/redo,
feature authoring and removal are journal events, not direct mesh edits.

For a saved project after reload, construct the source again **without**
`initialHistory`; any corrupt or missing stored archive is an explicit
failure, never a silent reset. `session.reopen(archive,
{confirmReplacement:true})` is the only explicit replacement path. No native
STEP receipt survives reload; a fresh provider evaluation is mandatory.

The browser/HTTP synthetic-provider integration test covers a 2→3→2-hole
workflow, a retrospective 8→12 mm plate edit, rejected overlapping geometry,
undo/redo, cross-session reopen, two distinct artifact bytes and stale export
refusal. **It does not establish native geometry**. The pinned OCCT8 worker
must be source-matched and separately physically executed; a pinned-backend
selection restricts provider choice but does not promote `exactAuthority` or
`independentInteroperability` to true.

### Atomic ordered CAD command batches

WORKBENCH can author a dependent edit burst **without publishing partial
sketch/feature states** using `session.applyCommands(batch)`. The outer
`projectId` / `expectedRevision` fence applies to the *entire* batch;
each bounded operation receives the next real INTENT revision internally.
The canonical history source is written **once**, after every accepted
transaction and SKETCH/profile admission; any refused operation reports its
zero-based `commandIndex` and commits nothing. Invalid arguments throw
without publishing any intermediate edits. This is not a second preview
model, native geometry result or a new undo-log format.

```ts
const {projectId,revision}=session.refresh();
const outcome=await session.applyCommandsAndEvaluate({
  kind:'commands.batch',projectId,expectedRevision:revision,
  commands:[
    {kind:'model.events',events:[{eventId:'edit.thickness.12',
      type:'feature.edit',featureId:'plate',
      patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}}}]},
    {kind:'sketch.holes',request:{sketchFeatureId:'sketch.plate',
      eventId:'edit.add.holeC',
      operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}]}},
  ],
},{requiredBackend:'OCCT-cxx-8.0.1',exportStep:true});
if(outcome.kind==='submitted') {
  // A submitted native evaluation can still be unresolved. It is never
  // implicitly production-exact or independently interoperable.
  const verifiedCurrent=session.currentStep();
}
```

This commits two ordinary undoable INTENT transactions in one **durable
archive replacement**, not one combined undo entry. A future undo of the
whole group must undo both transactions through the normal model contract.
There is at most one native evaluation after admission; any changed
revision revokes previous STEP receipts immediately. Synchronous
single-writer storage is still required: `Storage.getItem/setItem` is
not cross-tab compare-and-swap. Run
`node --test packages/workflow-runtime/test/atomic-command-batch.integration.test.mjs`
for real INTENT/SKETCH + loopback HTTP testing with a clearly synthetic
native provider. Physical pinned OCCT8 and external STEP geometry still
require their separate executable acceptance.


### Source-matched disk archive + genuinely pinned C++ batch acceptance

`test/atomic-command-batch.integration.test.mjs` now exercises a real
single-file, rename-atomic archive on both hosted Node platforms. It commits
two INTENT/SKETCH changes with **one** durable write, reopens the exact
archive in a new session, simulates a crash after staging but before archive
rename, and proves that a subsequent fresh session can recover and rebuild
the uncorrupted 12 mm / three-hole project. The rebuild transport uses an
explicitly **synthetic** native provider. It is NOT a real OCCT run.

The existing native integration executable,
`test/local-occt8-bridge.native-demo.mjs`, retains its original seven-stage
JSON contract for PLATFORM's exact stage/material oracle. With explicit
`--atomic-batch` it additionally tests a two-command batch through the
**actual configured OCCT 8.0.1 C++ provider**. It
retrospectively changes extrusion thickness and independently resizes both
SKETCH hole constraints, verifies one file-backed model publication, tests
analytic volume and physical STEP receipts, then reconstructs the identical
model in a new disk-backed live session without persisting/reusing STEP bytes.
It retains the existing native seven-state undo/reopen run and optionally
checks every current STEP through the independently pinned external probe.
No synthetic provider is installed in this executable.

```sh
npm ci
npm test --workspace @intuit3d/workflow-runtime
npm run typecheck --workspace @intuit3d/workflow-runtime

# Physically run the source-matched C++ worker (fails if absent):
INTUIT3D_OCCT8_WORKER=/absolute/path/to/intuit3d_occt8_plate \
  npm run demo:occt8:bridge --workspace @intuit3d/workflow-runtime

# Additional physical atomic batch + fresh disk-backed session restart:
INTUIT3D_OCCT8_WORKER=/absolute/path/to/intuit3d_occt8_plate \
  node packages/workflow-runtime/test/local-occt8-bridge.native-demo.mjs --atomic-batch

# For real independent imported STEP samples, also provide both:
INTUIT3D_OCCT8_WORKER=/absolute/path/to/intuit3d_occt8_plate \
INTUIT3D_ANVIL_STEP_PROBE=/absolute/path/to/intuit_step_probe \
INTUIT3D_ANVIL_PROBE_SHA256=<actual-64-character-binary-sha256> \
  npm run demo:occt8:independent --workspace @intuit3d/workflow-runtime

# The combined physical batch AND independent CAD importer:
INTUIT3D_OCCT8_WORKER=/absolute/path/to/intuit3d_occt8_plate \
INTUIT3D_ANVIL_STEP_PROBE=/absolute/path/to/intuit_step_probe \
INTUIT3D_ANVIL_PROBE_SHA256=<actual-64-character-binary-sha256> \
  node packages/workflow-runtime/test/local-occt8-bridge.native-demo.mjs \
    --atomic-batch --require-independent
```

The demonstration prints SHA-256, source revision, actual provider/geometry
and STEP outputs. The additive `--atomic-batch` mode also prints a digest
of the canonical disk archive and its durable write count. The script deletes
its temporary working directory on normal exit. This adds a runnable
**acceptance path**, not evidence that the worker or external probe was
executed on ordinary Node CI. The host still requires provisioned,
source-matched actual native binaries (#154/#159), and #74 governs
cross-package browser and independent product acceptance. Only Integration
may merge and close the original #73 lifecycle gate. Both ordinary and
native demonstrations retain `exactAuthority:false` and
`independentInteroperability:false` at the application boundary.
