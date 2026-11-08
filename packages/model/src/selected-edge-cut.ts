/**
 * @intuit3d/model/selected-edge-cut/v1
 *
 * Author a named cut on ONE explicitly chosen body, positioned relative to
 * an explicitly chosen semantic EDGE of the same or another named body.
 * The reference, writer provenance and dependency are persistent journal
 * intent. MODEL cannot discover the edge, infer a drill centre, or declare
 * a Boolean/STEP exact; SKETCH, RUNTIME and KERNEL must admit those separately.
 *
 * An absent/changed source role stays pending until provider evidence or an
 * explicit rebind. No kernel enumeration, cached tessellation or topology
 * observation is written into the project archive.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type {
  EvaluationPlan, Feature, FeatureStatus, JournalEvent, ProjectDocument, JsonValue,
} from './index.ts';
import {
  previewTransaction, commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import {
  BODY_CUT_CHAIN_FORMAT, inspectBodyCutChain, previewBodyCutAppend,
} from './body-cut-chain.ts';
import type { BodyCutAppendRequest } from './body-cut-chain.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import {
  parseSemanticTopologyReference,
} from './topology.ts';
import type { SemanticTopologyReference, TopologySnapshot, TopologyStep } from './topology.ts';
import { assessSemanticSelection } from './semantic-selection.ts';
import type { SemanticSelectionAssessment } from './semantic-selection.ts';

export const SELECTED_EDGE_CUT_FORMAT = 'intuit3d.selected-edge-cut' as const;
export const SELECTED_EDGE_CUT_REBIND_FORMAT = 'intuit3d.selected-edge-cut-rebind' as const;
export const SELECTED_EDGE_CUT_VERSION = 1 as const;

export interface EdgeSource {
  readonly bodyId: string;
  /** Explicit dependency-terminal producer of the selected source body. */
  readonly bodyWriterId: string;
  readonly reference: SemanticTopologyReference;
}
export interface SelectedEdgeCutRequest {
  readonly format: typeof SELECTED_EDGE_CUT_FORMAT;
  readonly version: typeof SELECTED_EDGE_CUT_VERSION;
  /** Accepted body-cut-chain/v1 input; the selected edge does NOT replace its sketch. */
  readonly cut: BodyCutAppendRequest;
  readonly origin: EdgeSource;
}
export interface SelectedEdgeCutRebindRequest {
  readonly format: typeof SELECTED_EDGE_CUT_REBIND_FORMAT;
  readonly version: typeof SELECTED_EDGE_CUT_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly eventId: string;
  readonly cutFeatureId: string;
  readonly targetBodyId: string;
  /** Guards against an obsolete inspector or another user's re-attachment. */
  readonly expectedSourceBodyId: string;
  readonly expectedSourceWriterId: string;
  readonly expectedReference: SemanticTopologyReference;
  readonly origin: EdgeSource;
  /**
   * Explicit authority to detach ONLY the old edge writer dependency.
   * When false it remains an authored dependency even if no longer selected.
   */
  readonly releasePreviousSourceDependency: boolean;
  readonly admission: 'require_ready' | 'permit_unresolved';
}
export interface SelectedEdgeCutPreview {
  readonly format: 'intuit3d.selected-edge-cut-preview';
  readonly version: 1;
  readonly document: ProjectDocument;
  readonly events: readonly JournalEvent[];
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly cutFeatureId: string;
  readonly targetBodyId: string;
  readonly sourceBodyId: string;
  readonly semanticStatus: FeatureStatus;
  /** An edge reference is NOT a solved drill placement without fresh provenance. */
  readonly requiresEdgeEvidence: true;
  readonly requiresSketchAdmission: true;
  readonly requiresNativeRebuild: true;
  readonly exactGeometryAuthority: false;
}
export interface SelectedEdgeCutInspection {
  readonly format: 'intuit3d.selected-edge-cut-inspection';
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly cutFeatureId: string;
  readonly targetBodyId: string;
  readonly sourceBodyId: string;
  readonly sourceBodyWriterId: string;
  readonly reference: SemanticTopologyReference;
  readonly modelStatus: FeatureStatus;
  readonly sourceStatus: 'current_terminal' | 'changed_or_unavailable';
  readonly selection: SemanticSelectionAssessment;
  /** 'candidate' is an observed role ONLY, not admissible native placement. */
  readonly placementStatus: 'pending_source' | 'pending_evidence' |
    'candidate' | 'requires_reconciliation' | 'deleted' | 'pending_model';
  readonly exactGeometryAuthority: false;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(message: string): never {
  throw new ProjectFormatError('selected edge cut: ' + message);
}
function plain(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}
function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return plain(value) && Object.keys(value).length === fields.length &&
    fields.every((key) => Object.hasOwn(value, key));
}
function id(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) fail('invalid ' + name);
}
function checkRevision(doc: ProjectDocument, projectId: string, revision: number): void {
  if (doc.projectId !== projectId || doc.revision !== revision) {
    throw new ProjectRevisionError('selected edge cut: stale project/revision');
  }
}
function sameReference(a: SemanticTopologyReference, b: SemanticTopologyReference): boolean {
  return a.projectId === b.projectId && a.atRevision === b.atRevision &&
    a.anchor.featureId === b.anchor.featureId &&
    a.anchor.roleId === b.anchor.roleId && a.anchor.kind === b.anchor.kind;
}
function validateOrigin(doc: ProjectDocument, input: unknown): EdgeSource {
  if (!exact(input, ['bodyId', 'bodyWriterId', 'reference'])) fail('unsupported edge source');
  id(input.bodyId, 'source body ID');
  id(input.bodyWriterId, 'source body writer ID');
  const ref = parseSemanticTopologyReference(input.reference);
  if (ref.projectId !== doc.projectId || ref.atRevision > doc.revision ||
      ref.anchor.kind !== 'edge' || ref.anchor.featureId !== input.bodyWriterId) {
    fail('edge anchor must name the selected body writer, project and existing revision');
  }
  const sourceAtAnchor = parseProject({
    ...doc, revision: ref.atRevision,
    journal: doc.journal.slice(0, ref.atRevision),
  });
  const producer = featuresOf(sourceAtAnchor).find((feature) =>
    feature.id === input.bodyWriterId && feature.writeTargets.includes(input.bodyId as string));
  if (!producer) fail('edge source writer did not produce the named body at anchor revision');
  const chain = inspectBodyCutChain(doc, input.bodyId);
  if (chain.eligibleAfterWriterId !== input.bodyWriterId) {
    fail('edge source is not the unique ready terminal of its named body');
  }
  return {
    bodyId: input.bodyId as string,
    bodyWriterId: input.bodyWriterId as string,
    reference: ref,
  };
}
function selectedCut(doc: ProjectDocument, cutId: string, bodyId: string): Feature {
  id(cutId, 'cut feature ID');
  id(bodyId, 'target body ID');
  const cut = featuresOf(doc).find((feature) => feature.id === cutId);
  if (!cut || cut.kind !== 'cut' || cut.writeTargets.length !== 1 ||
      cut.writeTargets[0] !== bodyId || cut.payload.targetBodyId !== bodyId ||
      typeof cut.payload.sourceSketchId !== 'string' ||
      !cut.dependsOn.includes(cut.payload.sourceSketchId) ||
      typeof cut.payload.edgeSourceBodyId !== 'string' ||
      typeof cut.payload.edgeSourceWriterId !== 'string' ||
      !cut.dependsOn.includes(cut.payload.edgeSourceWriterId)) {
    fail('cut lacks the explicit target, sketch or selected edge source lineage');
  }
  const reference = parseSemanticTopologyReference(cut.payload.selectedEdge);
  if (reference.projectId !== doc.projectId || reference.anchor.kind !== 'edge' ||
      reference.anchor.featureId !== cut.payload.edgeSourceWriterId) {
    fail('cut has invalid persisted selected edge source');
  }
  return cut;
}
function stagedResult(
  previous: ProjectDocument, document: ProjectDocument,
  cutId: string, targetBodyId: string, sourceBodyId: string,
): SelectedEdgeCutPreview {
  const plan = planProject(document);
  const status = plan.features.find((row) => row.feature.id === cutId)?.status;
  if (!status) fail('selected cut was lost during replay');
  return {
    format: 'intuit3d.selected-edge-cut-preview', version: 1,
    document, events: document.journal.slice(previous.revision), plan,
    invalidation: planIncrementalEvaluation(previous, document),
    cutFeatureId: cutId, targetBodyId, sourceBodyId,
    semanticStatus: status, requiresEdgeEvidence: true,
    requiresSketchAdmission: true, requiresNativeRebuild: true,
    exactGeometryAuthority: false,
  };
}
/**
 * One atomic event and undo frame. First reuse the existing body-chain
 * admission (ordered writer, named sketch, candidate and extent), then add
 * the selected edge writer dependency and immutable authored reference.
 */
