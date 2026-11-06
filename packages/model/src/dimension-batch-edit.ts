/**
 * @intuit3d/model/dimension-batch-edit — atomic retrospective binding edits v1.
 *
 * A batch can revise several fields/features without exposing intermediate
 * pending or contradictory intent as a committed document. Each feature edit
 * remains an explicitly versioned journal event; a single transaction frame
 * makes the entire action undoable. No solver, B-rep, or preview cache is
 * treated as authoritative.
 */
import { parseProject, planProject, ProjectFormatError, ProjectRevisionError } from './index.ts';
import type { JournalEvent, ProjectDocument } from './index.ts';
import {
  previewDimensionEdit, DIMENSION_EDIT_FORMAT, DIMENSION_EDIT_VERSION,
} from './dimension-edit.ts';
import type { DimensionEditRequest } from './dimension-edit.ts';
import {
  evaluateDimensionBindingPlan,
} from './dimension-bindings.ts';
import type {
  DimensionBinding, DimensionBindingEvaluation, DimensionFeatureGate,
} from './dimension-bindings.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import {
  MAX_TRANSACTION_EVENTS, parseUndoHistory, commitUndoableTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const DIMENSION_BATCH_EDIT_FORMAT = 'intuit3d.dimension-batch-edit' as const;
export const DIMENSION_BATCH_EDIT_VERSION = 1 as const;

export interface DimensionBatchEditEntry {
  /** Fresh semantic journal event ID; not a transient renderer identifier. */
  readonly eventId: string;
  readonly featureId: string;
  readonly field: string;
  /** Null clears a binding; authored numeric field remains unchanged. */
  readonly binding: Pick<DimensionBinding, 'unit' | 'expression'> | null;
}

export interface DimensionBatchEditRequest {
  readonly format: typeof DIMENSION_BATCH_EDIT_FORMAT;
  readonly version: typeof DIMENSION_BATCH_EDIT_VERSION;
  /** One optimistic fence shared across all edits, not per-event revisions. */
  readonly expectedRevision: number;
  readonly admission: 'permit_unresolved' | 'require_admissible';
  /** 1–64 distinct (feature, field) targets; each receives a fresh event ID. */
  readonly edits: readonly DimensionBatchEditEntry[];
}

export interface DimensionBatchEditPreview {
  readonly format: 'intuit3d.dimension-batch-edit-preview';
  readonly version: 1;
  readonly events: readonly JournalEvent[];
  readonly document: ProjectDocument;
  readonly evaluation: DimensionBindingEvaluation;
  readonly editedFeatureGates: readonly DimensionFeatureGate[];
  readonly invalidation: IncrementalEvaluationPlan;
}

function fail(message: string): never { throw new ProjectFormatError(message); }
function plain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}
function exact(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k)) &&
    Object.keys(v).every((k) => keys.includes(k));
}
function admissible(gate: DimensionFeatureGate | undefined): boolean {
  return gate?.status === 'bound' || gate?.status === 'admissible';
}

/**
 * Stage each individually validated edit over a private speculative revision.
 * Admission is assessed ONLY on the final combined document. This matters
 * when the user simultaneously removes an unresolved binding and adds a
 * replacement: intermediate pending states must not defeat valid final intent.
 *
 * Strict mode additionally rejects any newly blocked feature that had an
 * admissible derived payload before this batch. Permissive mode retains all
 * pending/conflicted states with null derived payloads, never stale numerics.
 */
export function previewDimensionEditBatch(
  input: ProjectDocument, request: DimensionBatchEditRequest,
): DimensionBatchEditPreview {
  const original = parseProject(input);
  if (!plain(request) || !exact(request, [
    'format', 'version', 'expectedRevision', 'admission', 'edits',
  ]) || request.format !== DIMENSION_BATCH_EDIT_FORMAT ||
      request.version !== DIMENSION_BATCH_EDIT_VERSION) {
    fail('unsupported dimension batch request');
  }
  if (original.revision !== request.expectedRevision) {
    throw new ProjectRevisionError('stale dimension batch: expected ' +
      request.expectedRevision + ', actual ' + original.revision);
  }
  if (request.admission !== 'permit_unresolved' && request.admission !== 'require_admissible') {
    fail('unsupported dimension batch admission');
  }
  if (!Array.isArray(request.edits) || request.edits.length < 1 ||
      request.edits.length > MAX_TRANSACTION_EVENTS) {
    fail('dimension batch requires 1-' + MAX_TRANSACTION_EVENTS + ' entries');
  }

  const seenTargets = new Set<string>();
  const seenEvents = new Set<string>();
  const editedFeatures = new Set<string>();
  let working = original;
  const staged: JournalEvent[] = [];
  for (const edit of request.edits) {
    if (!plain(edit) || !exact(edit, ['eventId', 'featureId', 'field', 'binding']) ||
        typeof edit.eventId !== 'string' || typeof edit.featureId !== 'string' ||
        typeof edit.field !== 'string') fail('invalid dimension batch entry');
    const key = edit.featureId + '#' + edit.field;
    if (seenTargets.has(key)) fail('duplicate dimension batch target ' + key);
    if (seenEvents.has(edit.eventId)) fail('duplicate dimension batch event ID ' + edit.eventId);
    seenTargets.add(key);
    seenEvents.add(edit.eventId);
    editedFeatures.add(edit.featureId);

    // Reuse the single-edit parser, expression budget, parameter-kind checks,
    // semantic edge insertion and canonical transaction event validation.
    const single: DimensionEditRequest = {
      format: DIMENSION_EDIT_FORMAT, version: DIMENSION_EDIT_VERSION,
      eventId: edit.eventId, featureId: edit.featureId, field: edit.field,
      binding: edit.binding, expectedRevision: working.revision,
      admission: 'permit_unresolved',
    };
    const step = previewDimensionEdit(working, single);
    staged.push(step.event);
    working = step.document;
  }

  const evaluation = evaluateDimensionBindingPlan(planProject(working));
  const gates = new Map(evaluation.featureGates.map((g) => [g.featureId, g] as const));
  const editedFeatureGates = [...editedFeatures].map((id) => {
    const gate = gates.get(id);
    if (!gate) fail('missing final dimension gate for ' + id);
    return gate;
  });
  const invalidation = planIncrementalEvaluation(original, working);

  if (request.admission === 'require_admissible') {
    for (const gate of editedFeatureGates) {
      if (!admissible(gate)) {
        fail('dimension batch not admissible at ' + gate.featureId + ': ' +
          gate.status + ' / ' + gate.diagnostics.map((d) => d.code).join(','));
      }
    }
    const before = evaluateDimensionBindingPlan(planProject(original));
    const beforeGates = new Map(before.featureGates.map((g) => [g.featureId, g] as const));
    for (const id of invalidation.invalidatedFeatureIds) {
      if (admissible(beforeGates.get(id)) && !admissible(gates.get(id))) {
        fail('dimension batch regresses formerly admissible dependent feature ' + id);
      }
    }
  }
  return {
    format: 'intuit3d.dimension-batch-edit-preview', version: 1,
    events: staged, document: working, evaluation, editedFeatureGates,
    invalidation,
  };
}

/** Append all events as ONE durable undo frame; no partial commit on failure. */
export function commitUndoableDimensionEditBatch(
  input: UndoHistory, request: DimensionBatchEditRequest,
): UndoHistory {
  const session = parseUndoHistory(input);
  const preview = previewDimensionEditBatch(session.document, request);
  return commitUndoableTransaction(session, preview.events, request.expectedRevision);
}
