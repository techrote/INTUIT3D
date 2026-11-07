/**
 * @intuit3d/model/body-cut-order/v1
 *
 * Intentionally change the PHYSICAL EVALUATION ORDER of two adjacent cuts on
 * one explicitly selected semantic body. This is not a cosmetic timeline drag.
 * The writer dependency chain is authored as one undoable journal transaction.
 * Geometric validity, B-rep lineage, cached previews and STEP all require a
 * new RUNTIME/KERNEL evaluation; no exact geometry authority is asserted here.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type {
  EvaluationPlan, Feature, JournalEvent, ProjectDocument,
} from './index.ts';
import {
  previewTransaction, parseUndoHistory, commitUndoableTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import { inspectBodyCutChain } from './body-cut-chain.ts';
import { TOPOLOGY_REFERENCE_FORMAT } from './topology.ts';

export const BODY_CUT_ORDER_FORMAT = 'intuit3d.body-cut-order' as const;
export const BODY_CUT_ORDER_VERSION = 1 as const;

export interface BodyCutSwapRequest {
  readonly format: typeof BODY_CUT_ORDER_FORMAT;
  readonly version: typeof BODY_CUT_ORDER_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly targetBodyId: string;
  /** Two adjacent cuts in current dependency order (not journal chronology). */
  readonly firstCutFeatureId: string;
  readonly secondCutFeatureId: string;
  /** Exactly 2 new event IDs for terminal swap; 3 when a later writer exists. */
  readonly eventIds: readonly string[];
}

export interface BodyCutSwapPreview {
  readonly format: 'intuit3d.body-cut-swap-preview';
  readonly version: 1;
  readonly document: ProjectDocument;
  readonly events: readonly JournalEvent[];
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly targetBodyId: string;
  readonly writerOrderBefore: readonly string[];
  readonly writerOrderAfter: readonly string[];
  /** Authoring chronology is preserved; only dependency execution changes. */
  readonly authoredTimelineChanged: false;
  readonly exactGeometryAuthority: false;
  readonly requiresNativeRebuild: true;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(reason: string): never {
  throw new ProjectFormatError('body cut order: ' + reason);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = Object.getPrototypeOf(value);
  return p === Object.prototype || p === null;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field));
}
function id(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) fail('invalid ' + label);
}
function isWriter(feature: Feature, bodyId: string): boolean {
  return feature.writeTargets.length === 1 && feature.writeTargets[0] === bodyId &&
    (feature.kind === 'extrude' ||
     (feature.kind === 'cut' && feature.payload.targetBodyId === bodyId));
}

/**
 * Verify a single, explicitly dependency-ordered extrusion -> cut -> cut chain.
 * A model with unordered body mutations, multi-target operations, branches or
 * pending writers must be repaired before its operation order can be changed.
 */
function orderedBodyWriters(doc: ProjectDocument, bodyId: string): Feature[] {
  const inspection = inspectBodyCutChain(doc, bodyId);
  if (inspection.status !== 'ready') fail(inspection.diagnostic ?? 'body is unavailable');
  const writers = featuresOf(doc).filter((f) => f.writeTargets.includes(bodyId));
  const ids = new Set(writers.map((f) => f.id));
  const successor = new Map<string, Feature>();
  let root: Feature | undefined;
  for (const writer of writers) {
    if (!isWriter(writer, bodyId)) fail('body contains unsupported or multi-target writer');
    const inputs = writer.dependsOn.filter((dep) => ids.has(dep));
    if (inputs.length === 0) {
      if (writer.kind !== 'extrude' || root) fail('body requires one extrusion root');
      root = writer;
    } else {
      if (writer.kind !== 'cut' || inputs.length !== 1) {
        fail('cuts must declare exactly one preceding body writer');
      }
      if (successor.has(inputs[0]!)) fail('branched body-writer chain');
      successor.set(inputs[0]!, writer);
    }
  }
  if (!root) fail('body has no supported extrusion root');
  const ordered: Feature[] = [], seen = new Set<string>();
  let cursor: Feature | undefined = root;
  while (cursor) {
    if (seen.has(cursor.id)) fail('cyclic writer chain');
    seen.add(cursor.id);
    ordered.push(cursor);
    cursor = successor.get(cursor.id);
  }
  if (ordered.length !== writers.length ||
      ordered[ordered.length - 1]?.id !== inspection.eligibleAfterWriterId) {
    fail('body writers are not a single complete dependency chain');
  }
  return ordered;
}
function replacedDependency(feature: Feature, oldId: string, newId: string): readonly string[] {
  // A body-writer edge might ALSO be the only dependency for an authored
  // face/edge/body selection. Never discard that independent design intent.
  for (const value of Object.values(feature.payload)) {
    if (plain(value) && value.format === TOPOLOGY_REFERENCE_FORMAT &&
        plain(value.anchor) && value.anchor.featureId === oldId) {
      fail('cannot reorder ' + feature.id + ': authored topology still targets ' + oldId);
    }
  }
  if (!feature.dependsOn.includes(oldId)) fail('missing expected body predecessor on ' + feature.id);
  return feature.dependsOn.map((id) => id === oldId ? newId : id);
}

