/**
 * INTUIT3D Workflow Runtime v1 — authoritative model/solver orchestration.
 * This is not a geometry provider. The only ready solid state is `preview_only`.
 * Services MUST be accepted public package modules; no parallel CAD policy here.
 */
import {diffWorkflowPlans} from './invalidation.mjs';
import {applyPlateHoleOperations} from './hole-edit.mjs';
export {WORKFLOW_INVALIDATION_FORMAT, WORKFLOW_INVALIDATION_VERSION, diffWorkflowPlans} from './invalidation.mjs';

export const WORKFLOW_RUNTIME_FORMAT = 'intuit3d.workflow-runtime-evaluation';
export const WORKFLOW_RUNTIME_VERSION = 1;

const required = {
  model: ['planProject'],
  transactions: ['parseUndoHistory', 'commitUndoableTransaction', 'undoTransaction', 'redoTransaction'],
  bindings: ['evaluateDimensionBindingPlan'],
  dimensions: ['commitUndoableDimensionEditBatch'],
  archive: ['createModelArchive', 'serializeModelArchive', 'deserializeModelArchive'],
  sketch: ['validateSketch', 'solveSketch'],
  discovery: ['discoverPlateProfiles', 'admitDiscoveredPlateProfile'],
};
const runtimeStatus = Object.freeze({
  ready: 'intent_ready', pending: 'pending_intent',
  conflicted: 'ambiguous_intent', blocked: 'blocked_dependency',
});
function errorMessage(error) {
  return error instanceof Error ? error.message : 'provider threw non-Error value';
}
function failure(status, reason, extras = {}) {
  return { status, diagnostics: [reason], ...extras };
}
function goodGate(gate) {
  return gate && (gate.status === 'bound' || gate.status === 'admissible') &&
    gate.resolvedPayload && typeof gate.resolvedPayload === 'object';
}

/**
 * Constructor deliberately receives real module namespaces from the consumer.
 * This keeps RUNTIME's package independently testable and avoids a second
 * authoritative model, solver implementation or kernel fallback.
 */
