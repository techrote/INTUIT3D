/**
 * @intuit3d/model/feature-edit-revert/v1
 *
 * Selectively revert one historical feature.edit without rolling back later,
 * unrelated CAD authoring. The original event remains in the append-only
 * journal; an inverse edit is appended in ONE durable undo frame.
 *
 * This is semantic intent, never geometry/cache/STEP authority.
 */
import {
  featuresOf, parseProject, planProject, serializeProject,
  ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type {
  EvaluationPlan, FeaturePatch, JournalEvent, ProjectDocument,
} from './index.ts';
import {
  commitUndoableTransaction, parseUndoHistory, previewTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';

export const FEATURE_EDIT_REVERT_FORMAT = 'intuit3d.feature-edit-revert' as const;
export const FEATURE_EDIT_REVERT_VERSION = 1 as const;

export interface FeatureEditRevertRequest {
  readonly format: typeof FEATURE_EDIT_REVERT_FORMAT;
  readonly version: typeof FEATURE_EDIT_REVERT_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  /** Canonical journal fence rejects even equal-revision divergent history. */
  readonly expectedDocumentFence: string;
  /** Exact journal event to compensate, not an inferred timeline position. */
  readonly targetEventId: string;
  /** Caller-allocated fresh journal identity for the inverse edit. */
  readonly eventId: string;
  readonly admission: 'require_ready' | 'permit_unresolved';
  /** Explicitly accept resulting unresolved downstream intent, if any. */
  readonly confirmUnresolved: boolean;
}

export interface FeatureEditRevertPreview {
  readonly format: 'intuit3d.feature-edit-revert-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly targetEventId: string;
  readonly featureId: string;
  readonly revertedFields: readonly (keyof FeaturePatch)[];
  readonly regressedReadyFeatureIds: readonly string[];
  readonly invalidatedBodyIds: readonly string[];
  readonly requiresNativeRebuild: true;
  readonly exactGeometryAuthority: false;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const FIELDS = [
  'format','version','expectedProjectId','expectedRevision',
  'expectedDocumentFence','targetEventId','eventId',
  'admission','confirmUnresolved',
] as const;
function fail(message: string): never {
  throw new ProjectFormatError('feature edit revert: ' + message);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = Object.getPrototypeOf(value);
  return p === Object.prototype || p === null;
}
function validate(value: unknown): asserts value is FeatureEditRevertRequest {
  if (!plain(value) ||
      Object.keys(value).length !== FIELDS.length ||
      !FIELDS.every((field) => Object.hasOwn(value, field)) ||
      value.format !== FEATURE_EDIT_REVERT_FORMAT ||
      value.version !== FEATURE_EDIT_REVERT_VERSION ||
      typeof value.expectedProjectId !== 'string' || !ID.test(value.expectedProjectId) ||
      !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 ||
      typeof value.expectedDocumentFence !== 'string' ||
      typeof value.targetEventId !== 'string' || !ID.test(value.targetEventId) ||
      typeof value.eventId !== 'string' || !ID.test(value.eventId) ||
      (value.admission !== 'require_ready' && value.admission !== 'permit_unresolved') ||
      typeof value.confirmUnresolved !== 'boolean') {
    fail('invalid versioned request, source fence or event identity');
  }
}

/**
 * The selected edit is invertible only if the same semantic feature has NOT
 * subsequently been edited, deleted or restored. Later unrelated commands,
 * including a move of the selected feature's timeline presentation, survive.
 * Never reverse a changed field by guessing its earlier value from geometry.
 */
export function previewFeatureEditRevert(
  input: ProjectDocument, request: FeatureEditRevertRequest,
): FeatureEditRevertPreview {
  validate(request);
  const original = parseProject(input);
  if (request.expectedProjectId !== original.projectId ||
      request.expectedRevision !== original.revision ||
      request.expectedDocumentFence !== serializeProject(original)) {
    throw new ProjectRevisionError('feature edit revert: stale or divergent journal');
  }
  if (request.eventId === request.targetEventId) {
    fail('inverse event must have a distinct fresh identity');
  }
  const index = original.journal.findIndex((event) =>
    event.eventId === request.targetEventId);
  const target = original.journal[index];
  if (!target || target.type !== 'feature.edit') {
    fail('selected event is not a historical feature.edit');
  }
  // Patches replace top-level semantic fields atomically. Later changes to
  // DIFFERENT fields of this same feature can survive selective reversion;
  // previously rejecting them made normal multi-step authoring unrecoverable.
  // In particular, 'payload' is an indivisible JSON record: a later edit to
  // any nested payload key conflicts rather than inviting an invented merge.
  // A kind change also conflicts with all other edits, since it can change the
  // interpretation of the original payload and dependencies.
  const targetedFields = new Set(Object.keys(target.patch));
  for (const later of original.journal.slice(index + 1)) {
    if (later.type === 'feature.create' ||
        later.type === 'feature.move' || later.featureId !== target.featureId) {
      continue;
    }
    if (later.type === 'feature.edit' &&
        !targetedFields.has('kind') && later.patch.kind === undefined &&
        Object.keys(later.patch).every((field) => !targetedFields.has(field))) {
      continue;
    }
    throw new ProjectRevisionError(
      'feature edit revert: selected feature was subsequently changed or retired ' +
      'in an overlapping semantic field');
  }
  const before = parseProject({
    ...original, revision: index, journal: original.journal.slice(0, index),
  });
  const prior = featuresOf(before).find((feature) =>
    feature.id === target.featureId);
  const current = featuresOf(original).find((feature) =>
    feature.id === target.featureId);
  if (!prior || !current) fail('historical edit has no active semantic feature');
  const patch: {
    kind?: string;
    dependsOn?: readonly string[];
    writeTargets?: readonly string[];
    payload?: typeof prior.payload;
  } = {};
  if (target.patch.kind !== undefined) patch.kind = prior.kind;
  if (target.patch.dependsOn !== undefined) patch.dependsOn = prior.dependsOn;
  if (target.patch.writeTargets !== undefined) patch.writeTargets = prior.writeTargets;
  if (target.patch.payload !== undefined) patch.payload = prior.payload;
  const fields = Object.keys(patch) as (keyof FeaturePatch)[];
  if (fields.length === 0 ||
      fields.every((field) => JSON.stringify(current[field]) === JSON.stringify(prior[field]))) {
    fail('historical edit has no remaining authored change to revert');
  }
  const event: JournalEvent = {
    type: 'feature.edit', eventId: request.eventId,
    featureId: target.featureId, patch,
  };
  const staged = previewTransaction(original, [event], original.revision);
  const oldPlan = planProject(original);
  const nextStates = new Map(staged.plan.features.map((row) =>
    [row.feature.id, row.status] as const));
  const invalidation = planIncrementalEvaluation(original, staged.document);
  const affected = new Set(invalidation.invalidatedFeatureIds);
  const regressed = oldPlan.features
    .filter((row) => row.status === 'ready' &&
      nextStates.get(row.feature.id) !== 'ready')
    .map((row) => row.feature.id);
  if (regressed.some((id) => !affected.has(id))) {
    fail('inverse edit regresses unrelated ready authoring');
  }
  if (request.admission === 'require_ready' &&
      (nextStates.get(target.featureId) !== 'ready' || regressed.length)) {
    fail('historical reversion leaves previously ready intent unresolved');
  }
  if (regressed.length && !request.confirmUnresolved) {
    fail('explicit confirmation required for unresolved downstream intent');
  }
  // A historical edit may have retargeted an extrude/cut to a different body.
  // Include BOTH sides of the revert: the departing body must be retired just
  // as the restored body must be rebuilt. Returning only current writers would
  // leave a stale provider solid on the previous write target.
  const bodyIds = new Set<string>();
  for (const document of [original, staged.document]) {
    for (const feature of featuresOf(document)) {
      if (!affected.has(feature.id) ||
          (feature.kind !== 'cut' && feature.kind !== 'extrude')) continue;
      for (const bodyId of feature.writeTargets) bodyIds.add(bodyId);
    }
  }
  return {
    format: 'intuit3d.feature-edit-revert-preview', version: 1,
    event: staged.document.journal[staged.document.journal.length - 1]!,
    document: staged.document, plan: staged.plan, invalidation,
    targetEventId: request.targetEventId, featureId: target.featureId,
    revertedFields: fields, regressedReadyFeatureIds: regressed,
    invalidatedBodyIds: [...bodyIds],
    requiresNativeRebuild: true, exactGeometryAuthority: false,
  };
}

/** Append one compensating edit as one durable undo frame, or leave history intact. */
export function commitUndoableFeatureEditRevert(
  input: UndoHistory, request: FeatureEditRevertRequest,
): UndoHistory {
  const history = parseUndoHistory(input);
  const preview = previewFeatureEditRevert(history.document, request);
  return commitUndoableTransaction(history, [preview.event], request.expectedRevision);
}
