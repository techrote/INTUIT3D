/**
 * @intuit3d/model/body-rebuild-manifest/v1
 *
 * A revision-fenced, multi-body model-to-runtime handoff after retrospective
 * edits, cut reattachment, history repair and removal. This is only a semantic
 * rebuild schedule: a reusable candidate is NOT a verified provider cache,
 * and no row proves that a solid, edge placement or STEP export exists.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type {
  Feature, FeatureStatus, ProjectDocument,
} from './index.ts';
import {
  planIncrementalEvaluation,
} from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';

export const BODY_REBUILD_MANIFEST_FORMAT = 'intuit3d.body-rebuild-manifest' as const;
export const BODY_REBUILD_MANIFEST_VERSION = 1 as const;
export type BodyRebuildAction =
  'rebuild' | 'retire' | 'hold_unresolved' | 'preserve_candidate';

export interface BodyRebuildRequest {
  readonly format: typeof BODY_REBUILD_MANIFEST_FORMAT;
  readonly version: typeof BODY_REBUILD_MANIFEST_VERSION;
  readonly expectedProjectId: string;
  readonly expectedFromRevision: number;
  readonly expectedToRevision: number;
  /** Explicit semantic body targets, not inferred from physical topology. */
  readonly bodyIds: readonly string[];
}

export interface BodyRebuildRow {
  readonly bodyId: string;
  readonly action: BodyRebuildAction;
  /** All current writers of the body in dependency evaluation order. */
  readonly readyWriterIds: readonly string[];
  /** Current writers directly or transitively invalidated by the edit. */
  readonly invalidatedWriterIds: readonly string[];
  /** Previously authored writers no longer targeting this body. */
  readonly departedWriterIds: readonly string[];
  /** Only structural cache candidates; RUNTIME must check provider fences. */
  readonly unchangedWriterCandidates: readonly string[];
  /** Transitive authored inputs, including cross-body datum writers. */
  readonly externalInputFeatureIds: readonly string[];
  /** Changed transitive inputs external to this body's writers. */
  readonly invalidatedExternalInputIds: readonly string[];
  /** Non-ready body writers; do not execute a partial body as current. */
  readonly unresolvedWriters: readonly {
    readonly featureId: string;
    readonly status: Exclude<FeatureStatus, 'ready'>;
    readonly diagnosticCodes: readonly string[];
  }[];
  readonly requiresProviderValidation: true;
}

export interface BodyRebuildManifest {
  readonly format: typeof BODY_REBUILD_MANIFEST_FORMAT;
  readonly version: typeof BODY_REBUILD_MANIFEST_VERSION;
  readonly projectId: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly bodies: readonly BodyRebuildRow[];
  readonly invalidation: IncrementalEvaluationPlan;
  /** The model has no independent geometric or cached-shape authority. */
  readonly exactGeometryAuthority: false;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(reason: string): never {
  throw new ProjectFormatError('body rebuild manifest: ' + reason);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function validateRequest(value: BodyRebuildRequest): void {
  if (!plain(value) ||
      Object.keys(value).length !== 6 ||
      !['format','version','expectedProjectId','expectedFromRevision',
        'expectedToRevision','bodyIds'].every((key) => Object.hasOwn(value, key)) ||
      value.format !== BODY_REBUILD_MANIFEST_FORMAT ||
      value.version !== BODY_REBUILD_MANIFEST_VERSION ||
      typeof value.expectedProjectId !== 'string' ||
      !ID.test(value.expectedProjectId) ||
      !Number.isSafeInteger(value.expectedFromRevision) ||
      !Number.isSafeInteger(value.expectedToRevision) ||
      !Array.isArray(value.bodyIds) ||
      value.bodyIds.length < 1 || value.bodyIds.length > 4096 ||
      value.bodyIds.some((id) => typeof id !== 'string' || !ID.test(id)) ||
      new Set(value.bodyIds).size !== value.bodyIds.length) {
    fail('expected a versioned request with 1-4096 distinct body IDs');
  }
}
function writersOn(features: readonly Feature[], bodyId: string): Feature[] {
  return features.filter((feature) => feature.writeTargets.includes(bodyId));
}
function bodyInputs(
  writers: readonly Feature[], byId: ReadonlyMap<string, Feature>,
): Set<string> {
  const own = new Set(writers.map((feature) => feature.id));
  const seen = new Set<string>();
  const pending = writers.flatMap((feature) => feature.dependsOn);
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i]!;
    if (seen.has(id) || own.has(id)) continue;
    seen.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) pending.push(dep);
  }
  return seen;
}

