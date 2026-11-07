/**
 * @intuit3d/model/body-cut-chain/v1
 *
 * Append another explicitly selected, dependency-ordered cut to an existing
 * semantic body. The authored journal, not chronology, establishes ordering.
 * A cut is structurally ready only; SKETCH/RUNTIME must admit the selected
 * profile and a real native provider must independently evaluate its Boolean.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type {
  EvaluationPlan, Feature, FeatureStatus, JournalEvent, ProjectDocument,
} from './index.ts';
import {
  commitUndoableTransaction, parseUndoHistory, previewTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';

export const BODY_CUT_CHAIN_FORMAT = 'intuit3d.body-cut-chain' as const;
export const BODY_CUT_CHAIN_VERSION = 1 as const;

export type BodyCutExtent =
  | { readonly kind: 'through_all' }
  | { readonly kind: 'blind'; readonly depthMm: number };

export interface BodyCutAppendRequest {
  readonly format: typeof BODY_CUT_CHAIN_FORMAT;
  readonly version: typeof BODY_CUT_CHAIN_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly eventId: string;
  readonly cutFeatureId: string;
  /** Explicit semantic body; no selected viewport solid or face index. */
  readonly targetBodyId: string;
  /** Explicit currently-terminal writer: extrusion or an existing body cut. */
  readonly afterBodyWriterId: string;
  /** A separately authored or future SKETCH; never an inferred loop. */
  readonly sourceSketchId: string;
  /** Candidate returned by the SKETCH discovery contract; re-admit in consumer. */
  readonly profileCandidateId: string;
  readonly extent: BodyCutExtent;
  /** If permitted, an absent future sketch stays pending instead of fabricated. */
  readonly admission: 'require_ready' | 'permit_unresolved';
}

export interface BodyCutChainInspection {
  readonly format: 'intuit3d.body-cut-chain-inspection';
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly bodyId: string;
  readonly bodyWriterIds: readonly string[];
  /** Unique active dependency-terminal writer, or null on ambiguity/error. */
  readonly eligibleAfterWriterId: string | null;
  readonly status: 'ready' | 'unavailable';
  readonly diagnostic: string | null;
}

export interface BodyCutAppendPreview {
  readonly format: 'intuit3d.body-cut-append-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly bodyId: string;
  readonly cutFeatureId: string;
  /** This is planner admissibility, NOT Boolean/STEP success. */
  readonly semanticStatus: FeatureStatus;
  readonly exactGeometryAuthority: false;
  readonly requiresNativeRebuild: true;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(reason: string): never {
  throw new ProjectFormatError('body cut chain: ' + reason);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field)) &&
    Object.keys(value).every((field) => fields.includes(field));
}
function id(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) fail('invalid ' + label);
}
function isBodyWriter(feature: Feature, bodyId: string): boolean {
  return feature.writeTargets.length === 1 &&
    feature.writeTargets[0] === bodyId &&
    (feature.kind === 'extrude' ||
      (feature.kind === 'cut' && feature.payload.targetBodyId === bodyId));
}
function ancestors(byId: ReadonlyMap<string, Feature>, source: string): Set<string> {
  const found = new Set<string>(), pending = [source];
  while (pending.length) {
    const current = pending.pop()!;
    for (const upstream of byId.get(current)?.dependsOn ?? []) {
      if (found.has(upstream)) continue;
      found.add(upstream);
      if (byId.has(upstream)) pending.push(upstream);
    }
  }
  return found;
}

/**
 * Read-only terminal-body selection for a timeline/inspector.
 *
 * All active body writers must be ordered by real dependency edges ending at
 * ONE ready, supported terminal. A chronological last writer is insufficient.
 * Other body writers, unordered cuts, fillets and pending tails are not guessed.
 */
export function inspectBodyCutChain(
  input: ProjectDocument, bodyId: string,
): BodyCutChainInspection {
  const document = parseProject(input);
  id(bodyId, 'target body ID');
  const features = featuresOf(document);
  const writers = features.filter((feature) => feature.writeTargets.includes(bodyId));
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const plan = planProject(document);
  const states = new Map(plan.features.map((state) => [state.feature.id, state.status]));
  const candidates = writers.filter((feature) => {
    if (!isBodyWriter(feature, bodyId) || states.get(feature.id) !== 'ready') return false;
    const before = ancestors(byId, feature.id);
    return writers.every((writer) => writer.id === feature.id || before.has(writer.id));
  });
  const eligible = candidates.length === 1 ? candidates[0]!.id : null;
  const diagnostic = !writers.length
    ? 'no active semantic body producer'
    : eligible === null
      ? 'body writers have no single ready, explicitly ordered cut/extrusion terminal'
      : null;
  return {
    format: 'intuit3d.body-cut-chain-inspection', version: 1,
    projectId: document.projectId, revision: document.revision, bodyId,
    bodyWriterIds: writers.map((feature) => feature.id),
    eligibleAfterWriterId: eligible, status: eligible ? 'ready' : 'unavailable',
    diagnostic,
  };
}

