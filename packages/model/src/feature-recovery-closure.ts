/**
 * @intuit3d/model/feature-recovery-closure/v1
 *
 * Explicitly recover an authored feature together with its tombstoned semantic
 * ancestors, without guessing from visible timeline order or body geometry.
 * This is an inspection + acknowledged atomic transaction, not auto-repair.
 */
import {
  featureTimelineOf, parseProject, planProject, ProjectFormatError,
  ProjectRevisionError,
} from './index.ts';
import type { Feature, FeatureStatus, ProjectDocument } from './index.ts';
import { MAX_TRANSACTION_EVENTS, commitUndoableTransaction, parseUndoHistory } from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import {
  FEATURE_LIFECYCLE_FORMAT, previewFeatureRestoration,
} from './feature-lifecycle.ts';
import type { FeatureLifecyclePreview } from './feature-lifecycle.ts';

export const FEATURE_RECOVERY_CLOSURE_FORMAT = 'intuit3d.feature-recovery-closure' as const;
export const FEATURE_RECOVERY_CLOSURE_VERSION = 1 as const;

export interface FeatureRecoveryInspectionRequest {
  readonly format: typeof FEATURE_RECOVERY_CLOSURE_FORMAT;
  readonly version: typeof FEATURE_RECOVERY_CLOSURE_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  /** User-selected tombstones; active features cannot be recovered. */
  readonly selectedFeatureIds: readonly string[];
}
export interface FeatureRecoveryCommitRequest extends FeatureRecoveryInspectionRequest {
  /** One fresh journal ID for every requiredFeatureId, in returned order. */
  readonly eventIds: readonly string[];
  readonly admission: 'require_ready' | 'permit_unresolved';
  /** Acknowledge bringing back more than the explicitly selected features. */
  readonly confirmAncestorRestore: boolean;
  /** Acknowledge any unresolved post-restoration intent; never imply geometry. */
  readonly confirmUnresolved: boolean;
}
export interface FeatureRecoveryInspection {
  readonly format: 'intuit3d.feature-recovery-inspection';
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly selectedFeatureIds: readonly string[];
  /** Dependency-first where acyclic, stable semantic IDs and timeline ties. */
  readonly requiredFeatureIds: readonly string[];
  readonly additionalAncestorIds: readonly string[];
  readonly missingDependencyIds: readonly string[];
  readonly unresolved: readonly {
    readonly featureId: string;
    readonly status: Exclude<FeatureStatus, 'ready'>;
    readonly diagnosticCodes: readonly string[];
  }[];
  /** An existing ready feature must never be sacrificed by recovery. */
  readonly regressedReadyFeatureIds: readonly string[];
  readonly canRequireReady: boolean;
  readonly exactGeometryAuthority: false;
}
export interface FeatureRecoveryPreview {
  readonly format: 'intuit3d.feature-recovery-preview';
  readonly version: 1;
  readonly inspection: FeatureRecoveryInspection;
  readonly lifecycle: FeatureLifecyclePreview;
  readonly exactGeometryAuthority: false;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(message: string): never {
  throw new ProjectFormatError('feature recovery closure: ' + message);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = Object.getPrototypeOf(value);
  return p === Object.prototype || p === null;
}
function fields(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name));
}
const INSPECTION_KEYS = [
  'format','version','expectedProjectId','expectedRevision','selectedFeatureIds',
] as const;
const COMMIT_KEYS = [...INSPECTION_KEYS,
  'eventIds','admission','confirmAncestorRestore','confirmUnresolved'] as const;

