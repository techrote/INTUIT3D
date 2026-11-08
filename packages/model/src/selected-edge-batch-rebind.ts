/**
 * @intuit3d/model/selected-edge-batch-rebind/v1
 *
 * One revision-fenced, undoable operation to reattach several explicitly
 * authored cross-body edge-referenced cuts. A flange/clevis often has multiple
 * holes referencing one datum body. Rebinding only one leaves the assembly
 * partly attached to obsolete datum intent; this batch either admits every
 * selected cut, or changes nothing.
 *
 * Each new source is an AUTHOR-selected semantic edge and terminal body writer.
 * There is no inferred topology, physical drill placement, silent role mapping,
 * B-rep result, or provider cache authority in this contract.
 */
import {
  parseProject, ProjectFormatError, ProjectRevisionError, planProject,
} from './index.ts';
import type {
  EvaluationPlan, JournalEvent, ProjectDocument,
} from './index.ts';
import {
  MAX_TRANSACTION_EVENTS, commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import {
  SELECTED_EDGE_CUT_REBIND_FORMAT, SELECTED_EDGE_CUT_VERSION,
  previewSelectedEdgeCutRebind,
} from './selected-edge-cut.ts';
import type { SelectedEdgeCutRebindRequest } from './selected-edge-cut.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';

export const SELECTED_EDGE_BATCH_REBIND_FORMAT =
  'intuit3d.selected-edge-batch-rebind' as const;
export const SELECTED_EDGE_BATCH_REBIND_VERSION = 1 as const;

/**
 * All actions use ONE original document revision. The implementation
 * restamps only the *internal* transaction revision between staged events.
 * Caller-provided stale/extra action fields are not silently discarded.
 */
export type SelectedEdgeBatchRebindAction = Omit<
  SelectedEdgeCutRebindRequest,
  'format' | 'version' | 'expectedProjectId' | 'expectedRevision'
>;

export interface SelectedEdgeBatchRebindRequest {
  readonly format: typeof SELECTED_EDGE_BATCH_REBIND_FORMAT;
  readonly version: typeof SELECTED_EDGE_BATCH_REBIND_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly actions: readonly SelectedEdgeBatchRebindAction[];
}

export interface SelectedEdgeBatchRebindPreview {
  readonly format: 'intuit3d.selected-edge-batch-rebind-preview';
  readonly version: 1;
  readonly projectId: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly document: ProjectDocument;
  readonly events: readonly JournalEvent[];
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly changedCutIds: readonly string[];
  readonly sourceBodyIds: readonly string[];
  readonly targetBodyIds: readonly string[];
  readonly requiresEdgeEvidence: true;
  readonly requiresNativeRebuild: true;
  readonly exactGeometryAuthority: false;
}

const ACTION_FIELDS = [
  'eventId', 'cutFeatureId', 'targetBodyId', 'expectedSourceBodyId',
  'expectedSourceWriterId', 'expectedReference', 'origin',
  'releasePreviousSourceDependency', 'admission',
] as const;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return isPlain(value) && Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field));
}

function fail(message: string): never {
  throw new ProjectFormatError('selected edge batch rebind: ' + message);
}

/**
 * Preview *all* selected reattachments, validating each against the staged
 * state and the existing single-cut semantic contract. Events are returned
 * for one atomic transaction: no partial commits or generated event IDs.
 *
 * Retired historical source edges can be released only by an explicit per-cut
 * choice. Concurrent edits, duplicate cuts, duplicate IDs, changed source
 * selections, ambiguous terminal writers and dependency regressions fail closed.
 */
export function previewSelectedEdgeBatchRebind(
  source: ProjectDocument, request: SelectedEdgeBatchRebindRequest,
): SelectedEdgeBatchRebindPreview {
  const original = parseProject(source);
  if (!hasExactFields(request, [
    'format', 'version', 'expectedProjectId', 'expectedRevision', 'actions',
  ]) || request.format !== SELECTED_EDGE_BATCH_REBIND_FORMAT ||
      request.version !== SELECTED_EDGE_BATCH_REBIND_VERSION ||
      !Array.isArray(request.actions) ||
      request.actions.length < 2 ||
      request.actions.length > MAX_TRANSACTION_EVENTS) {
    fail('expected a versioned batch of 2-' + MAX_TRANSACTION_EVENTS + ' reattachments');
  }
  if (request.expectedProjectId !== original.projectId ||
      request.expectedRevision !== original.revision) {
    throw new ProjectRevisionError('selected edge batch rebind: stale project/revision');
  }

  const seenCutIds = new Set<string>();
  const seenEventIds = new Set<string>();
  let working = original;
  const sourceBodyIds = new Set<string>();
  const targetBodyIds = new Set<string>();

  for (const action of request.actions) {
    if (!hasExactFields(action, ACTION_FIELDS)) {
      fail('action has missing or unsupported fields');
    }
    if (typeof action.cutFeatureId !== 'string' || !ID.test(action.cutFeatureId) ||
        typeof action.eventId !== 'string' || !ID.test(action.eventId)) {
      fail('invalid cut or event identity');
    }
    if (seenCutIds.has(action.cutFeatureId)) {
      fail('one selected cut may only be rebound once per batch');
    }
    if (seenEventIds.has(action.eventId)) {
      fail('event IDs must be distinct and author-allocated');
    }
    seenCutIds.add(action.cutFeatureId);
    seenEventIds.add(action.eventId);

    const next = previewSelectedEdgeCutRebind(working, {
      format: SELECTED_EDGE_CUT_REBIND_FORMAT,
      version: SELECTED_EDGE_CUT_VERSION,
      expectedProjectId: original.projectId,
      expectedRevision: working.revision,
      eventId: action.eventId,
      cutFeatureId: action.cutFeatureId,
      targetBodyId: action.targetBodyId,
      expectedSourceBodyId: action.expectedSourceBodyId,
      expectedSourceWriterId: action.expectedSourceWriterId,
      expectedReference: action.expectedReference,
      origin: action.origin,
      releasePreviousSourceDependency: action.releasePreviousSourceDependency,
      admission: action.admission,
    });
    working = next.document;
    sourceBodyIds.add(next.sourceBodyId);
    targetBodyIds.add(next.targetBodyId);
  }

  const events = working.journal.slice(original.revision);
  // All entries have been independently admitted. This final recheck is
  // against the *whole* batch, not merely the last single-cut preview.
  const plan = planProject(working);
  return {
    format: 'intuit3d.selected-edge-batch-rebind-preview',
    version: 1, projectId: original.projectId,
    fromRevision: original.revision, toRevision: working.revision,
    document: working, events, plan,
    invalidation: planIncrementalEvaluation(original, working),
    changedCutIds: [...seenCutIds],
    sourceBodyIds: [...sourceBodyIds], targetBodyIds: [...targetBodyIds],
    requiresEdgeEvidence: true, requiresNativeRebuild: true,
    exactGeometryAuthority: false,
  };
}

/** Rebind all selected cuts as exactly ONE undo frame, or reject atomically. */
export function commitUndoableSelectedEdgeBatchRebind(
  source: UndoHistory, request: SelectedEdgeBatchRebindRequest,
): UndoHistory {
  const history = parseUndoHistory(source);
  const preview = previewSelectedEdgeBatchRebind(history.document, request);
  return commitUndoableTransaction(history, preview.events, request.expectedRevision);
}