export function previewSelectedEdgeCut(
  source: ProjectDocument, request: SelectedEdgeCutRequest,
): SelectedEdgeCutPreview {
  const doc = parseProject(source);
  if (!exact(request, ['format', 'version', 'cut', 'origin']) ||
      request.format !== SELECTED_EDGE_CUT_FORMAT ||
      request.version !== SELECTED_EDGE_CUT_VERSION ||
      !plain(request.cut) || request.cut.format !== BODY_CUT_CHAIN_FORMAT) {
    fail('unsupported selected edge cut request');
  }
  checkRevision(doc, request.cut.expectedProjectId, request.cut.expectedRevision);
  const origin = validateOrigin(doc, request.origin);
  const base = previewBodyCutAppend(doc, request.cut);
  const created = base.event;
  if (created.type !== 'feature.create') fail('expected authored cut creation');
  const feature: Feature = {
    ...created.feature,
    dependsOn: [...new Set([...created.feature.dependsOn, origin.bodyWriterId])],
    payload: {
      ...created.feature.payload,
      edgeSourceBodyId: origin.bodyId,
      edgeSourceWriterId: origin.bodyWriterId,
      selectedEdge: origin.reference as unknown as JsonValue,
    },
  };
  const staged = previewTransaction(doc, [{
    eventId: created.eventId, type: 'feature.create', feature,
  }], doc.revision);
  const status = staged.plan.features.find((row) => row.feature.id === feature.id)?.status;
  if (request.cut.admission === 'require_ready' && status !== 'ready') {
    fail('new selected edge cut is not dependency-ready: ' + status);
  }
  const before = new Map(planProject(doc).features.map((entry) =>
    [entry.feature.id, entry.status] as const));
  for (const row of staged.plan.features) {
    if (before.get(row.feature.id) === 'ready' && row.status !== 'ready') {
      fail('new cut regressed a formerly ready feature: ' + row.feature.id);
    }
  }
  return stagedResult(doc, staged.document, request.cut.cutFeatureId,
    request.cut.targetBodyId, origin.bodyId);
}
export function commitUndoableSelectedEdgeCut(
  source: UndoHistory, request: SelectedEdgeCutRequest,
): UndoHistory {
  const history = parseUndoHistory(source);
  const preview = previewSelectedEdgeCut(history.document, request);
  return commitUndoableTransaction(history, preview.events, request.cut.expectedRevision);
}
/**
 * One edit event to rebind a deleted/split edge to an explicitly chosen body
 * writer and role. Refuse stale source fences and never infer an old dependency
 * can be removed: release must be explicitly requested and must not detach the
 * cut's target body predecessor, sketch or another referenced topology role.
 */
