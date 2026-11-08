/**
 * @intuit3d/model/historical-edit-inventory/v1
 *
 * User-facing, revision-fenced history menu for selective feature.edit
 * compensation. Unlike chronological undo, this inventory never rewrites or
 * executes the journal. Each row is checked against the actual v1 selective
 * reversion preview, so a disabled choice is not a guessed UI heuristic.
 *
 * WORKBENCH: display rows newest first, require a fresh user-selected eventId
 * and explicit consent for regressed ready features before calling the
 * existing feature-edit-revert command. A provider cache is never authoritative
 * here; RUNTIME must independently fence and rebuild affected bodies.
 */
import {
  featuresOf, parseProject, serializeProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { Feature, FeatureStatus, ProjectDocument, FeaturePatch } from './index.ts';
import {
  FEATURE_EDIT_REVERT_FORMAT, previewFeatureEditRevert,
  FEATURE_EDIT_FIELD_REVERT_FORMAT, previewFeatureEditFieldRevert,
} from './feature-edit-revert.ts';
import type {
  FeatureEditRevertRequest, FeatureEditRevertPreview,
  FeatureEditFieldRevertRequest,
} from './feature-edit-revert.ts';

export const HISTORICAL_EDIT_INVENTORY_FORMAT =
  'intuit3d.historical-edit-inventory' as const;
export const HISTORICAL_EDIT_INVENTORY_VERSION = 1 as const;

export interface HistoricalEditInventoryRequest {
  readonly format: typeof HISTORICAL_EDIT_INVENTORY_FORMAT;
  readonly version: typeof HISTORICAL_EDIT_INVENTORY_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  /** Canonical fence detects divergent histories even with equal revisions. */
  readonly expectedDocumentFence: string;
  /** A valid, unused event ID for non-mutating test previews, not committed. */
  readonly probeEventId: string;
  /** Exclusive upper journal index; null starts at newest event. */
  readonly cursor: number | null;
  readonly limit: number;
}

export type HistoricalEditChoiceStatus =
  'available' | 'requires_confirmation' | 'requires_unresolved_admission' | 'blocked';

/** Per-field, preview-backed affordance for a compound history row. */
export interface HistoricalFieldRevertChoice {
  readonly field: keyof FeaturePatch;
  readonly status: HistoricalEditChoiceStatus;
  readonly reason: string | null;
  readonly regressedReadyFeatureIds: readonly string[];
  readonly invalidatedBodyIds: readonly string[];
  readonly resultingTargetStatus: FeatureStatus | null;
  readonly admission: FeatureEditRevertRequest['admission'] | null;
  readonly confirmUnresolved: boolean;
}
/**
 * Authoritative, source-fenced field history for displaying an actual
 * engineering change, not merely an opaque journal event ID.
 *
 * `before` is the authored value just before the selected event,
 * `authored` is its replacement, and `current` is the living feature's
 * value today (null when retired). A later edit is reported even if the
 * resulting value happens to match the historical value again. These are
 * semantic model values; they are not dimensional solver or B-rep evidence.
 */
export interface HistoricalEditFieldTransition {
  readonly field: keyof FeaturePatch;
  readonly before: Feature[keyof FeaturePatch];
  readonly authored: Feature[keyof FeaturePatch];
  readonly current: Feature[keyof FeaturePatch] | null;
  readonly laterEdited: boolean;
  readonly laterLifecycleChange: boolean;
}

export interface HistoricalEditChoice {
  readonly targetEventId: string;
  readonly featureId: string;
  /** One-based event revision, distinct from the current document revision. */
  readonly sourceRevision: number;
  readonly originallyEditedFields: readonly (keyof FeaturePatch)[];
  /** Journal-replayed before/authored/current field values for history UI. */
  readonly fieldTransitions: readonly HistoricalEditFieldTransition[];
  /** Real admissibility for each historically authored top-level field. */
  readonly fieldChoices: readonly HistoricalFieldRevertChoice[];
  readonly status: HistoricalEditChoiceStatus;
  /** Actual model refusal, not provider-geometry speculation. */
  readonly reason: string | null;
  readonly revertedFields: readonly (keyof FeaturePatch)[];
  readonly regressedReadyFeatureIds: readonly string[];
  readonly invalidatedBodyIds: readonly string[];
  readonly resultingTargetStatus: FeatureStatus | null;
  /** Pass these into feature-edit-revert with a NEW eventId on user action. */
  readonly admission: FeatureEditRevertRequest['admission'] | null;
  readonly confirmUnresolved: boolean;
}

export interface HistoricalEditInventory {
  readonly format: typeof HISTORICAL_EDIT_INVENTORY_FORMAT;
  readonly version: typeof HISTORICAL_EDIT_INVENTORY_VERSION;
  readonly projectId: string;
  readonly revision: number;
  readonly documentFence: string;
  readonly rows: readonly HistoricalEditChoice[];
  readonly nextCursor: number | null;
  readonly requiresNativeRebuildForAcceptedChoice: true;
  readonly exactGeometryAuthority: false;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const KEYS = [
  'format', 'version', 'expectedProjectId', 'expectedRevision',
  'expectedDocumentFence', 'probeEventId', 'cursor', 'limit',
] as const;
function fail(message: string): never {
  throw new ProjectFormatError('historical edit inventory: ' + message);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function validate(value: unknown): asserts value is HistoricalEditInventoryRequest {
  if (!plain(value) || Object.keys(value).length !== KEYS.length ||
      !KEYS.every((key) => Object.hasOwn(value, key)) ||
      value.format !== HISTORICAL_EDIT_INVENTORY_FORMAT ||
      value.version !== HISTORICAL_EDIT_INVENTORY_VERSION ||
      typeof value.expectedProjectId !== 'string' || !ID.test(value.expectedProjectId) ||
      !Number.isSafeInteger(value.expectedRevision) ||
      (value.expectedRevision as number) < 0 ||
      typeof value.expectedDocumentFence !== 'string' ||
      typeof value.probeEventId !== 'string' || !ID.test(value.probeEventId) ||
      !(value.cursor === null || (Number.isSafeInteger(value.cursor) &&
        (value.cursor as number) >= 0)) ||
      !Number.isSafeInteger(value.limit) || (value.limit as number) < 1 ||
      (value.limit as number) > 16) {
    fail('invalid versioned request, pagination or source fence');
  }
}
function diagnostic(error: unknown): string {
  if (error instanceof ProjectFormatError ||
      error instanceof ProjectRevisionError) return error.message;
  throw error;
}
function fieldTransitionsFor(
  document: ProjectDocument, ordinal: number,
  featureId: string, fields: readonly (keyof FeaturePatch)[],
): readonly HistoricalEditFieldTransition[] {
  // Replay the actual historical prefix. The current feature alone cannot
  // recover values replaced by the selected edit; the patch only holds "after".
  const before = parseProject({
    ...document, revision: ordinal, journal: document.journal.slice(0, ordinal),
  });
  const previous = featuresOf(before).find((feature) => feature.id === featureId);
  const current = featuresOf(document).find((feature) => feature.id === featureId);
  const target = document.journal[ordinal];
  if (!previous || !target || target.type !== 'feature.edit' ||
      target.featureId !== featureId) {
    fail('selected historical edit has no valid source feature');
  }
  const subsequent = document.journal.slice(ordinal + 1).filter(
    (event) => event.type !== 'feature.create' && event.featureId === featureId);
  const laterLifecycleChange = subsequent.some((event) =>
    event.type === 'feature.remove' || event.type === 'feature.restore');
  return fields.map((field) => ({
    field,
    before: previous[field],
    authored: target.patch[field]!,
    current: current ? current[field] : null,
    // Kind changes reinterpret every other field. A later re-edit remains
    // relevant even when it eventually writes the same JSON value.
    laterEdited: subsequent.some((event) => event.type === 'feature.edit' &&
      (field === 'kind' || Object.hasOwn(event.patch, 'kind') ||
        Object.hasOwn(event.patch, field))),
    laterLifecycleChange,
  }));
}

function summarize(
  preview: FeatureEditRevertPreview,
  source: { eventId: string; featureId: string; ordinal: number;
    changedFields: readonly (keyof FeaturePatch)[] },
  status: Exclude<HistoricalEditChoiceStatus, 'blocked'>,
  fieldChoices: readonly HistoricalFieldRevertChoice[],
  fieldTransitions: readonly HistoricalEditFieldTransition[],
): HistoricalEditChoice {
  const admission = status === 'available' ? 'require_ready' : 'permit_unresolved';
  return {
    targetEventId: source.eventId, featureId: source.featureId,
    sourceRevision: source.ordinal + 1,
    originallyEditedFields: source.changedFields, fieldChoices, fieldTransitions,
    status, reason: null,
    revertedFields: preview.revertedFields,
    regressedReadyFeatureIds: preview.regressedReadyFeatureIds,
    invalidatedBodyIds: preview.invalidatedBodyIds,
    resultingTargetStatus: preview.plan.features.find(
      (row) => row.feature.id === source.featureId)?.status ?? null,
    admission,
    confirmUnresolved: preview.regressedReadyFeatureIds.length > 0,
  };
}

function summarizeFieldChoice(
  field: keyof FeaturePatch,
  status: Exclude<HistoricalEditChoiceStatus, 'blocked'>,
  preview: FeatureEditRevertPreview,
): HistoricalFieldRevertChoice {
  return {
    field, status, reason: null,
    regressedReadyFeatureIds: preview.regressedReadyFeatureIds,
    invalidatedBodyIds: preview.invalidatedBodyIds,
    resultingTargetStatus: preview.plan.features.find(
      (row) => row.feature.id === preview.featureId)?.status ?? null,
    admission: status === 'available' ? 'require_ready' : 'permit_unresolved',
    confirmUnresolved: preview.regressedReadyFeatureIds.length > 0,
  };
}
/** A field checkbox must be backed by the same authoritative preflight. */
function evaluateFieldChoice(
  document: ProjectDocument,
  base: FeatureEditRevertRequest,
  field: keyof FeaturePatch,
): HistoricalFieldRevertChoice {
  const request: FeatureEditFieldRevertRequest = {
    ...base, format: FEATURE_EDIT_FIELD_REVERT_FORMAT,
    version: 1, selectedFields: [field],
  };
  try {
    return summarizeFieldChoice(field, 'available',
      previewFeatureEditFieldRevert(document, request));
  } catch (error) {
    diagnostic(error);
  }
  try {
    const preview = previewFeatureEditFieldRevert(document, {
      ...request, admission: 'permit_unresolved', confirmUnresolved: true,
    });
    return summarizeFieldChoice(field,
      preview.regressedReadyFeatureIds.length
        ? 'requires_confirmation' : 'requires_unresolved_admission',
      preview);
  } catch (error) {
    return {
      field, status: 'blocked', reason: diagnostic(error),
      regressedReadyFeatureIds: [], invalidatedBodyIds: [],
      resultingTargetStatus: null, admission: null, confirmUnresolved: false,
    };
  }
}

/**
 * Evaluate bounded, paginated authored edit choices in reverse journal order.
 * ALL feature.edit events are returned, including definitively blocked ones.
 * Strict acceptance is tested first, then explicit unresolved admission.
 * There is no automatic compensation, consent or geometry repair.
 */
export function inspectHistoricalFeatureEdits(
  source: ProjectDocument, request: HistoricalEditInventoryRequest,
): HistoricalEditInventory {
  validate(request);
  const document = parseProject(source);
  const fence = serializeProject(document);
  if (document.projectId !== request.expectedProjectId ||
      document.revision !== request.expectedRevision ||
      fence !== request.expectedDocumentFence) {
    throw new ProjectRevisionError('historical edit inventory: stale or divergent journal');
  }
  if (document.journal.some((event) => event.eventId === request.probeEventId)) {
    fail('probe event identity already exists in the journal');
  }
  if (request.cursor !== null && request.cursor > document.journal.length) {
    fail('cursor exceeds this document journal');
  }
  let scan = request.cursor ?? document.journal.length;
  const rows: HistoricalEditChoice[] = [];
  while (scan > 0 && rows.length < request.limit) {
    const ordinal = --scan;
    const event = document.journal[ordinal]!;
    if (event.type !== 'feature.edit') continue;
    const sourceEdit = {
      eventId: event.eventId, featureId: event.featureId,
      ordinal, changedFields: Object.keys(event.patch) as (keyof FeaturePatch)[],
    };
    const base: FeatureEditRevertRequest = {
      format: FEATURE_EDIT_REVERT_FORMAT, version: 1,
      expectedProjectId: request.expectedProjectId,
      expectedRevision: request.expectedRevision,
      expectedDocumentFence: fence,
      targetEventId: event.eventId, eventId: request.probeEventId,
      admission: 'require_ready', confirmUnresolved: false,
    };
    const fieldTransitions = fieldTransitionsFor(document, ordinal,
      event.featureId, sourceEdit.changedFields);
    const fieldChoices = sourceEdit.changedFields.map((field) =>
      evaluateFieldChoice(document, base, field));
    try {
      rows.push(summarize(previewFeatureEditRevert(document, base),
        sourceEdit, 'available', fieldChoices, fieldTransitions));
      continue;
    } catch (error) {
      diagnostic(error);
    }
    try {
      const preview = previewFeatureEditRevert(document, {
        ...base, admission: 'permit_unresolved', confirmUnresolved: true,
      });
      rows.push(summarize(preview, sourceEdit,
        preview.regressedReadyFeatureIds.length
          ? 'requires_confirmation' : 'requires_unresolved_admission',
        fieldChoices, fieldTransitions));
    } catch (error) {
      rows.push({
        targetEventId: event.eventId, featureId: event.featureId,
        sourceRevision: ordinal + 1,
        originallyEditedFields: sourceEdit.changedFields, fieldChoices,
        fieldTransitions,
        status: 'blocked', reason: diagnostic(error),
        revertedFields: [], regressedReadyFeatureIds: [],
        invalidatedBodyIds: [], resultingTargetStatus: null,
        admission: null, confirmUnresolved: false,
      });
    }
  }
  const nextCursor = document.journal.slice(0, scan)
    .some((event) => event.type === 'feature.edit') ? scan : null;
  return {
    format: HISTORICAL_EDIT_INVENTORY_FORMAT,
    version: HISTORICAL_EDIT_INVENTORY_VERSION,
    projectId: document.projectId, revision: document.revision,
    documentFence: fence, rows, nextCursor,
    requiresNativeRebuildForAcceptedChoice: true,
    exactGeometryAuthority: false,
  };
}
