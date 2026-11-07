/**
 * @intuit3d/model/history-move — an interaction-ready, revision-fenced
 * feature timeline move. This changes authored presentation order only:
 * dependency DAG and write-target ordering remain authoritative.
 *
 * A timeline move cannot make a missing dependency ready, authorize a second
 * unordered body writer, or attest exact geometry. Consumers must use the
 * returned evaluation plan, not infer provider execution from timeline order.
 */
import {
  commitEvent, featuresOf, planProject, ProjectFormatError,
  ProjectRevisionError,
} from './index.ts';
import type { EvaluationPlan, JournalEvent } from './index.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import {
  commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const HISTORY_MOVE_FORMAT = 'intuit3d.history-move' as const;
export const HISTORY_MOVE_VERSION = 1 as const;

export interface HistoryMoveRequest {
  readonly eventId: string;
  readonly featureId: string;
  /** null moves to timeline start. Otherwise place after an ACTIVE feature. */
  readonly afterFeatureId: string | null;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
}

export interface HistoryMoveResult {
  readonly format: typeof HISTORY_MOVE_FORMAT;
  readonly version: typeof HISTORY_MOVE_VERSION;
  readonly history: UndoHistory;
  readonly plan: EvaluationPlan;
  readonly movedFeatureId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  /** UI rows whose authored positions changed, in their new timeline order. */
  readonly shiftedFeatureIds: readonly string[];
  /** Zero for pure timeline moves unless an underlying model contract changes. */
  readonly structuralInvalidation: IncrementalEvaluationPlan;
}

/**
 * Admit one deliberate user move into the authoritative journal and one undo
 * frame. Refuse absent/removed anchors, same-feature anchors, stale sessions
 * and no-op drags; never auto-rewire dependsOn or writeTargets.
 */
export function moveHistoryFeature(
  input: UndoHistory,
  request: HistoryMoveRequest,
): HistoryMoveResult {
  const session = parseUndoHistory(input);
  const before = session.document;
  if (before.projectId !== request.expectedProjectId ||
      before.revision !== request.expectedRevision) {
    throw new ProjectRevisionError('stale project/revision for timeline move');
  }

  const active = featuresOf(before).map((feature) => feature.id);
  const fromIndex = active.indexOf(request.featureId);
  if (fromIndex === -1) {
    throw new ProjectFormatError('timeline move requires an active feature ' + request.featureId);
  }
  if (request.afterFeatureId !== null &&
      !active.includes(request.afterFeatureId)) {
    throw new ProjectFormatError('timeline move requires an active predecessor ' + request.afterFeatureId);
  }
  const event: JournalEvent = {
    type: 'feature.move', eventId: request.eventId,
    featureId: request.featureId, afterFeatureId: request.afterFeatureId,
  };
  const candidate = commitEvent(before, event, request.expectedRevision);
  const nextOrder = featuresOf(candidate).map((feature) => feature.id);
  if (nextOrder.every((id, index) => id === active[index])) {
    throw new ProjectFormatError('timeline move would not change authored order');
  }

  const history = commitUndoableTransaction(session, [event], request.expectedRevision);
  const plan = planProject(history.document);
  const toIndex = nextOrder.indexOf(request.featureId);
  const left = Math.min(fromIndex, toIndex);
  const right = Math.max(fromIndex, toIndex);
  return {
    format: HISTORY_MOVE_FORMAT,
    version: HISTORY_MOVE_VERSION,
    history, plan, movedFeatureId: request.featureId, fromIndex, toIndex,
    shiftedFeatureIds: nextOrder.slice(left, right + 1),
    structuralInvalidation: planIncrementalEvaluation(before, history.document),
  };
}
