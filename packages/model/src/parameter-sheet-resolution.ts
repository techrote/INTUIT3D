/**
 * @intuit3d/model/parameter-sheet-resolution/v1
 *
 * Explicit, revision-fenced recovery from a conflicting unsaved spreadsheet
 * edit. A conflicting edit is NEVER auto-applied: the caller must show the
 * conservative rebase conflicts and obtain exact per-conflict approval.
 * The result is a proposal for the existing undoable table commit, not a
 * write, topology result, validated solid, or STEP authority.
 */
import {
  parseProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { ProjectDocument } from './index.ts';
import {
  rebaseParameterSheetEdit,
} from './parameter-sheet-rebase.ts';
import type {
  ParameterSheetRebaseConflict, ParameterSheetRebaseConflictCode,
} from './parameter-sheet-rebase.ts';
import {
  previewParameterFormulaTableEdit,
} from './parameter-formula-table.ts';
import type {
  ParameterFormulaTableRequest, ParameterFormulaTablePreview,
} from './parameter-formula-table.ts';
import {
  inspectParameterSheet, parameterSheetRequest,
} from './parameter-sheet.ts';

export const PARAMETER_SHEET_RESOLUTION_FORMAT = 'intuit3d.parameter-sheet-resolution' as const;
export const PARAMETER_SHEET_RESOLUTION_VERSION = 1 as const;

export interface ParameterSheetConflictApproval {
  readonly code: ParameterSheetRebaseConflictCode;
  readonly featureId: string | null;
  readonly relatedId: string | null;
}
export interface ParameterSheetEventReplacement {
  /** ID of an edited parameter, not the collided event. */
  readonly featureId: string;
  /** Explicit NEW event ID supplied by the UI, never auto-generated. */
  readonly eventId: string;
}
export interface ParameterSheetResolutionRequest {
  readonly format: typeof PARAMETER_SHEET_RESOLUTION_FORMAT;
  readonly version: typeof PARAMETER_SHEET_RESOLUTION_VERSION;
  readonly expectedProjectId: string;
  readonly expectedBaseRevision: number;
  readonly expectedCurrentRevision: number;
  /** Exact acknowledgements from the CURRENT rebase report. */
  readonly approvals: readonly ParameterSheetConflictApproval[];
  /** Required iff a draft event ID was taken since the draft's base revision. */
  readonly eventReplacements: readonly ParameterSheetEventReplacement[];
}
export interface ParameterSheetValueComparison {
  readonly featureId: string;
  readonly baseDraftValue: number | null;
  readonly currentDraftValue: number | null;
  /** An unresolved unit/parameter does not become a numerical promise. */
  readonly baseDraftUnit: string | null;
  readonly currentDraftUnit: string | null;
}
export interface ParameterSheetResolutionResult {
  readonly format: typeof PARAMETER_SHEET_RESOLUTION_FORMAT;
  readonly version: typeof PARAMETER_SHEET_RESOLUTION_VERSION;
  readonly status: 'ready' | 'conflicted';
  readonly projectId: string;
  readonly baseRevision: number;
  readonly currentRevision: number;
  /** The actual conflicts the author explicitly accepted, not inferred consent. */
  readonly acknowledgedConflicts: readonly ParameterSheetRebaseConflict[];
  /** Remaining or newly discovered problems; nonempty whenever conflicted. */
  readonly conflicts: readonly ParameterSheetRebaseConflict[];
  readonly resolvedRequest: ParameterFormulaTableRequest | null;
  readonly preview: ParameterFormulaTablePreview | null;
  /** Scalar difference after applying the draft to BASE versus CURRENT. */
  readonly valueComparisons: readonly ParameterSheetValueComparison[];
  readonly exactGeometryAuthority: false;
}
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const OVERRIDABLE = new Set<ParameterSheetRebaseConflictCode>([
  'edited_row_changed', 'referenced_parameter_changed', 'event_id_taken',
]);
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return plain(value) && Object.keys(value).length === fields.length &&
    fields.every(key => Object.hasOwn(value, key));
}
function fail(message: string): never {
  throw new ProjectFormatError('parameter sheet resolution: ' + message);
}
function conflictKey(value: ParameterSheetConflictApproval): string {
  return JSON.stringify([value.code, value.featureId, value.relatedId]);
}
function refsOf(preview: ParameterFormulaTablePreview, id: string): readonly string[] {
  return preview.formulaReferences.find(entry => entry.featureId === id)
    ?.referencedParameterIds ?? [];
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every(id => right.includes(id));
}
function rejected(
  code: ParameterSheetRebaseConflictCode, featureId: string | null,
  detail: string,
): ParameterSheetRebaseConflict {
  return {code, featureId, relatedId: null, detail};
}