/**
 * Swap two consecutive, already-ready cuts while preserving each cut's source
 * sketch, explicit target body, profile identity, extent and stable feature ID.
 * Rewire a third downstream writer when present so that no body mutation is
 * silently stranded behind the old order. Any real structural regression fails.
 */
export function previewBodyCutSwap(
  input: ProjectDocument, request: BodyCutSwapRequest,
): BodyCutSwapPreview {
  const doc = parseProject(input);
  if (!plain(request) || !exact(request, [
    'format','version','expectedProjectId','expectedRevision','targetBodyId',
    'firstCutFeatureId','secondCutFeatureId','eventIds',
  ]) || request.format !== BODY_CUT_ORDER_FORMAT ||
      request.version !== BODY_CUT_ORDER_VERSION) {
    fail('unsupported swap request');
  }
  for (const [label, value] of [
    ['project',request.expectedProjectId], ['body',request.targetBodyId],
    ['first cut',request.firstCutFeatureId],['second cut',request.secondCutFeatureId],
  ] as const) id(value, label);
  if (request.expectedProjectId !== doc.projectId ||
      request.expectedRevision !== doc.revision) {
    throw new ProjectRevisionError('body cut swap: stale project or revision');
  }
  if (request.firstCutFeatureId === request.secondCutFeatureId) fail('cuts must be distinct');

  const ordered = orderedBodyWriters(doc, request.targetBodyId);
  const index = ordered.findIndex((f) => f.id === request.firstCutFeatureId);
  if (index < 1 || index + 1 >= ordered.length ||
      ordered[index]!.kind !== 'cut' ||
      ordered[index + 1]!.kind !== 'cut' ||
      ordered[index + 1]!.id !== request.secondCutFeatureId) {
    fail('selected cuts must be consecutive in the explicit body dependency chain');
  }
  const preceding = ordered[index - 1]!;
  const first = ordered[index]!;
  const second = ordered[index + 1]!;
  const following = ordered[index + 2];
  const required = following ? 3 : 2;
  if (!Array.isArray(request.eventIds) || request.eventIds.length !== required ||
      new Set(request.eventIds).size !== required) {
    fail('provide exactly ' + required + ' distinct fresh event IDs');
  }
  for (const value of request.eventIds) id(value, 'event ID');

  // Stage all required dependency rewrites in one semantic transaction. Source
  // sketches and any unrelated dependency edges remain exactly as authored.
  const events: JournalEvent[] = [
    { eventId:request.eventIds[0]!, type:'feature.edit', featureId:second.id,
      patch:{dependsOn:replacedDependency(second,first.id,preceding.id)} },
    { eventId:request.eventIds[1]!, type:'feature.edit', featureId:first.id,
      patch:{dependsOn:replacedDependency(first,preceding.id,second.id)} },
  ];
  if (following) {
    events.push({ eventId:request.eventIds[2]!, type:'feature.edit',
      featureId:following.id,
      patch:{dependsOn:replacedDependency(following,second.id,first.id)} });
  }
  const before = planProject(doc);
  const staged = previewTransaction(doc, events, doc.revision);
  const statuses = new Map(staged.plan.features.map((row) =>
    [row.feature.id, row.status] as const));
  for (const writer of ordered) {
    if (statuses.get(writer.id) !== 'ready') {
      fail('reordered body writer is not dependency-ready: ' + writer.id);
    }
  }
  for (const row of before.features) {
    if (row.status === 'ready' && statuses.get(row.feature.id) !== 'ready') {
      fail('swap regresses previously ready feature: ' + row.feature.id);
    }
  }
  // The complete chain must still be a unique, usable body after the edit.
  const afterWriters = orderedBodyWriters(staged.document, request.targetBodyId);
  const writerOrderBefore = ordered.map((f) => f.id);
  const writerOrderAfter = afterWriters.map((f) => f.id);
  const expectedOrder = [...writerOrderBefore];
  [expectedOrder[index], expectedOrder[index + 1]] =
    [expectedOrder[index + 1]!, expectedOrder[index]!];
  if (JSON.stringify(writerOrderAfter) !== JSON.stringify(expectedOrder)) {
    fail('swap did not produce the selected body execution order');
  }

  return {
    format:'intuit3d.body-cut-swap-preview',version:1,
    document:staged.document,
    events:staged.document.journal.slice(doc.revision),
    plan:staged.plan, invalidation:planIncrementalEvaluation(doc,staged.document),
    targetBodyId:request.targetBodyId,writerOrderBefore,writerOrderAfter,
    authoredTimelineChanged:false,exactGeometryAuthority:false,requiresNativeRebuild:true,
  };
}

/** Commit the whole cut order change as one undo frame, never partial writes. */
export function commitUndoableBodyCutSwap(
  input: UndoHistory, request: BodyCutSwapRequest,
): UndoHistory {
  const history = parseUndoHistory(input);
  const staged = previewBodyCutSwap(history.document, request);
  return commitUndoableTransaction(history, staged.events, request.expectedRevision);
}