export function createWorkflowRuntime(services) {
  if (!services || typeof services !== 'object') throw new TypeError('runtime: service object required');
  for (const [key, exports] of Object.entries(required)) {
    for (const name of exports) {
      if (typeof services[key]?.[name] !== 'function') {
        throw new TypeError(`runtime: missing ${key}.${name}`);
      }
    }
  }
  const {model, transactions, bindings, dimensions, archive, sketch, discovery} = services;

  /** Inspect authoritative journal/undo without mutating it or materializing a solid. */
  function inspect(historyInput) {
    const history = transactions.parseUndoHistory(historyInput);
    const plan = model.planProject(history.document);
    const scalar = bindings.evaluateDimensionBindingPlan(plan);
    if (scalar.projectId !== plan.projectId || scalar.revision !== plan.revision ||
        !Array.isArray(scalar.featureGates)) {
      throw new Error('runtime: mismatched model/dimension evaluation fence');
    }
    const byFeature = new Map(plan.features.map(entry => [entry.feature.id, entry]));
    const gates = new Map(scalar.featureGates.map(g => [g.featureId, g]));
    if (gates.size !== plan.features.length) {
      throw new Error('runtime: incomplete dimension evaluation');
    }
    const evaluated = new Map();
    // Preserve all nonexecutable authored intent, rather than dropping it.
    for (const entry of plan.features) {
      if (entry.status !== 'ready') {
        evaluated.set(entry.feature.id, failure(runtimeStatus[entry.status],
          `model: ${entry.status}`, {modelDiagnostics: entry.diagnostics, scalarStatus: 'unready'}));
      }
    }
    for (const id of plan.executableOrder) {
      const entry = byFeature.get(id);
      if (!entry || entry.status !== 'ready') throw new Error('runtime: invalid executable plan');
      const {feature} = entry;
      const blocked = feature.dependsOn.filter(dep => {
        const state = evaluated.get(dep);
        return !state || !['intent_ready', 'analytic_profile_only', 'preview_only'].includes(state.status);
      });
      if (blocked.length) {
        evaluated.set(id, failure('blocked_dependency', `upstream runtime feature unavailable: ${blocked.join(', ')}`,
          {relatedIds: blocked, scalarStatus: 'unready'}));
        continue;
      }
      const gate = gates.get(id);
      if (!goodGate(gate)) {
        evaluated.set(id, failure('blocked_scalar', `dimension gate: ${gate?.status ?? 'missing'}`,
          {scalarStatus: gate?.status ?? 'missing', dimensionDiagnostics: gate?.diagnostics ?? []}));
        continue;
      }
      const payload = gate.resolvedPayload; // derived from authoritative INTENT; never write back
      const scalarStatus = gate.status;
      if (feature.kind === 'sketch') {
        if (!Object.hasOwn(payload, 'sketch')) {
          evaluated.set(id, failure('invalid_sketch', 'sketch payload missing', {scalarStatus}));
          continue;
        }
        try {
          const source = sketch.validateSketch(payload.sketch);
          const solved = sketch.solveSketch(source);
          if (solved.status !== 'solved') {
            evaluated.set(id, failure('unsolved_sketch', `sketch solver: ${solved.status}`,
              {scalarStatus, solveStatus: solved.status, sketchDiagnostics: solved.diagnostics}));
            continue;
          }
          const proposal = discovery.discoverPlateProfiles(source);
          if (proposal.status !== 'ready' || proposal.candidates?.length !== 1) {
            evaluated.set(id, failure('invalid_profile', `profile discovery: ${proposal.status}`,
              {scalarStatus, solveStatus: solved.status, discoveryReason: proposal.reason,
                rejected: proposal.rejected ?? []}));
            continue;
          }
          const profile = discovery.admitDiscoveredPlateProfile(source, proposal, proposal.candidates[0].id);
          if (profile.status !== 'analytic_profile_only') {
            throw new Error('sketch provider returned non-analytic profile');
          }
          evaluated.set(id, {status:'analytic_profile_only', scalarStatus, solveStatus: solved.status,
            profile, sketchSignature: proposal.inputSignature, diagnostics:[],
            evidence:'sketch_analytic_only'});
        } catch (error) {
          evaluated.set(id, failure('invalid_profile', `sketch admission refused: ${errorMessage(error)}`,
            {scalarStatus}));
        }
        continue;
      }
      if (feature.kind === 'extrude') {
        const sketchId = payload.sourceSketchId;
        const thickness = payload.thicknessMm;
        if (typeof sketchId !== 'string' || !feature.dependsOn.includes(sketchId) ||
            byFeature.get(sketchId)?.feature.kind !== 'sketch') {
          evaluated.set(id, failure('invalid_feature', 'extrude requires an explicit sketch dependency',
            {scalarStatus}));
          continue;
        }
        if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) {
          evaluated.set(id, failure('invalid_feature', 'extrude requires positive finite thicknessMm',
            {scalarStatus}));
          continue;
        }
        if (feature.writeTargets.length !== 1) {
          evaluated.set(id, failure('invalid_feature', 'extrude must explicitly identify one semantic output body',
            {scalarStatus}));
          continue;
        }
        const source = evaluated.get(sketchId);
        if (source?.status !== 'analytic_profile_only') {
          evaluated.set(id, failure('blocked_dependency', 'extrude source has no admitted analytic profile',
            {scalarStatus, relatedIds:[sketchId]}));
          continue;
        }
        // A profile with holes is an intended plate-with-cuts preview, NOT
        // evidence that any Boolean, B-rep or through-hole actually exists.
        evaluated.set(id, {status:'preview_only', evidence:'sketch_analytic_only', scalarStatus,
          sourceSketchId:sketchId, bodyId:feature.writeTargets[0], thicknessMm:thickness,
          profile:source.profile, diagnostics:[]});
        continue;
      }
      if (feature.kind === 'cut') {
        evaluated.set(id, failure('pending_exact_provider', 'cut requires qualified native B-rep provider',
          {scalarStatus}));
        continue;
      }
      evaluated.set(id, {status:'intent_ready', scalarStatus, diagnostics:[], evidence:'model_only'});
    }
    if (evaluated.size !== plan.features.length) throw new Error('runtime: incomplete executable evaluation');
    return {
      format:WORKFLOW_RUNTIME_FORMAT, version:WORKFLOW_RUNTIME_VERSION,
      projectId:plan.projectId, revision:plan.revision,
      authoredOrder:[...plan.authoredOrder], executableOrder:[...plan.executableOrder],
      features:plan.features.map(({feature, status, diagnostics}) => ({
        featureId:feature.id, kind:feature.kind, modelStatus:status,
        modelDiagnostics:diagnostics, ...evaluated.get(feature.id),
      })),
      exactGeometryAvailable:false,
    };
  }

  /**
   * Structural invalidation between authoritative histories. No derived geometry
   * or previous exact/STEP artifact is implicitly made current by this diff.
   */
  function diff(previousHistory, nextHistory) {
    const previous=transactions.parseUndoHistory(previousHistory);
    const next=transactions.parseUndoHistory(nextHistory);
    return diffWorkflowPlans(model.planProject(previous.document), model.planProject(next.document));
  }

  /**
   * Apply a batch of authored sketch constraint edits as ONE INTENT transaction.
   * SKETCH alone validates and updates constraint geometry; runtime owns only
   * revision-fenced admission and the authoritative journal commit.
   *
   * require_admissible: preview a candidate and refuse without changing history
   * unless SKETCH admits exactly one analytic plate profile.
   * preserve_unresolved: retain validly authored but unsolved/invalid geometry
   * for subsequent user repair, with no fabricated usable solid.
   */
  function editSketchConstraints(history, request) {
    const {sketchFeatureId,eventId,expectedRevision,edits,
      admission='require_admissible'}=request??{};
    const previous=transactions.parseUndoHistory(history);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision!==previous.document.revision)
      throw new Error('runtime sketch edit: stale or missing expectedRevision');
    if (typeof sketchFeatureId!=='string' || !sketchFeatureId ||
        typeof eventId!=='string' || !eventId ||
        !['require_admissible','preserve_unresolved'].includes(admission) ||
        !Array.isArray(edits) || edits.length<1 || edits.length>64 ||
        typeof sketch.editConstraint!=='function')
      throw new TypeError('runtime sketch edit: valid feature/event, SKETCH adapter and 1–64 edits required');
    const entry=model.planProject(previous.document).features.find(x=>x.feature.id===sketchFeatureId);
    if (entry?.feature.kind!=='sketch' || !entry.feature.payload?.sketch)
      throw new TypeError('runtime sketch edit: authoritative sketch feature required');
    let nextSketch=sketch.validateSketch(entry.feature.payload.sketch);
    const seen=new Set();
    for (const edit of edits) {
      if (!edit || typeof edit.constraintId!=='string' || !edit.constraintId ||
          seen.has(edit.constraintId) || !edit.patch || typeof edit.patch!=='object' ||
          Array.isArray(edit.patch))
        throw new TypeError('runtime sketch edit: invalid or repeated constraint edit');
      seen.add(edit.constraintId);
      // Do not reproduce SKETCH's constraint-kind rules, tolerance or solver.
      nextSketch=sketch.editConstraint(nextSketch,edit.constraintId,edit.patch);
    }
    const candidate=commit(previous,[{
      eventId,type:'feature.edit',featureId:sketchFeatureId,
      patch:{payload:{...entry.feature.payload,sketch:nextSketch}},
    }],expectedRevision);
    const report=inspect(candidate);
    const state=report.features.find(x=>x.featureId===sketchFeatureId);
    if (!state) throw new Error('runtime sketch edit: candidate feature disappeared');
    if (admission==='require_admissible' && state.status!=='analytic_profile_only')
      return {kind:'refused',code:'inadmissible_sketch',sourceRevision:expectedRevision,
        candidateRevision:report.revision,notCommitted:true,candidateFeature:state,
        reason:'SKETCH did not admit a single solved analytic profile; authoritative history is unchanged'};
    return {kind:'committed',history:candidate,report,
      sketchStatus:state.status,invalidation:diff(previous,candidate)};
  }

  /**
   * Add or delete one or more circular through-holes as one undoable INTENT
   * sketch edit. A real SKETCH solve/profile gate decides admission; no
   * unqualified preview, alternative journal, or native Boolean is created.
   */
  function editPlateHoles(history,request) {
    const {sketchFeatureId,eventId,expectedRevision,operations,
      admission='require_admissible'}=request??{};
    const previous=transactions.parseUndoHistory(history);
    if(!Number.isSafeInteger(expectedRevision)||
        expectedRevision!==previous.document.revision)
      throw new Error('runtime holes: stale or missing expectedRevision');
    if(typeof sketchFeatureId!=='string'||!sketchFeatureId||
        typeof eventId!=='string'||!eventId||
        !['require_admissible','preserve_unresolved'].includes(admission))
      throw new TypeError('runtime holes: sketch/event identity and admission required');
    const entry=model.planProject(previous.document).features.find(
      x=>x.feature.id===sketchFeatureId);
    if(entry?.feature.kind!=='sketch'||!entry.feature.payload?.sketch)
      throw new TypeError('runtime holes: authoritative sketch feature required');
    const original=sketch.validateSketch(entry.feature.payload.sketch);
    const authored=applyPlateHoleOperations(original,operations);
    const nextSketch=sketch.validateSketch(authored);
    const candidate=commit(previous,[{
      eventId,type:'feature.edit',featureId:sketchFeatureId,
      patch:{payload:{...entry.feature.payload,sketch:nextSketch}},
    }],expectedRevision);
    const report=inspect(candidate);
    const state=report.features.find(f=>f.featureId===sketchFeatureId);
    if(!state) throw new Error('runtime holes: edited sketch was not retained');
    const hasAdmittedHoles=state.status==='analytic_profile_only' &&
      state.profile?.holes?.length===nextSketch.circles.length;
    if(admission==='require_admissible'&&!hasAdmittedHoles)
      return {kind:'refused',code:'inadmissible_sketch',
        sourceRevision:expectedRevision,candidateRevision:report.revision,
        notCommitted:true,candidateFeature:state,
        reason:'SKETCH did not admit every circular through-hole; authoritative history unchanged'};
    return {kind:'committed',history:candidate,report,
      sketchStatus:state.status,invalidation:diff(previous,candidate)};
  }

  /** Explicitly delegated, revision-fenced authoritative commands. */
  function commit(history, events, expectedRevision = history.document.revision) {
    return transactions.commitUndoableTransaction(history, events, expectedRevision);
  }
  function editDimensions(history, request) {
    return dimensions.commitUndoableDimensionEditBatch(history, request);
  }
  function undo(history, allocatedEventIds, expectedRevision = history.document.revision) {
    return transactions.undoTransaction(history, allocatedEventIds, expectedRevision);
  }
  function redo(history, allocatedEventIds, expectedRevision = history.document.revision) {
    return transactions.redoTransaction(history, allocatedEventIds, expectedRevision);
  }
  /** Single logical archive unit; caller must implement crash-atomic persistence. */
  function save(history) {
    return archive.serializeModelArchive(archive.createModelArchive(history));
  }
  function reopen(serialized) {
    return archive.deserializeModelArchive(serialized).history;
  }
  return Object.freeze({inspect, diff, commit, editDimensions, editSketchConstraints, editPlateHoles, undo, redo, save, reopen});
}