export function previewSelectedEdgeCutRebind(
  source: ProjectDocument, request: SelectedEdgeCutRebindRequest,
): SelectedEdgeCutPreview {
  const doc = parseProject(source);
  if (!exact(request, [
    'format', 'version', 'expectedProjectId', 'expectedRevision', 'eventId',
    'cutFeatureId', 'targetBodyId', 'expectedSourceBodyId',
    'expectedSourceWriterId', 'expectedReference', 'origin',
    'releasePreviousSourceDependency', 'admission',
  ]) || request.format !== SELECTED_EDGE_CUT_REBIND_FORMAT ||
      request.version !== SELECTED_EDGE_CUT_VERSION ||
      typeof request.releasePreviousSourceDependency !== 'boolean' ||
      !['require_ready', 'permit_unresolved'].includes(String(request.admission))) {
    fail('unsupported selected edge rebind');
  }
  checkRevision(doc, request.expectedProjectId, request.expectedRevision);
  id(request.eventId, 'rebind event ID');
  id(request.expectedSourceBodyId, 'expected source body ID');
  id(request.expectedSourceWriterId, 'expected source writer ID');
  const cut = selectedCut(doc, request.cutFeatureId, request.targetBodyId);
  const old = parseSemanticTopologyReference(cut.payload.selectedEdge);
  const expected = parseSemanticTopologyReference(request.expectedReference);
  if (!sameReference(old, expected) ||
      cut.payload.edgeSourceBodyId !== request.expectedSourceBodyId ||
      cut.payload.edgeSourceWriterId !== request.expectedSourceWriterId) {
    throw new ProjectRevisionError('selected edge cut: source selection changed');
  }
  const origin = validateOrigin(doc, request.origin);
  if (origin.bodyId === request.expectedSourceBodyId &&
      origin.bodyWriterId === request.expectedSourceWriterId &&
      sameReference(origin.reference, old)) {
    fail('selected edge rebind must change the authored source');
  }
  const deps = cut.dependsOn.filter((dependency) => {
    if (dependency !== request.expectedSourceWriterId ||
        !request.releasePreviousSourceDependency) return true;
    if (dependency === cut.payload.sourceSketchId) {
      fail('cannot release cut sketch dependency');
    }
    const bodyChain = inspectBodyCutChain(doc, request.targetBodyId);
    if (bodyChain.bodyWriterIds.includes(dependency)) {
      fail('cannot release a target body writer dependency');
    }
    for (const [key, value] of Object.entries(cut.payload)) {
      if (key === 'selectedEdge' || !plain(value) ||
          value.format !== 'intuit3d.semantic-topology-reference') continue;
      const other = parseSemanticTopologyReference(value);
      if (other.anchor.featureId === dependency) {
        fail('old source is still targeted by another authored selection');
      }
    }
    return false;
  });
  if (!deps.includes(origin.bodyWriterId)) deps.push(origin.bodyWriterId);
  const event: JournalEvent = {
    eventId: request.eventId, type: 'feature.edit',
    featureId: cut.id, patch: {
      dependsOn: deps,
      payload: {
        ...cut.payload,
        edgeSourceBodyId: origin.bodyId,
        edgeSourceWriterId: origin.bodyWriterId,
        selectedEdge: origin.reference as unknown as JsonValue,
      },
    },
  };
  const staged = previewTransaction(doc, [event], doc.revision);
  const status = staged.plan.features.find((entry) =>
    entry.feature.id === cut.id)?.status;
  if (request.admission === 'require_ready' && status !== 'ready') {
    fail('rebound cut is not dependency-ready: ' + status);
  }
  const before = new Map(planProject(doc).features.map((entry) =>
    [entry.feature.id, entry.status] as const));
  for (const row of staged.plan.features) {
    if (before.get(row.feature.id) === 'ready' && row.status !== 'ready') {
      fail('rebind regressed a formerly ready feature: ' + row.feature.id);
    }
  }
  return stagedResult(doc, staged.document, cut.id, request.targetBodyId, origin.bodyId);
}
export function commitUndoableSelectedEdgeCutRebind(
  source: UndoHistory, request: SelectedEdgeCutRebindRequest,
): UndoHistory {
  const history = parseUndoHistory(source);
  const preview = previewSelectedEdgeCutRebind(history.document, request);
  return commitUndoableTransaction(history, preview.events, request.expectedRevision);
}

