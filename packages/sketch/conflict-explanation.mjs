import { validateSketch, serializeSketch, solveSketch } from './index.mjs';

/**
 * Bounded, deterministic deletion-based minimal conflict witness for the v1
 * linear sketch provider. This is a derived diagnostic, not authored intent.
 * It reports ONE irreducible subset, not every independent conflict or a
 * proof of nonlinear/physical geometric feasibility.
 */
export const CONFLICT_EXPLANATION_VERSION = 1;
const DEFAULTS = Object.freeze({ maxConstraints: 64, maxVariables: 192, maxSolves: 192 });
const CAPS = Object.freeze({ maxConstraints: 96, maxVariables: 256, maxSolves: 256 });
const order = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** @param {import('./index.d.mts').SketchDocument} source
 * @param {{maxConstraints?:number,maxVariables?:number,maxSolves?:number}} [options] */
export function explainLinearConflict(source, options = {}) {
  const doc = validateSketch(source);
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(k => !Object.hasOwn(DEFAULTS, k))) {
    throw new TypeError('sketch conflict explanation: invalid options');
  }
  const limits = { ...DEFAULTS, ...options };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > CAPS[key]) {
      throw new TypeError('sketch conflict explanation: invalid ' + key);
    }
  }

  const inputSignature = serializeSketch(doc);
  const ordered = [...doc.constraints].sort(order);
  const variables = 2 * doc.points.length + doc.circles.length;
  let solves = 0;
  const build = (status, sourceStatus = null, constraintIds = [],
    witnessDiagnostics = [], sourceDiagnostics = [], reason = null) => ({
    version: CONFLICT_EXPLANATION_VERSION, previewOnly: true, inputSignature,
    status, sourceStatus, constraintIds, minimal: status === 'minimal_conflict',
    witnessDiagnostics, sourceDiagnostics, solves, reason
  });

  // Refuse potentially quadratic repeated solves before executing ANY solve.
  if (ordered.length > limits.maxConstraints) {
    return build('budget_exceeded', null, [], [], [], 'constraint_count');
  }
  if (variables > limits.maxVariables) {
    return build('budget_exceeded', null, [], [], [], 'variable_count');
  }

  const evaluate = (set) => {
    if (solves >= limits.maxSolves) return null;
    solves++;
    // All subsets use canonical constraint order, independent of authored
    // array order. No temporary, user-visible constraints or IDs are added.
    return solveSketch({ ...doc, constraints: ordered.filter(c => set.has(c.id)) });
  };
  const active = new Set(ordered.map(c => c.id));
  const initial = evaluate(active);
  const sourceStatus = initial.status;
  const sourceDiagnostics = initial.diagnostics;
  if (sourceStatus === 'numerical_failure') {
    return build('numerical_failure', sourceStatus, [], [], sourceDiagnostics, 'source_numerical_failure');
  }
  if (sourceStatus !== 'conflicted') {
    return build('no_conflict', sourceStatus, [], [], sourceDiagnostics);
  }

  for (const c of ordered) {
    const trial = new Set(active);
    trial.delete(c.id);
    const result = evaluate(trial);
    if (!result) return build('budget_exceeded', sourceStatus, [], [], sourceDiagnostics, 'solve_count');
    if (result.status === 'numerical_failure') {
      return build('numerical_failure', sourceStatus, [], [], sourceDiagnostics, 'subset_numerical_failure');
    }
    if (result.status === 'conflicted') active.delete(c.id);
  }

  // Verify the reduced witness and every single-constraint deletion. The
  // numerical solver may not be monotonic near its declared thresholds:
  // when this check cannot establish irreducibility, report no witness.
  const core = evaluate(active);
  if (!core) return build('budget_exceeded', sourceStatus, [], [], sourceDiagnostics, 'solve_count');
  if (core.status === 'numerical_failure') {
    return build('numerical_failure', sourceStatus, [], [], sourceDiagnostics, 'witness_numerical_failure');
  }
  if (core.status !== 'conflicted') {
    return build('unverified', sourceStatus, [], [], sourceDiagnostics, 'witness_not_conflicted');
  }
  for (const id of active) {
    const trial = new Set(active);
    trial.delete(id);
    const result = evaluate(trial);
    if (!result) return build('budget_exceeded', sourceStatus, [], [], sourceDiagnostics, 'solve_count');
    if (result.status === 'numerical_failure') {
      return build('numerical_failure', sourceStatus, [], [], sourceDiagnostics, 'verification_numerical_failure');
    }
    if (result.status === 'conflicted') {
      return build('unverified', sourceStatus, [], [], sourceDiagnostics, 'witness_not_minimal');
    }
  }
  return build('minimal_conflict', sourceStatus, [...active], core.diagnostics, sourceDiagnostics);
}
