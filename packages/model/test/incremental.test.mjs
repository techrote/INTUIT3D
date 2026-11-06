import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newProject, commitEvent, serializeProject, deserializeProject,
  ProjectRevisionError, planProject,
} from '../src/index.ts';
import {
  planIncrementalEvaluation, INCREMENTAL_EVALUATION_FORMAT,
  INCREMENTAL_EVALUATION_VERSION,
} from '../src/incremental.ts';

const feature = (id, deps = [], writes = [], payload = {}) =>
  ({ id, kind: 'feature', dependsOn: deps, writeTargets: writes, payload });
const create = (id, deps = [], writes = [], payload = {}) =>
  ({ eventId: 'event.create.' + id, type: 'feature.create', feature: feature(id, deps, writes, payload) });
const edit = (eventId, id, patch) =>
  ({ eventId, type: 'feature.edit', featureId: id, patch });
const remove = (eventId, id) => ({ eventId, type: 'feature.remove', featureId: id });
const restore = (eventId, id) => ({ eventId, type: 'feature.restore', featureId: id });
const append = (doc, event) => commitEvent(doc, event);

test('v1 delta contract handles no-op and independent creation without re-evaluating the plate', () => {
  let doc = newProject('project.incremental');
  doc = append(doc, create('feature.sketch', [], ['sketch.plate']));
  doc = append(doc, create('feature.extrude', ['feature.sketch'], ['body.plate']));
  const same = planIncrementalEvaluation(doc, deserializeProject(serializeProject(doc)));
  assert.equal(same.format, INCREMENTAL_EVALUATION_FORMAT);
  assert.equal(same.version, INCREMENTAL_EVALUATION_VERSION);
  assert.deepEqual(same.changedFeatureIds, []);
  assert.deepEqual(same.invalidatedFeatureIds, []);
  assert.deepEqual(same.readyToEvaluate, []);
  assert.deepEqual(same.unchangedReady, ['feature.sketch', 'feature.extrude']);

  const next = append(doc, create('feature.other', [], ['body.other']));
  const result = planIncrementalEvaluation(doc, next);
  assert.deepEqual(result.changedFeatureIds, ['feature.other']);
  assert.deepEqual(result.invalidatedFeatureIds, ['feature.other']);
  assert.deepEqual(result.readyToEvaluate, ['feature.other']);
  assert.deepEqual(result.unchangedReady, ['feature.sketch', 'feature.extrude']);
});

test('retrospective parameter edit invalidates only dependent sketch, extrude and cut', () => {
  let doc = newProject('project.parameter');
  doc = append(doc, create('parameter.width', [], [], {widthMm: 90}));
  doc = append(doc, create('feature.sketch', ['parameter.width'], ['sketch.plate']));
  doc = append(doc, create('feature.extrude', ['feature.sketch'], ['body.plate']));
  doc = append(doc, create('feature.cut', ['feature.extrude'], ['body.plate']));
  doc = append(doc, create('feature.other', [], ['body.other']));
  const next = append(doc, edit('event.width.edit', 'parameter.width', {payload: {widthMm: 110}}));
  const result = planIncrementalEvaluation(doc, deserializeProject(serializeProject(next)));
  assert.deepEqual(result.changedFeatureIds, ['parameter.width']);
  assert.deepEqual(result.invalidatedFeatureIds, [
    'parameter.width', 'feature.sketch', 'feature.extrude', 'feature.cut',
  ]);
  assert.deepEqual(result.readyToEvaluate, [
    'parameter.width', 'feature.sketch', 'feature.extrude', 'feature.cut',
  ]);
  assert.deepEqual(result.unchangedReady, ['feature.other']);
  assert.deepEqual(result.unresolved, []);
});

test('future target introduction recovers pending child and blocks neither independent branch nor persistence', () => {
  let doc = append(newProject('project.forward'), create('feature.cut', ['feature.extrude'], ['body.plate']));
  const before = planProject(doc);
  assert.equal(before.features[0].status, 'pending');
  doc = append(doc, create('feature.other', [], ['body.other']));
  const after = append(doc, create('feature.extrude', [], ['body.plate']));
  const delta = planIncrementalEvaluation(doc, after);
  assert.deepEqual(delta.readyToEvaluate, ['feature.extrude', 'feature.cut']);
  assert.deepEqual(delta.unchangedReady, ['feature.other']);
  assert.deepEqual(delta.invalidatedFeatureIds, ['feature.cut', 'feature.extrude']);
  assert.deepEqual(delta.unresolved, []);
});

