/**
 * @intuit3d/model/feature-lifecycle/v1
 *
 * User-operated deletion/recovery of a CAD timeline feature. A deleted feature
 * remains a journal tombstone with the same semantic ID; dependent features
 * either remain explicitly unresolved or are deliberately retired in one
 * undoable frame. Nothing here authorizes an exact shape, cached mesh or STEP.
 */
import {
  featureTimelineOf, featuresOf, parseProject, planProject,
  ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type {
  EvaluationPlan, JournalEvent, ProjectDocument,
} from './index.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import {
  commitUndoableTransaction, MAX_TRANSACTION_EVENTS, parseUndoHistory,
  previewTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const FEATURE_LIFECYCLE_FORMAT = 'intuit3d.feature-lifecycle' as const;
export const FEATURE_LIFECYCLE_VERSION = 1 as const;
export type FeatureRemovalMode =
  'reject_if_referenced' | 'keep_dependents_pending' | 'cascade_descendants';

export interface FeatureRemovalImpact {
  readonly format: 'intuit3d.feature-removal-impact';
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly featureId: string;
  readonly directDependents: readonly string[];
  readonly transitiveDependents: readonly string[];
  readonly cascadeIds: readonly string[];
}

export interface FeatureRemovalRequest {
  readonly format: typeof FEATURE_LIFECYCLE_FORMAT;
  readonly version: typeof FEATURE_LIFECYCLE_VERSION;
  readonly action: 'remove';
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly featureId: string;
  readonly mode: FeatureRemovalMode;
  /** Explicit acknowledgement before retiring more than the selected row. */
  readonly confirmCascade: boolean;
  /** One fresh author-allocated journal event ID per retired feature. */
  readonly eventIds: readonly string[];
}

export interface FeatureRestorationRequest {
  readonly format: typeof FEATURE_LIFECYCLE_FORMAT;
  readonly version: typeof FEATURE_LIFECYCLE_VERSION;
  readonly action: 'restore';
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  /** Explicit selected tombstone IDs, never inferred from body or face numbers. */
  readonly featureIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly admission: 'require_ready' | 'permit_unresolved';
}

export interface FeatureLifecyclePreview {
  readonly format: 'intuit3d.feature-lifecycle-preview';
  readonly version: 1;
  readonly action: 'remove' | 'restore';
  readonly document: ProjectDocument;
  readonly events: readonly JournalEvent[];
  readonly affectedFeatureIds: readonly string[];
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  /** Model planning is not proof that any physical shape was made or exported. */
  readonly exactGeometryAuthority: false;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(reason: string): never {
  throw new ProjectFormatError('feature lifecycle: ' + reason);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field));
}
function fence(doc: ProjectDocument, projectId: string, revision: number): void {
  if (doc.projectId !== projectId || doc.revision !== revision) {
    throw new ProjectRevisionError('feature lifecycle: stale project/revision');
  }
}
function validateIds(ids: unknown, where: string): asserts ids is readonly string[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_TRANSACTION_EVENTS ||
      ids.some((id) => typeof id !== 'string' || !ID.test(id)) ||
      new Set(ids).size !== ids.length) {
    fail(where + ' must contain 1-' + MAX_TRANSACTION_EVENTS + ' distinct semantic IDs');
  }
}

/**
 * Impact preview in authored row order. Transitive closure is over explicitly
 * authored dependency edges, not chronology or coincident body write targets.
 * It includes already-unresolved downstream intent without dropping it.
 */
export function inspectFeatureRemoval(
  source: ProjectDocument, featureId: string,
): FeatureRemovalImpact {
  const doc = parseProject(source);
  if (typeof featureId !== 'string' || !ID.test(featureId)) fail('invalid feature ID');
  const active = featuresOf(doc);
  if (!active.some((feature) => feature.id === featureId)) {
    fail('selected feature does not exist or is already removed: ' + featureId);
  }
  const children = new Map<string, string[]>();
  for (const feature of active) {
    for (const dep of feature.dependsOn) {
      const rows = children.get(dep) ?? [];
      rows.push(feature.id);
      children.set(dep, rows);
    }
  }
  const encountered = new Set<string>([featureId]);
  const queue = [featureId];
  for (let index = 0; index < queue.length; index++) {
    for (const child of children.get(queue[index]) ?? []) {
      if (encountered.has(child)) continue;
      encountered.add(child);
      queue.push(child);
    }
  }
  const transitiveDependents = active
    .filter((feature) => feature.id !== featureId && encountered.has(feature.id))
    .map((feature) => feature.id);
  return {
    format: 'intuit3d.feature-removal-impact', version: 1,
    projectId: doc.projectId, revision: doc.revision, featureId,
    directDependents: [...new Set(children.get(featureId) ?? [])],
    transitiveDependents,
    cascadeIds: [featureId, ...transitiveDependents],
  };
}

function lifecyclePreview(
  before: ProjectDocument, events: readonly JournalEvent[],
  affectedFeatureIds: readonly string[], action: 'remove' | 'restore',
): FeatureLifecyclePreview {
  const result = previewTransaction(before, events, before.revision);
  return {
    format: 'intuit3d.feature-lifecycle-preview', version: 1, action,
    document: result.document, events: result.document.journal.slice(before.revision),
    affectedFeatureIds, plan: result.plan,
    invalidation: planIncrementalEvaluation(before, result.document),
    exactGeometryAuthority: false,
  };
}