/**
 * Stage one downstream cut with an explicit dependency on the selected body
 * writer and on its SKETCH source. The latter can be a future reference only
 * under permit_unresolved. All previously ready features must remain ready.
 *
 * This contract does not validate sketch loops, intersect solids, perform
 * an OCCT Boolean, or claim that a cached STEP file still matches the revision.
 */
export function previewBodyCutAppend(
  input: ProjectDocument, request: BodyCutAppendRequest,
): BodyCutAppendPreview {
  const document = parseProject(input);
  if (!plain(request) || !exact(request, [
    'format','version','expectedProjectId','expectedRevision','eventId',
    'cutFeatureId','targetBodyId','afterBodyWriterId','sourceSketchId',
    'profileCandidateId','extent','admission',
  ]) || request.format !== BODY_CUT_CHAIN_FORMAT ||
      request.version !== BODY_CUT_CHAIN_VERSION ||
      (request.admission !== 'require_ready' && request.admission !== 'permit_unresolved')) {
    fail('unsupported request format or fields');
  }
  id(request.expectedProjectId, 'expected project ID');
  id(request.eventId, 'event ID');
  id(request.cutFeatureId, 'new cut feature ID');
  id(request.targetBodyId, 'target body ID');
  id(request.afterBodyWriterId, 'preceding body writer ID');
  id(request.sourceSketchId, 'source sketch ID');
  if (typeof request.profileCandidateId !== 'string' ||
      !request.profileCandidateId.startsWith('cycle:') ||
      request.profileCandidateId.length > 8192) {
    fail('explicit discovered sketch profile candidate required');
  }
  if (!plain(request.extent) ||
      !((exact(request.extent, ['kind']) && request.extent.kind === 'through_all') ||
        (exact(request.extent, ['kind', 'depthMm']) &&
         request.extent.kind === 'blind' &&
         typeof request.extent.depthMm === 'number' &&
         Number.isFinite(request.extent.depthMm) && request.extent.depthMm > 0))) {
    fail('cut extent must be through_all or a positive finite blind depth in mm');
  }
  if (request.expectedProjectId !== document.projectId ||
      request.expectedRevision !== document.revision) {
    throw new ProjectRevisionError('body cut chain: stale project or revision');
  }
  if (new Set([request.cutFeatureId, request.targetBodyId,
    request.afterBodyWriterId, request.sourceSketchId]).size !== 4) {
    fail('cut, body, writer and sketch identities must be distinct');
  }
  const chain = inspectBodyCutChain(document, request.targetBodyId);
  if (chain.eligibleAfterWriterId !== request.afterBodyWriterId) {
    fail('explicit body writer is not the unique ready terminal: ' +
      (chain.diagnostic ?? request.afterBodyWriterId));
  }
  const features = featuresOf(document);
  const sketch = features.find((feature) => feature.id === request.sourceSketchId);
  if (sketch && sketch.kind !== 'sketch') fail('selected source must be a SKETCH feature');
  if (!sketch && request.admission === 'require_ready') {
    fail('selected source sketch does not exist');
  }
  // Do not rely only on active IDs; removed IDs also cannot be recreated.
  const extentPayload = request.extent.kind === 'through_all'
    ? { throughAll: true }
    : { throughAll: false, depthMm: request.extent.depthMm };
  const event: JournalEvent = {
    eventId: request.eventId, type: 'feature.create',
    feature: {
      id: request.cutFeatureId, kind: 'cut',
      dependsOn: [request.afterBodyWriterId, request.sourceSketchId],
      writeTargets: [request.targetBodyId],
      payload: {
        sourceSketchId: request.sourceSketchId,
        targetBodyId: request.targetBodyId,
        profileCandidateId: request.profileCandidateId,
        units: 'mm', frame: 'local_xy', ...extentPayload,
      },
    },
  };
  const prior = planProject(document);
  const staged = previewTransaction(document, [event], document.revision);
  const nextStates = new Map(staged.plan.features.map((state) =>
    [state.feature.id, state.status]));
  const semanticStatus = nextStates.get(request.cutFeatureId)!;
  if (request.admission === 'require_ready' && semanticStatus !== 'ready') {
    fail('new cut is not dependency-ready: ' + semanticStatus);
  }
  for (const row of prior.features) {
    if (row.status === 'ready' && nextStates.get(row.feature.id) !== 'ready') {
      fail('appended cut regresses previously ready feature: ' + row.feature.id);
    }
  }
  return {
    format: 'intuit3d.body-cut-append-preview', version: 1,
    event: staged.document.journal[staged.document.journal.length - 1]!,
    document: staged.document, plan: staged.plan,
    invalidation: planIncrementalEvaluation(document, staged.document),
    cutFeatureId: request.cutFeatureId, bodyId: request.targetBodyId,
    semanticStatus, exactGeometryAuthority: false, requiresNativeRebuild: true,
  };
}

/** Commit one cut as one revision-fenced undo frame. */
export function commitUndoableBodyCutAppend(
  input: UndoHistory, request: BodyCutAppendRequest,
): UndoHistory {
  const history = parseUndoHistory(input);
  const preview = previewBodyCutAppend(history.document, request);
  return commitUndoableTransaction(history, [preview.event], request.expectedRevision);
}