/**
 * Report independent model/edge-provider readiness. A model 'ready' cut is
 * NEVER a claim that a drill centre, B-rep Boolean, or STEP export exists.
 * Fresh complete topology evidence must be supplied for a candidate edge.
 */
export function inspectSelectedEdgeCut(
  source: ProjectDocument, cutFeatureId: string, targetBodyId: string,
  evidence?: { readonly snapshot: TopologySnapshot; readonly steps: readonly TopologyStep[] },
): SelectedEdgeCutInspection {
  const doc = parseProject(source);
  const cut = selectedCut(doc, cutFeatureId, targetBodyId);
  const sourceBodyId = cut.payload.edgeSourceBodyId as string;
  const sourceBodyWriterId = cut.payload.edgeSourceWriterId as string;
  const chain = inspectBodyCutChain(doc, sourceBodyId);
  const selection = assessSemanticSelection(doc, cutFeatureId, 'selectedEdge', evidence);
  const sourceStatus = chain.eligibleAfterWriterId === sourceBodyWriterId
    ? 'current_terminal' : 'changed_or_unavailable';
  return {
    format:'intuit3d.selected-edge-cut-inspection', version:1,
    projectId:doc.projectId, revision:doc.revision, cutFeatureId,targetBodyId,
    sourceBodyId, sourceBodyWriterId,
    reference:parseSemanticTopologyReference(cut.payload.selectedEdge),
    modelStatus:planProject(doc).features.find((state) =>
      state.feature.id === cutFeatureId)!.status,
    sourceStatus, selection,
    placementStatus:sourceStatus !== 'current_terminal'
      ? 'pending_source' : selection.status === 'unselected'
        ? 'pending_evidence' : selection.status,
    exactGeometryAuthority:false,
  };
}