test('removed dependency is retired and invalidates formerly executable dependent; restoration recovers it', () => {
  let doc = append(newProject('project.restore'), create('feature.sketch'));
  doc = append(doc, create('feature.extrude', ['feature.sketch']));
  const removed = append(doc, remove('event.remove', 'feature.sketch'));
  const delta = planIncrementalEvaluation(doc, removed);
  assert.deepEqual(delta.retiredFeatureIds, ['feature.sketch']);
  assert.deepEqual(delta.invalidatedFeatureIds, ['feature.extrude']);
  assert.deepEqual(delta.readyToEvaluate, []);
  assert.deepEqual(delta.unresolved, [{
    featureId: 'feature.extrude', status: 'pending', diagnosticCodes: ['MISSING_REFERENCE'],
  }]);
  const recovered = append(removed, restore('event.restore', 'feature.sketch'));
  const recovery = planIncrementalEvaluation(removed, recovered);
  assert.deepEqual(recovery.readyToEvaluate, ['feature.sketch', 'feature.extrude']);
  assert.deepEqual(recovery.retiredFeatureIds, []);
});

test('retargeting dependency propagates through old and new edges and descendants', () => {
  let doc = append(newProject('project.retarget'), create('feature.old'));
  doc = append(doc, create('feature.new'));
  doc = append(doc, create('feature.child', ['feature.old']));
  doc = append(doc, create('feature.grandchild', ['feature.child']));
  const next = append(doc, edit('event.retarget', 'feature.child', {dependsOn: ['feature.new']}));
  const delta = planIncrementalEvaluation(doc, next);
  assert.deepEqual(delta.changedFeatureIds, ['feature.child']);
  assert.deepEqual(delta.invalidatedFeatureIds, ['feature.child','feature.grandchild']);
  assert.deepEqual(delta.readyToEvaluate, ['feature.child','feature.grandchild']);
  assert.deepEqual(delta.unchangedReady, ['feature.old','feature.new']);
});

test('unordered same-body writers explicitly become conflicted; reconciliation enables both', () => {
  let doc = append(newProject('project.conflict'), create('feature.first', [], ['body.plate']));
  const conflict = append(doc, create('feature.second', [], ['body.plate']));
  const delta = planIncrementalEvaluation(doc, conflict);
  assert.deepEqual(delta.readyToEvaluate, []);
  assert.deepEqual(delta.invalidatedFeatureIds, ['feature.first', 'feature.second']);
  assert.deepEqual(delta.unresolved.map(x => [x.featureId, x.status]), [
    ['feature.first','conflicted'],['feature.second','conflicted'],
  ]);
  const repaired = append(conflict,
    edit('event.order', 'feature.second', {dependsOn: ['feature.first']}));
  const recovered = planIncrementalEvaluation(conflict, repaired);
  assert.deepEqual(recovered.readyToEvaluate, ['feature.first','feature.second']);
  assert.deepEqual(recovered.unresolved, []);
});

test('branch divergence, rollback and cross-project reuse are rejected rather than trusted', () => {
  const base = newProject('project.fork');
  const a = append(base, create('feature.a'));
  const b = append(base, create('feature.b'));
  assert.throws(() => planIncrementalEvaluation(a, b), ProjectRevisionError);
  assert.throws(() => planIncrementalEvaluation(a, base), ProjectRevisionError);
  assert.throws(() => planIncrementalEvaluation(a, newProject('project.other')), ProjectRevisionError);
  const b2 = append(a, create('feature.b'));
  assert.deepEqual(planIncrementalEvaluation(a, b2).readyToEvaluate, ['feature.b']);
});

test('diagnostic-only change is not silently reusable; independent branch remains ready', () => {
  let doc = append(newProject('project.pending'), create('feature.future', ['feature.missing']));
  doc = append(doc, create('feature.independent', [], ['body.independent']));
  const next = append(doc, create('feature.missing', ['feature.future']));
  const delta = planIncrementalEvaluation(doc, next);
  assert.deepEqual(delta.readyToEvaluate, []);
  assert.deepEqual(delta.unchangedReady, ['feature.independent']);
  assert.deepEqual(delta.invalidatedFeatureIds, ['feature.future', 'feature.missing']);
  assert.equal(delta.unresolved[0].status, 'conflicted');
  assert.equal(delta.unresolved[1].status, 'conflicted');
  assert.ok(delta.unresolved.every(x => x.diagnosticCodes.includes('DEPENDENCY_CYCLE')));
});

test('bounded wide history: only transitive suffix is invalidated, with deterministic reopen', () => {
  let doc = newProject('project.wide');
  for (let i = 0; i < 48; i++) {
    doc = append(doc, create('feature.n' + i, i ? ['feature.n' + (i - 1)] : []));
  }
  doc = append(doc, create('feature.unrelated'));
  const next = append(doc, edit('event.change', 'feature.n23', {payload: {depthMm: 6}}));
  const a = planIncrementalEvaluation(doc, next);
  const b = planIncrementalEvaluation(
    deserializeProject(serializeProject(doc)),
    deserializeProject(serializeProject(next)),
  );
  assert.deepEqual(a, b);
  assert.equal(a.readyToEvaluate.length, 25);
  assert.deepEqual(a.unchangedReady.slice(0,2), ['feature.n0','feature.n1']);
  assert.ok(a.unchangedReady.includes('feature.unrelated'));
  assert.ok(!a.readyToEvaluate.includes('feature.n22'));
});
