/**
 * @intuit3d/model/feature-history-batch/v1
 *
 * One engineer-reviewed compensation of 2–8 different historical features.
 * Each selection is individually provenance-checked against the SAME exact
 * source document. Only then are all inverse edits staged atomically and the
 * combined dependency/invalidation/consent outcome evaluated.
 *
 * This is semantic intent, never solved SKETCH or native B-rep authority.
 */
import {
  featuresOf, deserializeProject, parseProject, planProject, serializeProject,
  ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type {
  EvaluationPlan, FeaturePatch, JournalEvent, ProjectDocument,
} from './index.ts';
import {
  FEATURE_EDIT_FIELD_REVERT_FORMAT, previewFeatureEditFieldRevert,
} from './feature-edit-revert.ts';
import {
  FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT, previewFeaturePayloadScalarRevert,
} from './feature-payload-scalar-revert.ts';
import {
  previewTransaction, commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';

export const FEATURE_HISTORY_BATCH_FORMAT = 'intuit3d.feature-history-batch' as const;
export const FEATURE_HISTORY_BATCH_VERSION = 1 as const;
export type FeatureHistoryBatchSelection =
  | {
    readonly kind: 'fields';
    readonly targetEventId: string;
    readonly eventId: string;
    readonly selectedFields: readonly (keyof FeaturePatch)[];
  }
  | {
    readonly kind: 'scalars';
    readonly targetEventId: string;
    readonly eventId: string;
    readonly selectedFields: readonly string[];
  };
export interface FeatureHistoryBatchRequest {
  readonly format: typeof FEATURE_HISTORY_BATCH_FORMAT;
  readonly version: typeof FEATURE_HISTORY_BATCH_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly expectedDocumentFence: string;
  readonly admission: 'require_ready' | 'permit_unresolved';
  readonly confirmUnresolved: boolean;
  /** One fresh event ID per distinct feature, 2–8 features, caller order. */
  readonly selections: readonly FeatureHistoryBatchSelection[];
}
export interface FeatureHistoryBatchSelectionResult {
  readonly kind: FeatureHistoryBatchSelection['kind'];
  readonly targetEventId: string;
  readonly featureId: string;
  readonly eventId: string;
  readonly selectedFields: readonly string[];
}
export interface FeatureHistoryBatchPreview {
  readonly format: 'intuit3d.feature-history-batch-preview';
  readonly version: 1;
  readonly selections: readonly FeatureHistoryBatchSelectionResult[];
  readonly events: readonly JournalEvent[];
  readonly document: ProjectDocument;
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly regressedReadyFeatureIds: readonly string[];
  readonly invalidatedBodyIds: readonly string[];
  readonly unaffectedReadyFeatureIds: readonly string[];
  readonly requiresSketchAdmission: true;
  readonly requiresNativeRebuild: true;
  readonly exactGeometryAuthority: false;
}
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const FIELD_NAMES = ['kind', 'dependsOn', 'writeTargets', 'payload'] as const;
const DIMENSION = /^[A-Za-z][A-Za-z0-9_]{0,60}(Mm|Deg)$/;
const KEYS = [
  'format', 'version', 'expectedProjectId', 'expectedRevision',
  'expectedDocumentFence', 'admission', 'confirmUnresolved', 'selections',
] as const;
function fail(message: string): never {
  throw new ProjectFormatError('feature history batch: ' + message);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
function validate(value: unknown): asserts value is FeatureHistoryBatchRequest {
  if (!plain(value) || !exactKeys(value, KEYS) ||
      value.format !== FEATURE_HISTORY_BATCH_FORMAT ||
      value.version !== FEATURE_HISTORY_BATCH_VERSION ||
      typeof value.expectedProjectId !== 'string' || !ID.test(value.expectedProjectId) ||
      !Number.isSafeInteger(value.expectedRevision) ||
      (value.expectedRevision as number) < 0 ||
      typeof value.expectedDocumentFence !== 'string' ||
      (value.admission !== 'require_ready' && value.admission !== 'permit_unresolved') ||
      typeof value.confirmUnresolved !== 'boolean' ||
      !Array.isArray(value.selections) ||
      value.selections.length < 2 || value.selections.length > 8) {
    fail('invalid versioned request, source fence or selection count');
  }
  const targets = new Set<string>();
  const events = new Set<string>();
  for (const entry of value.selections) {
    if (!plain(entry) ||
        !exactKeys(entry, ['kind','targetEventId','eventId','selectedFields']) ||
        (entry.kind !== 'fields' && entry.kind !== 'scalars') ||
        typeof entry.targetEventId !== 'string' || !ID.test(entry.targetEventId) ||
        typeof entry.eventId !== 'string' || !ID.test(entry.eventId) ||
        entry.targetEventId === entry.eventId ||
        !Array.isArray(entry.selectedFields) ||
        entry.selectedFields.length < 1 ||
        entry.selectedFields.length > (entry.kind === 'fields' ? 4 : 16) ||
        new Set(entry.selectedFields).size !== entry.selectedFields.length ||
        entry.selectedFields.some((field: unknown) =>
          typeof field !== 'string' || (entry.kind === 'fields'
            ? !(FIELD_NAMES as readonly string[]).includes(field)
            : !DIMENSION.test(field)))) {
      fail('invalid field/scalar selection or event identity');
    }
    if (targets.has(entry.targetEventId) || events.has(entry.eventId)) {
      fail('repeated source event or inverse event identity');
    }
    targets.add(entry.targetEventId);
    events.add(entry.eventId);
  }
}

/** Pure exact-source preview; no partial commit or automatic consent. */
export function previewFeatureHistoryBatch(
  input: ProjectDocument, request: FeatureHistoryBatchRequest,
): FeatureHistoryBatchPreview {
  validate(request);
  const source = parseProject(input);
  if (source.projectId !== request.expectedProjectId ||
      source.revision !== request.expectedRevision ||
      serializeProject(source) !== request.expectedDocumentFence) {
    throw new ProjectRevisionError('feature history batch: stale or divergent journal');
  }
  const selections: FeatureHistoryBatchSelectionResult[] = [];
  const events: JournalEvent[] = [];
  const featureIds = new Set<string>();
  for (const item of request.selections) {
    const common = {
      version: 1 as const,
      expectedProjectId: request.expectedProjectId,
      expectedRevision: request.expectedRevision,
      expectedDocumentFence: request.expectedDocumentFence,
      targetEventId: item.targetEventId, eventId: item.eventId,
      // Per-selection previews check provenance independently, but must not
      // demand intermediate readiness: the combined plan is authoritative.
      admission: 'permit_unresolved' as const, confirmUnresolved: true,
    };
    const preview = item.kind === 'fields'
      ? previewFeatureEditFieldRevert(source, {
        ...common, format: FEATURE_EDIT_FIELD_REVERT_FORMAT,
        selectedFields: item.selectedFields,
      })
      : previewFeaturePayloadScalarRevert(source, {
        ...common, format: FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT,
        selectedFields: item.selectedFields,
      });
    if (featureIds.has(preview.featureId)) {
      fail('a batch cannot independently compensate the same feature twice');
    }
    featureIds.add(preview.featureId);
    events.push(preview.event);
    selections.push({
      kind: item.kind, targetEventId: item.targetEventId,
      featureId: preview.featureId, eventId: item.eventId,
      selectedFields: [...item.selectedFields],
    });
  }

  const staged = previewTransaction(source, events, source.revision);
  const beforePlan = planProject(source);
  const afterStates = new Map(staged.plan.features.map((row) =>
    [row.feature.id, row.status] as const));
  const invalidation = planIncrementalEvaluation(source, staged.document);
  const affected = new Set(invalidation.invalidatedFeatureIds);
  const regressed = beforePlan.features.filter((row) =>
    row.status === 'ready' && afterStates.get(row.feature.id) !== 'ready')
    .map((row) => row.feature.id);
  if (regressed.some((id) => !affected.has(id))) {
    fail('combined compensation regresses an unrelated ready feature');
  }
  if (request.admission === 'require_ready' &&
      (selections.some((row) => afterStates.get(row.featureId) !== 'ready') ||
        regressed.length > 0)) {
    fail('combined compensation leaves ready intent unresolved');
  }
  if (regressed.length > 0 && !request.confirmUnresolved) {
    fail('explicit confirmation required for unresolved downstream intent');
  }

  // The writer's departed body and restored body both matter. The full
  // cross-feature frontier is calculated once, not unioned from independently
  // staged previews that may overlook new interactions.
  const bodies = new Set<string>();
  for (const document of [source, staged.document]) {
    for (const writer of featuresOf(document)) {
      if (!affected.has(writer.id) ||
          (writer.kind !== 'cut' && writer.kind !== 'extrude')) continue;
      for (const id of writer.writeTargets) bodies.add(id);
    }
  }
  return {
    format: 'intuit3d.feature-history-batch-preview', version: 1,
    selections, events, document: staged.document, plan: staged.plan,
    invalidation, regressedReadyFeatureIds: regressed,
    invalidatedBodyIds: [...bodies],
    unaffectedReadyFeatureIds: invalidation.unchangedReady,
    requiresSketchAdmission: true, requiresNativeRebuild: true,
    exactGeometryAuthority: false,
  };
}
/** Every inverse event forms ONE persisted undo frame or NONE is committed. */
export function commitUndoableFeatureHistoryBatch(
  input: UndoHistory, request: FeatureHistoryBatchRequest,
): UndoHistory {
  const history = parseUndoHistory(input);
  const preview = previewFeatureHistoryBatch(history.document, request);
  return commitUndoableTransaction(history, preview.events, request.expectedRevision);
}


/**
 * @intuit3d/model/feature-history-batch-recovery/v1
 *
 * A CAD history inspector can retain a user's selected *intent* after later
 * edits, but may not reuse a stale preview or transfer consent to a new graph.
 * Recovery is permitted only on a canonical, strictly append-only descendant
 * of the originally inspected journal; a different branch or equal-revision
 * replacement must be reselected, never silently rebased.
 *
 * This API is a read-only preflight. WORKBENCH must display the fresh impact
 * before passing candidateRequest to the ordinary atomic batch commit path.
 */
export const FEATURE_HISTORY_BATCH_RECOVERY_FORMAT =
  'intuit3d.feature-history-batch-recovery' as const;

export interface FeatureHistoryBatchRecovery {
  readonly format: typeof FEATURE_HISTORY_BATCH_RECOVERY_FORMAT;
  readonly version: 1;
  readonly sourceRevision: number;
  readonly currentRevision: number;
  readonly appendedEventCount: number;
  readonly status: 'ready' | 'requires_unresolved_review' | 'blocked';
  readonly reason: string | null;
  /**
   * A NEW, current-source-fenced request with NO carried-over permission to
   * produce unresolved intent. Null for a blocked selection.
   */
  readonly candidateRequest: FeatureHistoryBatchRequest | null;
  readonly preview: FeatureHistoryBatchPreview | null;
  /** New body impacts must be made visible to the engineer on review. */
  readonly newlyInvalidatedBodyIds: readonly string[];
  /** Never treat an earlier permission or preview as consent on a new head. */
  readonly requiresFreshReview: true;
  readonly exactGeometryAuthority: false;
}

/**
 * Re-evaluate the same 2–8 historical selections on a descendant document.
 *
 * No topology matching or semantic guesswork is performed. The old canonical
 * fence is itself a complete project snapshot, so no separate, untrusted
 * "original feature value" is needed. A source-prefix mismatch is a revision
 * conflict; overlapping edits and lost event IDs produce an explicit blocked
 * result, with no partial selection recovery.
 */
export function recoverFeatureHistoryBatchSelection(
  currentInput: ProjectDocument,
  inspectedRequest: FeatureHistoryBatchRequest,
): FeatureHistoryBatchRecovery {
  validate(inspectedRequest);
  const origin = deserializeProject(inspectedRequest.expectedDocumentFence);
  if (serializeProject(origin) !== inspectedRequest.expectedDocumentFence ||
      origin.projectId !== inspectedRequest.expectedProjectId ||
      origin.revision !== inspectedRequest.expectedRevision) {
    throw new ProjectRevisionError(
      'feature history batch recovery: invalid original document fence');
  }
  // Establish that this selection was meaningful on its original document.
  // Inspection may examine unresolved outcomes, but cannot authorize them.
  const oldPreview = previewFeatureHistoryBatch(origin, {
    ...inspectedRequest, admission: 'permit_unresolved', confirmUnresolved: true,
  });
  const current = parseProject(currentInput);
  if (current.projectId !== origin.projectId ||
      current.revision < origin.revision ||
      serializeProject({
        ...current, revision: origin.revision,
        journal: current.journal.slice(0, origin.revision),
      }) !== inspectedRequest.expectedDocumentFence) {
    throw new ProjectRevisionError(
      'feature history batch recovery: journal is not the inspected append-only lineage');
  }

  const candidateRequest: FeatureHistoryBatchRequest = {
    ...inspectedRequest,
    expectedRevision: current.revision,
    expectedDocumentFence: serializeProject(current),
    // Previously given permission cannot migrate across a document change.
    admission: 'require_ready',
    confirmUnresolved: false,
  };
  const base = {
    format: FEATURE_HISTORY_BATCH_RECOVERY_FORMAT,
    version: 1 as const,
    sourceRevision: origin.revision, currentRevision: current.revision,
    appendedEventCount: current.revision - origin.revision,
    requiresFreshReview: true as const, exactGeometryAuthority: false as const,
  };
  let preview: FeatureHistoryBatchPreview;
  try {
    // Evaluate structural admissibility independently of renewed human consent.
    // The resulting strict candidate remains uncommittable if intent regresses.
    preview = previewFeatureHistoryBatch(current, {
      ...candidateRequest, admission: 'permit_unresolved', confirmUnresolved: true,
    });
  } catch (error) {
    if (!(error instanceof ProjectFormatError ||
          error instanceof ProjectRevisionError)) throw error;
    return {
      ...base, status: 'blocked', reason: error.message,
      candidateRequest: null, preview: null, newlyInvalidatedBodyIds: [],
    };
  }

  const previousBodies = new Set(oldPreview.invalidatedBodyIds);
  const states = new Map(preview.plan.features.map((row) =>
    [row.feature.id, row.status] as const));
  const requiresUnresolved = preview.regressedReadyFeatureIds.length > 0 ||
    preview.selections.some((row) => states.get(row.featureId) !== 'ready');
  return {
    ...base,
    status: requiresUnresolved ? 'requires_unresolved_review' : 'ready',
    reason: null, candidateRequest, preview,
    newlyInvalidatedBodyIds: preview.invalidatedBodyIds.filter(
      (id) => !previousBodies.has(id)),
  };
}