/**
 * Recover a stale multi-parameter edit after explicit user review.
 *
 * - The original draft must be admissible against its original authoring
 *   revision, and BASE must be an exact journal prefix of CURRENT.
 * - Acknowledgements are specific to the reported conflicting semantic IDs;
 *   unrecognised or duplicate approvals are refused, never accepted as a
 *   blanket "overwrite all" instruction.
 * - Even with approval, a formula cannot silently rebind to another parameter
 *   ID. Changed dependencies and authored rows MAY be reapplied deliberately,
 *   with the changed scalar result exposed for review.
 * - An occupied journal event ID requires an explicit fresh replacement.
 * - Final dependency/dimension validation and a subsequent race-fenced commit
 *   are still mandatory. No partial row commits or implicit history rewriting.
 */
export function resolveParameterSheetConflict(
  baseInput: ProjectDocument,
  currentInput: ProjectDocument,
  draft: ParameterFormulaTableRequest,
  resolution: ParameterSheetResolutionRequest,
): ParameterSheetResolutionResult {
  const base = parseProject(baseInput);
  const current = parseProject(currentInput);
  if (!exact(resolution, [
    'format', 'version', 'expectedProjectId', 'expectedBaseRevision',
    'expectedCurrentRevision', 'approvals', 'eventReplacements',
  ]) || resolution.format !== PARAMETER_SHEET_RESOLUTION_FORMAT ||
      resolution.version !== PARAMETER_SHEET_RESOLUTION_VERSION ||
      !Array.isArray(resolution.approvals) ||
      !Array.isArray(resolution.eventReplacements) ||
      resolution.approvals.length > 128 ||
      resolution.eventReplacements.length > 32) {
    fail('unsupported resolution request');
  }
  if (resolution.expectedProjectId !== base.projectId ||
      resolution.expectedProjectId !== current.projectId ||
      resolution.expectedBaseRevision !== base.revision ||
      resolution.expectedCurrentRevision !== current.revision) {
    throw new ProjectRevisionError(
      'parameter sheet resolution: stale project or document revision');
  }
  const first = rebaseParameterSheetEdit(
    base, current, draft, resolution.expectedCurrentRevision);
  const basePreview = previewParameterFormulaTableEdit(base, draft);
  const acknowledged: ParameterSheetRebaseConflict[] = [];
  const pending: ParameterSheetRebaseConflict[] = [];
  const offered = new Map(first.conflicts.map(item =>
    [conflictKey(item), item] as const));
  const approvals = new Set<string>();
  for (const item of resolution.approvals) {
    if (!exact(item, ['code', 'featureId', 'relatedId']) ||
        typeof item.code !== 'string' ||
        !(item.featureId === null || (typeof item.featureId === 'string' && ID.test(item.featureId))) ||
        !(item.relatedId === null || (typeof item.relatedId === 'string' && ID.test(item.relatedId)))) {
      fail('malformed conflict acknowledgement');
    }
    const key = conflictKey(item as unknown as ParameterSheetConflictApproval);
    if (approvals.has(key) || !offered.has(key)) {
      fail('duplicate or unreported conflict acknowledgement');
    }
    approvals.add(key);
  }
  for (const item of first.conflicts) {
    if (approvals.has(conflictKey(item)) && OVERRIDABLE.has(item.code)) {
      acknowledged.push(item);
    } else {
      pending.push(item);
    }
  }
  const replacementMap = new Map<string, string>();
  const used = new Set(current.journal.map(item => item.eventId));
  const drafted = new Set(draft.rows.map(row => row.featureId));
  for (const item of resolution.eventReplacements) {
    if (!exact(item, ['featureId', 'eventId']) ||
        typeof item.featureId !== 'string' || !ID.test(item.featureId) ||
        typeof item.eventId !== 'string' || !ID.test(item.eventId) ||
        !drafted.has(item.featureId) || replacementMap.has(item.featureId) ||
        used.has(item.eventId)) {
      fail('invalid or occupied replacement event ID');
    }
    replacementMap.set(item.featureId, item.eventId);
  }
  const collisions = first.conflicts.filter(item => item.code === 'event_id_taken');
  const collidingIds = new Set(collisions.map(item => item.featureId));
  if (replacementMap.size !== collidingIds.size ||
      [...replacementMap.keys()].some(id => !collidingIds.has(id)) ||
      new Set(replacementMap.values()).size !== replacementMap.size) {
    fail('one unique explicit replacement is required per occupied event ID');
  }
  const result = (
    request: ParameterFormulaTableRequest | null,
    preview: ParameterFormulaTablePreview | null,
    conflicts: readonly ParameterSheetRebaseConflict[],
    comparisons: readonly ParameterSheetValueComparison[] = [],
  ): ParameterSheetResolutionResult => ({
    format: PARAMETER_SHEET_RESOLUTION_FORMAT,
    version: PARAMETER_SHEET_RESOLUTION_VERSION,
    status: conflicts.length ? 'conflicted' : 'ready',
    projectId: current.projectId, baseRevision: base.revision,
    currentRevision: current.revision, acknowledgedConflicts: acknowledged,
    conflicts, resolvedRequest: request, preview,
    valueComparisons: comparisons, exactGeometryAuthority: false,
  });
  if (pending.length) return result(null, null, pending);

  const proposed: ParameterFormulaTableRequest = {
    ...draft, expectedRevision: current.revision,
    rows: draft.rows.map(row => ({
      ...row, eventId: replacementMap.get(row.featureId) ?? row.eventId,
    })),
  };
  let preview: ParameterFormulaTablePreview;
  try {
    preview = previewParameterFormulaTableEdit(current, proposed);
  } catch (error) {
    if (!(error instanceof ProjectFormatError ||
          error instanceof ProjectRevisionError)) throw error;
    return result(null, null, [
      rejected('candidate_rejected', null,
        'Current final-state admission rejected the explicit resolution: ' +
        error.message),
    ]);
  }
  const bindingConflicts: ParameterSheetRebaseConflict[] = [];
  for (const row of draft.rows) {
    if (row.formula === undefined) continue;
    if (!sameIds(refsOf(basePreview, row.featureId),
                 refsOf(preview, row.featureId))) {
      bindingConflicts.push(rejected('formula_binding_changed', row.featureId,
        'Draft formula now binds to different semantic parameter IDs; edit its text explicitly.'));
    }
  }
  if (bindingConflicts.length) return result(null, null, bindingConflicts);

  const before = new Map(inspectParameterSheet(
    basePreview.document, parameterSheetRequest(basePreview.document))
    .rows.map(row => [row.featureId, row] as const));
  const after = new Map(inspectParameterSheet(
    preview.document, parameterSheetRequest(preview.document))
    .rows.map(row => [row.featureId, row] as const));
  const comparisons = draft.rows.map(row => ({
    featureId: row.featureId,
    baseDraftValue: before.get(row.featureId)?.value ?? null,
    currentDraftValue: after.get(row.featureId)?.value ?? null,
    baseDraftUnit: before.get(row.featureId)?.unit ?? null,
    currentDraftUnit: after.get(row.featureId)?.unit ?? null,
  }));
  return result(proposed, preview, [], comparisons);
}