/**
 * Return the complete semantic invalidation/hold plan for requested bodies.
 * Recognized extrude/cut writers on *other* changed bodies cannot be omitted:
 * a caller must not rebuild half of a multi-body operation while presenting
 * the other body as current. Unknown future operations must supply their body
 * IDs explicitly; we never infer write targets from a geometry cache.
 *
 * Any unresolved writer makes the entire body a hold, retaining its intent.
 * An unaffected body is only a structural preserve candidate. Provider
 * execution and cache fencing always belong to RUNTIME/KERNEL.
 */
export function planBodyRebuildManifest(
  previousInput: ProjectDocument,
  currentInput: ProjectDocument,
  request: BodyRebuildRequest,
): BodyRebuildManifest {
  validateRequest(request);
  const previous = parseProject(previousInput);
  const current = parseProject(currentInput);
  if (previous.projectId !== request.expectedProjectId ||
      current.projectId !== request.expectedProjectId ||
      previous.revision !== request.expectedFromRevision ||
      current.revision !== request.expectedToRevision) {
    throw new ProjectRevisionError('body rebuild manifest: stale project/revision');
  }
  // Also checks journal ancestry, including equal-revision divergent branches.
  const invalidation = planIncrementalEvaluation(previous, current);
  const beforeFeatures = featuresOf(previous);
  const afterFeatures = featuresOf(current);
  const afterPlan = planProject(current);
  const afterById = new Map(afterFeatures.map((feature) => [feature.id, feature] as const));
  const executable = new Set(afterPlan.executableOrder);
  const afterStates = new Map(afterPlan.features.map((entry) =>
    [entry.feature.id, entry] as const));
  const affected = new Set(invalidation.invalidatedFeatureIds);
  const unchanged = new Set(invalidation.unchangedReady);
  const selected = new Set(request.bodyIds);
  const targets = new Set([...beforeFeatures, ...afterFeatures]
    .filter((feature) => feature.kind === 'extrude' || feature.kind === 'cut')
    .flatMap((feature) => feature.writeTargets));
  for (const bodyId of targets) {
    const oldWriters = writersOn(beforeFeatures, bodyId);
    const newWriters = writersOn(afterFeatures, bodyId);
    const newIds = new Set(newWriters.map((f) => f.id));
    const dirty = newWriters.some((f) => affected.has(f.id));
    const departed = oldWriters.some((f) => !newIds.has(f.id));
    if ((dirty || departed) && !selected.has(bodyId)) {
      fail('changed body omitted from handoff: ' + bodyId);
    }
  }

  const bodies = request.bodyIds.map((bodyId): BodyRebuildRow => {
    const oldWriters = writersOn(beforeFeatures, bodyId);
    const newWriters = writersOn(afterFeatures, bodyId);
    if (!oldWriters.length && !newWriters.length) {
      fail('unknown body write target: ' + bodyId);
    }
    const newIds = new Set(newWriters.map((f) => f.id));
    const departedWriterIds = oldWriters
      .filter((f) => !newIds.has(f.id)).map((f) => f.id);
    const invalidatedWriterIds = newWriters
      .filter((f) => affected.has(f.id)).map((f) => f.id);
    const unresolvedWriters = newWriters.flatMap((f) => {
      const state = afterStates.get(f.id)!;
      return state.status === 'ready' ? [] : [{
        featureId: f.id,
        status: state.status as Exclude<FeatureStatus, 'ready'>,
        diagnosticCodes: state.diagnostics.map((d) => d.code),
      }];
    });
    const readyWriterIds = afterPlan.executableOrder
      .filter((id) => newIds.has(id));
    const unchangedWriterCandidates = readyWriterIds
      .filter((id) => unchanged.has(id));
    const inputs = bodyInputs(newWriters, afterById);
    const externalInputFeatureIds = [
      ...afterPlan.executableOrder.filter((id) => inputs.has(id)),
      ...[...inputs].filter((id) => !afterPlan.executableOrder.includes(id)).sort(),
    ];
    const invalidatedExternalInputIds = externalInputFeatureIds
      .filter((id) => affected.has(id));
    const action: BodyRebuildAction =
      !newWriters.length ? 'retire' :
      unresolvedWriters.length ? 'hold_unresolved' :
      invalidatedWriterIds.length || departedWriterIds.length ? 'rebuild' :
      'preserve_candidate';
    return {
      bodyId, action, readyWriterIds,
      invalidatedWriterIds, departedWriterIds,
      unchangedWriterCandidates, externalInputFeatureIds,
      invalidatedExternalInputIds, unresolvedWriters,
      requiresProviderValidation: true,
    };
  });
  return {
    format: BODY_REBUILD_MANIFEST_FORMAT,
    version: BODY_REBUILD_MANIFEST_VERSION,
    projectId: current.projectId,
    fromRevision: previous.revision, toRevision: current.revision,
    bodies, invalidation, exactGeometryAuthority: false,
  };
}
