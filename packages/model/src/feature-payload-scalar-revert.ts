/**
 * @intuit3d/model/feature-payload-scalar-revert/v1
 *
 * User-selected historical *dimension* recovery within a compound payload.
 * Unlike a whole-payload rollback, this restores only named scalar dimensions
 * while retaining the other authored dimensions and later independent work.
 *
 * A feature.edit replaces its entire payload atomically. Consequently ANY
 * subsequent payload replacement blocks this command, even when its visible
 * numbers match: the journal cannot prove which keys were intentionally
 * reauthored. A newer dependsOn/writeTargets edit is preserved, but kind
 * transitions and removals are not silently reconciled.
 *
 * These are semantic values, not solved sketch dimensions or exact B-rep.
 */
import {
  featuresOf, parseProject, planProject, serializeProject,
  ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type {
  EvaluationPlan, JournalEvent, JsonRecord, ProjectDocument,
} from './index.ts';
import {
  FEATURE_EDIT_FIELD_REVERT_FORMAT, previewFeatureEditFieldRevert,
} from './feature-edit-revert.ts';
import {
  previewTransaction, commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';

export const FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT =
  'intuit3d.feature-payload-scalar-revert' as const;
export const FEATURE_PAYLOAD_SCALAR_REVERT_VERSION = 1 as const;
export interface FeaturePayloadScalarRevertRequest {
  readonly format: typeof FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT;
  readonly version: typeof FEATURE_PAYLOAD_SCALAR_REVERT_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly expectedDocumentFence: string;
  readonly targetEventId: string;
  readonly eventId: string;
  /** 1–16 distinct authored top-level numeric Mm/Deg dimensions. */
  readonly selectedFields: readonly string[];
  readonly admission: 'require_ready' | 'permit_unresolved';
  readonly confirmUnresolved: boolean;
}
export interface FeaturePayloadScalarTransition {
  readonly field: string;
  readonly before: number;
  readonly authored: number;
  readonly current: number;
}
export interface FeaturePayloadScalarRevertPreview {
  readonly format: 'intuit3d.feature-payload-scalar-revert-preview';
  readonly version: 1;
  readonly targetEventId: string;
  readonly featureId: string;
  readonly restored: readonly FeaturePayloadScalarTransition[];
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly regressedReadyFeatureIds: readonly string[];
  readonly invalidatedBodyIds: readonly string[];
  /** Geometric/sketch validation must be performed by real consumers. */
  readonly requiresSketchAdmission: true;
  readonly requiresNativeRebuild: true;
  readonly exactGeometryAuthority: false;
}
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const DIMENSION = /^[A-Za-z][A-Za-z0-9_]{0,60}(Mm|Deg)$/;
const KEYS = [
  'format','version','expectedProjectId','expectedRevision',
  'expectedDocumentFence','targetEventId','eventId','selectedFields',
  'admission','confirmUnresolved',
] as const;
function fail(message: string): never {
  throw new ProjectFormatError('payload scalar revert: ' + message);
}
function plain(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x) &&
    (Object.getPrototypeOf(x) === Object.prototype ||
      Object.getPrototypeOf(x) === null);
}
function validate(x: unknown): asserts x is FeaturePayloadScalarRevertRequest {
  if (!plain(x) || Object.keys(x).length !== KEYS.length ||
      !KEYS.every((key) => Object.hasOwn(x,key)) ||
      x.format !== FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT ||
      x.version !== FEATURE_PAYLOAD_SCALAR_REVERT_VERSION ||
      typeof x.expectedProjectId !== 'string' || !ID.test(x.expectedProjectId) ||
      !Number.isSafeInteger(x.expectedRevision) ||
      (x.expectedRevision as number) < 0 ||
      typeof x.expectedDocumentFence !== 'string' ||
      typeof x.targetEventId !== 'string' || !ID.test(x.targetEventId) ||
      typeof x.eventId !== 'string' || !ID.test(x.eventId) ||
      !Array.isArray(x.selectedFields) ||
      x.selectedFields.length < 1 || x.selectedFields.length > 16 ||
      x.selectedFields.some((key: unknown) =>
        typeof key !== 'string' || !DIMENSION.test(key)) ||
      new Set(x.selectedFields).size !== x.selectedFields.length ||
      (x.admission !== 'require_ready' && x.admission !== 'permit_unresolved') ||
      typeof x.confirmUnresolved !== 'boolean') {
    fail('invalid versioned request, dimension selection or source fence');
  }
}
function bound(payload: JsonRecord, field: string): boolean {
  const entries = payload.dimensionBindings;
  if (entries === undefined) return false;
  // Unknown binding manifests are not evidence that a scalar is freely
  // authored. A formula-bound effective value needs parameter editing.
  if (!plain(entries) || !Array.isArray(entries.entries)) return true;
  return entries.entries.some((item: unknown) =>
    !plain(item) || item.field === field);
}
/**
 * Reconstruct historical source values using the accepted whole-payload
 * provenance and overlap guard. The guard deliberately refuses ANY subsequent
 * payload edit; it cannot attribute intent to nested fields after a replacement.
 *
 * The actual proposed event is narrower: it restores selected numeric fields,
 * then independently evaluates readiness and downstream invalidation.
 */
export function previewFeaturePayloadScalarRevert(
  input: ProjectDocument, request: FeaturePayloadScalarRevertRequest,
): FeaturePayloadScalarRevertPreview {
  validate(request);
  const source = parseProject(input);
  if (source.projectId !== request.expectedProjectId ||
      source.revision !== request.expectedRevision ||
      serializeProject(source) !== request.expectedDocumentFence) {
    throw new ProjectRevisionError('payload scalar revert: stale or divergent journal');
  }
  const target = source.journal.find((event) =>
    event.eventId === request.targetEventId);
  if (!target || target.type !== 'feature.edit' ||
      !Object.hasOwn(target.patch, 'payload')) {
    fail('selected historical event did not author a payload');
  }
  // Kind-changing compound edits cannot be split into unrelated dimensions.
  // Delegate source chronology, lifecycle and subsequent overlap checks to
  // the accepted history engine; it also enforces fresh event identity.
  const historical = previewFeatureEditFieldRevert(source, {
    format: FEATURE_EDIT_FIELD_REVERT_FORMAT, version: 1,
    expectedProjectId: request.expectedProjectId,
    expectedRevision: request.expectedRevision,
    expectedDocumentFence: request.expectedDocumentFence,
    targetEventId: request.targetEventId, eventId: request.eventId,
    admission: 'permit_unresolved', confirmUnresolved: true,
    selectedFields: ['payload'],
  });
  if (historical.event.type !== 'feature.edit' ||
      !historical.event.patch.payload || !target.patch.payload) {
    fail('historical payload reconstruction was not available');
  }
  const before = historical.event.patch.payload;
  const authored = target.patch.payload;
  const feature = featuresOf(source).find((f) => f.id === target.featureId);
  if (!feature) fail('edited feature is no longer living');
  const current = feature.payload;
  const restored: FeaturePayloadScalarTransition[] = [];
  for (const field of request.selectedFields) {
    if (!Object.hasOwn(before,field) || !Object.hasOwn(authored,field) ||
        !Object.hasOwn(current,field) ||
        typeof before[field] !== 'number' ||
        typeof authored[field] !== 'number' ||
        typeof current[field] !== 'number' ||
        before[field] === authored[field] ||
        current[field] !== authored[field]) {
      fail('selected dimension was not changed to a living numeric value: ' + field);
    }
    if (bound(before as JsonRecord,field) ||
        bound(authored as JsonRecord,field) ||
        bound(current as JsonRecord,field)) {
      fail('dimension is parameter-bound; edit its authoritative parameter: ' + field);
    }
    restored.push({
      field, before: before[field] as number,
      authored: authored[field] as number,
      current: current[field] as number,
    });
  }
  const payload: JsonRecord = { ...current };
  for (const item of restored) payload[item.field] = item.before;
  const step = previewTransaction(source,[{
    type:'feature.edit',eventId:request.eventId,
    featureId:feature.id,patch:{payload},
  }],source.revision);
  const oldPlan=planProject(source);
  const nextStates=new Map(step.plan.features.map((row)=>
    [row.feature.id,row.status] as const));
  const invalidation=planIncrementalEvaluation(source,step.document);
  const affected=new Set(invalidation.invalidatedFeatureIds);
  const regressed=oldPlan.features.filter((row)=>
    row.status==='ready' && nextStates.get(row.feature.id)!=='ready')
    .map((row)=>row.feature.id);
  if (regressed.some((id)=>!affected.has(id))) {
    fail('selected dimension reversion regresses unrelated ready features');
  }
  if (request.admission==='require_ready' &&
      (nextStates.get(feature.id)!=='ready' || regressed.length)) {
    fail('selected dimension reversion leaves ready intent unresolved');
  }
  if (regressed.length && !request.confirmUnresolved) {
    fail('explicit confirmation required for unresolved downstream intent');
  }
  const bodies=new Set<string>();
  for(const doc of [source,step.document]) {
    for(const writer of featuresOf(doc)) {
      if (!affected.has(writer.id) ||
          (writer.kind!=='cut' && writer.kind!=='extrude')) continue;
      for(const id of writer.writeTargets) bodies.add(id);
    }
  }
  return {
    format:'intuit3d.feature-payload-scalar-revert-preview',version:1,
    targetEventId:request.targetEventId,featureId:feature.id,restored,
    event:step.document.journal[step.document.journal.length-1]!,
    document:step.document,plan:step.plan,invalidation,
    regressedReadyFeatureIds:regressed,invalidatedBodyIds:[...bodies],
    requiresSketchAdmission:true,requiresNativeRebuild:true,
    exactGeometryAuthority:false,
  };
}
/** One compensated edit and one durable undo frame, never a journal rewrite. */
export function commitUndoableFeaturePayloadScalarRevert(
  input: UndoHistory, request: FeaturePayloadScalarRevertRequest,
): UndoHistory {
  const history=parseUndoHistory(input);
  const preview=previewFeaturePayloadScalarRevert(history.document,request);
  return commitUndoableTransaction(history,[preview.event],request.expectedRevision);
}