function validateInspection(value: unknown, isCommit: boolean): asserts value is FeatureRecoveryInspectionRequest {
  if (!plain(value) || !fields(value, isCommit ? COMMIT_KEYS : INSPECTION_KEYS) ||
      value.format !== FEATURE_RECOVERY_CLOSURE_FORMAT ||
      value.version !== FEATURE_RECOVERY_CLOSURE_VERSION ||
      typeof value.expectedProjectId !== 'string' || !ID.test(value.expectedProjectId) ||
      !Number.isSafeInteger(value.expectedRevision) ||
      !Array.isArray(value.selectedFeatureIds) ||
      value.selectedFeatureIds.length < 1 ||
      value.selectedFeatureIds.length > MAX_TRANSACTION_EVENTS ||
      value.selectedFeatureIds.some((id: unknown) => typeof id !== 'string' || !ID.test(id)) ||
      new Set(value.selectedFeatureIds).size !== value.selectedFeatureIds.length) {
    fail('invalid version, project fence, or selected tombstone IDs');
  }
}
function snapshotFeatures(doc: ProjectDocument): Map<string, Feature> {
  // Reconstruct the *last authored* semantic feature including tombstones.
  // Parsing first guarantees no edit happened while a feature was retired.
  const features = new Map<string, Feature>();
  for (const event of doc.journal) {
    if (event.type === 'feature.create') features.set(event.feature.id, event.feature);
    if (event.type === 'feature.edit') {
      const previous = features.get(event.featureId)!;
      features.set(event.featureId, { ...previous, ...event.patch });
    }
  }
  return features;
}
function requiredOrder(
  candidateIds: readonly string[], byId: ReadonlyMap<string, Feature>,
): string[] {
  const selected = new Set(candidateIds);
  const done = new Set<string>();
  const visiting = new Set<string>();
  const ordered: string[] = [];
  // Explicit stack prevents deep CAD histories overflowing the JS stack.
  for (const root of candidateIds) {
    const frames: { id: string; next: number }[] = [{ id: root, next: 0 }];
    while (frames.length) {
      const frame = frames[frames.length - 1]!;
      if (done.has(frame.id)) { frames.pop(); continue; }
      if (!visiting.has(frame.id)) visiting.add(frame.id);
      const deps = byId.get(frame.id)!.dependsOn.filter((id) => selected.has(id));
      if (frame.next < deps.length) {
        const dep = deps[frame.next++]!;
        if (!done.has(dep) && !visiting.has(dep)) frames.push({ id: dep, next: 0 });
        // Cycles are retained and diagnosed by planProject after preview;
        // never silently delete a cycle edge or call it ready.
      } else {
        visiting.delete(frame.id);
        done.add(frame.id);
        ordered.push(frame.id);
        frames.pop();
      }
    }
  }
  return ordered;
}

/** Inspection never commits probe IDs or returns a speculative provider shape. */
export function inspectFeatureRecoveryClosure(
  source: ProjectDocument, request: FeatureRecoveryInspectionRequest,
): FeatureRecoveryInspection {
  validateInspection(request, false);
  const doc = parseProject(source);
  if (request.expectedProjectId !== doc.projectId ||
      request.expectedRevision !== doc.revision) {
    throw new ProjectRevisionError('feature recovery closure: stale project/revision');
  }
  const timeline = featureTimelineOf(doc);
  const active = new Map(timeline.map((row) => [row.featureId, row.active] as const));
  const byId = snapshotFeatures(doc);
  for (const id of request.selectedFeatureIds) {
    if (active.get(id) !== false) fail('selection is not a tombstone: ' + id);
  }
  const required = new Set(request.selectedFeatureIds);
  const pending = [...required];
  const missing = new Set<string>();
  for (let i = 0; i < pending.length; i++) {
    for (const dep of byId.get(pending[i]!)!.dependsOn) {
      if (!byId.has(dep)) { missing.add(dep); continue; }
      if (active.get(dep) === false && !required.has(dep)) {
        required.add(dep);
        pending.push(dep);
      }
    }
    if (required.size > MAX_TRANSACTION_EVENTS) {
      fail('restoration exceeds atomic journal capacity; split explicitly');
    }
  }
  const chronology = timeline.filter((row) => required.has(row.featureId))
    .map((row) => row.featureId);
  const requiredFeatureIds = requiredOrder(chronology, byId);
  const selected = new Set(request.selectedFeatureIds);
  const additionalAncestorIds = requiredFeatureIds.filter((id) => !selected.has(id));
  // Probe IDs must be fresh, even in a project that uses the same namespace.
  const used = new Set(doc.journal.map((event) => event.eventId));
  let serial = 0;
  const probeIds = requiredFeatureIds.map(() => {
    let id: string;
    do { id = 'recovery.inspect.' + serial++; } while (used.has(id));
    used.add(id);
    return id;
  });
  const preview = previewFeatureRestoration(doc, {
    format: FEATURE_LIFECYCLE_FORMAT, version: 1, action: 'restore',
    expectedProjectId: doc.projectId, expectedRevision: doc.revision,
    featureIds: requiredFeatureIds, eventIds: probeIds,
    admission: 'permit_unresolved',
  });
  const state = new Map(preview.plan.features.map((row) => [row.feature.id, row] as const));
  const unresolved = requiredFeatureIds.flatMap((id) => {
    const row = state.get(id)!;
    return row.status === 'ready' ? [] : [{
      featureId: id, status: row.status as Exclude<FeatureStatus, 'ready'>,
      diagnosticCodes: row.diagnostics.map((diag) => diag.code),
    }];
  });
  const regressedReadyFeatureIds = planProject(doc).features
    .filter((row) => row.status === 'ready' && state.get(row.feature.id)?.status !== 'ready')
    .map((row) => row.feature.id);
  return {
    format: 'intuit3d.feature-recovery-inspection', version: 1,
    projectId: doc.projectId, revision: doc.revision,
    selectedFeatureIds: [...request.selectedFeatureIds],
    requiredFeatureIds, additionalAncestorIds,
    missingDependencyIds: [...missing].sort(), unresolved,
    regressedReadyFeatureIds,
    canRequireReady: unresolved.length === 0 && regressedReadyFeatureIds.length === 0,
    exactGeometryAuthority: false,
  };
}

