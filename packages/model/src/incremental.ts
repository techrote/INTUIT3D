/**
 * @intuit3d/model/incremental — additive v1 structural replay invalidation.
 *
 * This is a dependency-aware invalidation *hint*, not an assertion that any
 * geometric or parameter result is valid. The authoritative journal is never
 * changed. Consumers still need matching backend/version/tolerance/cache keys
 * and must rerun provider validation before presenting exact B-rep/STEP.
 */
import { parseProject, planProject, ProjectRevisionError } from './index.ts';
import type { ProjectDocument, EvaluationPlan, FeatureState, FeatureStatus } from './index.ts';

export const INCREMENTAL_EVALUATION_FORMAT = 'intuit3d.incremental-evaluation' as const;
export const INCREMENTAL_EVALUATION_VERSION = 1 as const;

export interface IncrementalEvaluationPlan {
  readonly format: typeof INCREMENTAL_EVALUATION_FORMAT;
  readonly version: typeof INCREMENTAL_EVALUATION_VERSION;
  readonly projectId: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  /** Direct semantic feature changes; includes creation and removal. */
  readonly changedFeatureIds: readonly string[];
  /** Removed from the active model. Never retain their cached shapes. */
  readonly retiredFeatureIds: readonly string[];
  /** Living changed features and all reachable descendants in either dependency graph. */
  readonly invalidatedFeatureIds: readonly string[];
  /** New dependency-admissible order of features requiring evaluation. */
  readonly readyToEvaluate: readonly string[];
  /** Structurally unchanged ready features. Cache reuse needs *additional* provider fences. */
  readonly unchangedReady: readonly string[];
  /** All currently non-ready features remain authored, with their exact diagnostics. */
  readonly unresolved: readonly {
    readonly featureId: string;
    readonly status: Exclude<FeatureStatus, 'ready'>;
    readonly diagnosticCodes: readonly string[];
  }[];
}

function fingerprint(value: unknown): string {
  // parseProject has already cloned/validated JSON payloads and safe identifiers.
  // Different object key ordering may cause a conservative extra invalidation.
  return JSON.stringify(value);
}

function byId(plan: EvaluationPlan): Map<string, FeatureState> {
  return new Map(plan.features.map((entry) => [entry.feature.id, entry]));
}

function addDescendants(plan: EvaluationPlan, reversed: Map<string, Set<string>>): void {
  for (const { feature } of plan.features) {
    for (const upstream of feature.dependsOn) {
      let children = reversed.get(upstream);
      if (!children) {
        children = new Set<string>();
        reversed.set(upstream, children);
      }
      children.add(feature.id);
    }
  }
}

/**
 * Calculate a safe structural invalidation frontier for an append-only revision
 * transition. Divergent revisions and wrong-project caches fail closed.
 *
 * Dependents in BOTH graphs are walked: a removed dependency or a retargeted
 * feature must not leave a previously evaluated descendant looking current.
 * The returned unchangedReady list is a structural candidate list ONLY; it
 * cannot attest the presence, freshness, or exactness of a geometric cache.
 */
export function planIncrementalEvaluation(
  previousInput: ProjectDocument,
  currentInput: ProjectDocument,
): IncrementalEvaluationPlan {
  const previous = parseProject(previousInput);
  const current = parseProject(currentInput);
  if (previous.projectId !== current.projectId ||
      current.revision < previous.revision) {
    throw new ProjectRevisionError('incremental evaluation requires matching project and nondecreasing revision');
  }
  for (let i = 0; i < previous.journal.length; i++) {
    if (fingerprint(previous.journal[i]) !== fingerprint(current.journal[i])) {
      throw new ProjectRevisionError('divergent project journal at event index ' + i + '; full replay required');
    }
  }

  const oldPlan = planProject(previous);
  const newPlan = planProject(current);
  const oldStates = byId(oldPlan);
  const newStates = byId(newPlan);
  const allIds = new Set([...oldStates.keys(), ...newStates.keys()]);
  const changed = new Set<string>();

  for (const id of allIds) {
    const oldState = oldStates.get(id);
    const newState = newStates.get(id);
    if (!oldState || !newState ||
        oldState.status !== newState.status ||
        fingerprint(oldState.feature) !== fingerprint(newState.feature) ||
        fingerprint(oldState.diagnostics) !== fingerprint(newState.diagnostics)) {
      changed.add(id);
    }
  }

  const reverse = new Map<string, Set<string>>();
  addDescendants(oldPlan, reverse);
  addDescendants(newPlan, reverse);
  const invalidated = new Set(changed);
  const queue = [...changed];
  for (let index = 0; index < queue.length; index++) {
    for (const dependent of reverse.get(queue[index]) ?? []) {
      if (invalidated.has(dependent)) continue;
      invalidated.add(dependent);
      queue.push(dependent);
    }
  }

  const living = newPlan.features.map(({ feature }) => feature.id);
  const retired = oldPlan.features.map(({ feature }) => feature.id)
    .filter((id) => !newStates.has(id));
  const readyToEvaluate = newPlan.executableOrder.filter((id) => invalidated.has(id));
  const unchangedReady = newPlan.executableOrder.filter((id) =>
    !invalidated.has(id) && oldStates.get(id)?.status === 'ready');

  return {
    format: INCREMENTAL_EVALUATION_FORMAT,
    version: INCREMENTAL_EVALUATION_VERSION,
    projectId: current.projectId,
    fromRevision: previous.revision,
    toRevision: current.revision,
    changedFeatureIds: [...allIds].filter((id) => changed.has(id)),
    retiredFeatureIds: retired,
    invalidatedFeatureIds: living.filter((id) => invalidated.has(id)),
    readyToEvaluate,
    unchangedReady,
    unresolved: newPlan.features.filter((entry) => entry.status !== 'ready').map((entry) => ({
      featureId: entry.feature.id,
      status: entry.status as Exclude<FeatureStatus, 'ready'>,
      diagnosticCodes: entry.diagnostics.map((d) => d.code),
    })),
  };
}