/**
 * Delete a feature. A guarded option protects downstream authoring; an
 * intentional pending mode keeps consumers editable, and explicit cascade
 * retires the entire dependent set as ONE undoable transaction. In particular,
 * a cut cannot remain visually current after removal of its source extrusion.
 */
export function previewFeatureRemoval(
  source: ProjectDocument, request: FeatureRemovalRequest,
): FeatureLifecyclePreview {
  const doc = parseProject(source);
  if (!plain(request) || !exact(request, [
    'format','version','action','expectedProjectId','expectedRevision',
    'featureId','mode','confirmCascade','eventIds',
  ]) || request.format !== FEATURE_LIFECYCLE_FORMAT ||
      request.version !== FEATURE_LIFECYCLE_VERSION ||
      request.action !== 'remove' ||
      !['reject_if_referenced','keep_dependents_pending','cascade_descendants']
        .includes(String(request.mode)) ||
      typeof request.confirmCascade !== 'boolean') fail('unsupported removal request');
  fence(doc, request.expectedProjectId, request.expectedRevision);
  const impact = inspectFeatureRemoval(doc, request.featureId);
  if (request.mode === 'reject_if_referenced' && impact.transitiveDependents.length) {
    fail('feature has dependent authoring: ' + impact.transitiveDependents.join(', '));
  }
  if (request.mode === 'cascade_descendants' &&
      impact.transitiveDependents.length && !request.confirmCascade) {
    fail('cascade requires explicit descendant-removal confirmation');
  }
  const victims = request.mode === 'cascade_descendants'
    ? impact.cascadeIds : [request.featureId];
  validateIds(request.eventIds, 'eventIds');
  if (request.eventIds.length !== victims.length) {
    fail('exactly one event ID required per retired feature');
  }
  // Descendants first for useful intermediate journal inspection. This does
  // not introduce or silently reorder any dependency edge.
  const ids = [...victims].reverse();
  const events: JournalEvent[] = ids.map((featureId, index) => ({
    eventId: request.eventIds[index], type: 'feature.remove', featureId,
  }));
  return lifecyclePreview(doc, events, ids, 'remove');
}

/** Restore explicit tombstones; strict mode refuses new unresolved geometry. */
export function previewFeatureRestoration(
  source: ProjectDocument, request: FeatureRestorationRequest,
): FeatureLifecyclePreview {
  const doc = parseProject(source);
  if (!plain(request) || !exact(request, [
    'format','version','action','expectedProjectId','expectedRevision',
    'featureIds','eventIds','admission',
  ]) || request.format !== FEATURE_LIFECYCLE_FORMAT ||
      request.version !== FEATURE_LIFECYCLE_VERSION ||
      request.action !== 'restore' ||
      !['require_ready','permit_unresolved'].includes(String(request.admission))) {
    fail('unsupported restoration request');
  }
  fence(doc, request.expectedProjectId, request.expectedRevision);
  validateIds(request.featureIds, 'featureIds');
  validateIds(request.eventIds, 'eventIds');
  if (request.featureIds.length !== request.eventIds.length) {
    fail('one fresh event ID required per restored feature');
  }
  const timeline = new Map(featureTimelineOf(doc)
    .map((entry) => [entry.featureId, entry.active] as const));
  for (const id of request.featureIds) {
    if (timeline.get(id) !== false) {
      fail('restore requires an existing removed feature: ' + id);
    }
  }
  const events: JournalEvent[] = request.featureIds.map((featureId, index) => ({
    eventId: request.eventIds[index], type: 'feature.restore', featureId,
  }));
  const preview = lifecyclePreview(doc, events, request.featureIds, 'restore');
  if (request.admission === 'require_ready') {
    const states = new Map(preview.plan.features
      .map((entry) => [entry.feature.id, entry.status] as const));
    for (const id of request.featureIds) {
      if (states.get(id) !== 'ready') {
        fail('restored feature remains unresolved: ' + id + ' (' + states.get(id) + ')');
      }
    }
    // Also reject a newly introduced same-body writer conflict or any other
    // regression of previously ready features.
    for (const item of planProject(doc).features) {
      if (item.status === 'ready' && states.get(item.feature.id) !== 'ready') {
        fail('restore regresses an existing ready feature: ' + item.feature.id);
      }
    }
  }
  return preview;
}

/** Append all retirement commands as ONE undo frame; rejected plans do not mutate history. */
export function commitUndoableFeatureRemoval(
  input: UndoHistory, request: FeatureRemovalRequest,
): UndoHistory {
  const session = parseUndoHistory(input);
  const preview = previewFeatureRemoval(session.document, request);
  return commitUndoableTransaction(session, preview.events, request.expectedRevision);
}

/** Reapply selected tombstones as ONE undo frame, retaining stable semantic IDs. */
export function commitUndoableFeatureRestoration(
  input: UndoHistory, request: FeatureRestorationRequest,
): UndoHistory {
  const session = parseUndoHistory(input);
  const preview = previewFeatureRestoration(session.document, request);
  return commitUndoableTransaction(session, preview.events, request.expectedRevision);
}
