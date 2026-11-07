/**
 * Derived dependency invalidation; never authority for semantic edits or
 * solid equivalence. Both plans MUST be produced by INTENT's planner.
 */
export const WORKFLOW_INVALIDATION_FORMAT = 'intuit3d.workflow-invalidation';
export const WORKFLOW_INVALIDATION_VERSION = 1;

function indexPlan(plan) {
  if (!plan || typeof plan.projectId !== 'string' || !plan.projectId ||
      !Number.isSafeInteger(plan.revision) || plan.revision < 0 ||
      !Array.isArray(plan.features) || !Array.isArray(plan.authoredOrder)) {
    throw new TypeError('runtime invalidation: invalid model plan');
  }
  const byId = new Map();
  for (const entry of plan.features) {
    const f = entry?.feature;
    if (typeof f?.id !== 'string' || !f.id || !Array.isArray(f.dependsOn) ||
        f.dependsOn.some(x => typeof x !== 'string' || !x) ||
        byId.has(f.id) || typeof entry.status !== 'string') {
      throw new TypeError('runtime invalidation: invalid or duplicate model feature');
    }
    byId.set(f.id, entry);
  }
  if (plan.authoredOrder.length !== byId.size ||
      new Set(plan.authoredOrder).size !== byId.size ||
      plan.authoredOrder.some(id => !byId.has(id))) {
    throw new TypeError('runtime invalidation: incomplete authored order');
  }
  return byId;
}

/**
 * Conservative structural dependency cut for two authoritative model plans.
 * Uses old and new dependency edges to include deleted/reparented ancestry.
 * NEVER certifies that cached B-rep/STEP is current or reusable.
 */
export function diffWorkflowPlans(previous, current) {
  const old = indexPlan(previous);
  const next = indexPlan(current);
  if (previous.projectId !== current.projectId) {
    throw new Error('runtime invalidation: different projects');
  }
  if (current.revision < previous.revision) {
    throw new Error('runtime invalidation: reverse revision');
  }
  const changed = new Set();
  const dependents = new Map();
  for (const [id, entry] of [...old, ...next]) {
    for (const dep of entry.feature.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep).add(id);
    }
  }
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id), b = next.get(id);
    if (!a || !b || JSON.stringify({feature:a.feature,status:a.status,diagnostics:a.diagnostics}) !==
        JSON.stringify({feature:b.feature,status:b.status,diagnostics:b.diagnostics})) changed.add(id);
  }
  if (previous.revision === current.revision && changed.size) {
    throw new Error('runtime invalidation: same-revision state mismatch');
  }
  const invalidated = new Set(changed);
  const queue = [...changed];
  for (let i = 0; i < queue.length; ++i) {
    for (const id of dependents.get(queue[i]) ?? []) {
      if (invalidated.has(id)) continue;
      invalidated.add(id);
      queue.push(id);
    }
  }
  const ordered = [...current.authoredOrder, ...previous.authoredOrder.filter(x => !next.has(x))];
  return {
    format: WORKFLOW_INVALIDATION_FORMAT,
    version: WORKFLOW_INVALIDATION_VERSION,
    projectId: current.projectId,
    previousRevision: previous.revision,
    revision: current.revision,
    changedFeatureIds: ordered.filter(x => changed.has(x)),
    invalidatedFeatureIds: ordered.filter(x => invalidated.has(x)),
    removedFeatureIds: previous.authoredOrder.filter(x => !next.has(x)),
    unchangedFeatureIds: current.authoredOrder.filter(x => !invalidated.has(x)),
    exactReuseAllowed: false,
  };
}