/** Re-inspect the exact source revision, then validate every explicit acknowledgement. */
export function previewFeatureRecoveryClosure(
  source: ProjectDocument, request: FeatureRecoveryCommitRequest,
): FeatureRecoveryPreview {
  validateInspection(request, true);
  if (!Array.isArray(request.eventIds) || request.eventIds.length < 1 ||
      request.eventIds.length > MAX_TRANSACTION_EVENTS ||
      request.eventIds.some((id) => typeof id !== 'string' || !ID.test(id)) ||
      new Set(request.eventIds).size !== request.eventIds.length ||
      !['require_ready','permit_unresolved'].includes(request.admission) ||
      typeof request.confirmAncestorRestore !== 'boolean' ||
      typeof request.confirmUnresolved !== 'boolean') {
    fail('invalid event IDs or acknowledgement fields');
  }
  const { eventIds, admission, confirmAncestorRestore, confirmUnresolved, ...inspectionRequest } = request;
  const inspection = inspectFeatureRecoveryClosure(source, inspectionRequest);
  if (eventIds.length !== inspection.requiredFeatureIds.length) {
    fail('one fresh event ID required for each inspected restoration in dependency order');
  }
  if (inspection.additionalAncestorIds.length > 0 && !confirmAncestorRestore) {
    fail('additional ancestor restoration requires explicit confirmation');
  }
  if (inspection.regressedReadyFeatureIds.length) {
    fail('recovery regresses existing ready features: ' + inspection.regressedReadyFeatureIds.join(', '));
  }
  if (inspection.unresolved.length) {
    if (admission === 'require_ready') fail('restoration retains unresolved intent');
    if (!confirmUnresolved) fail('unresolved restoration requires explicit confirmation');
  }
  const lifecycle = previewFeatureRestoration(source, {
    format: FEATURE_LIFECYCLE_FORMAT, version: 1, action: 'restore',
    expectedProjectId: request.expectedProjectId,
    expectedRevision: request.expectedRevision,
    featureIds: inspection.requiredFeatureIds, eventIds, admission,
  });
  return { format: 'intuit3d.feature-recovery-preview', version: 1,
    inspection, lifecycle, exactGeometryAuthority: false };
}

/** One atomic undo frame; semantic tombstone IDs persist after save/reopen. */
export function commitUndoableFeatureRecoveryClosure(
  source: UndoHistory, request: FeatureRecoveryCommitRequest,
): UndoHistory {
  const history = parseUndoHistory(source);
  const preview = previewFeatureRecoveryClosure(history.document, request);
  return commitUndoableTransaction(history, preview.lifecycle.events, request.expectedRevision);
}
