import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROJECT_FORMAT, SCHEMA_VERSION, planProject,
  commitEvent, serializeProject, deserializeProject,
} from '../src/index.ts';

// Directly construct the authoritative journal to measure planner behavior;
// repeated commitEvent would instead test quadratic full-document validation.
const id = (n) => 'feature.w' + n;
const document = (projectId, dependencies, writes = new Map()) => ({
  format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION, projectId,
  revision: dependencies.length,
  journal: dependencies.map((dependsOn, i) => ({
    eventId: 'event.w' + i, type: 'feature.create',
    feature: { id: id(i), kind: 'sketch', dependsOn,
      writeTargets: writes.get(i) ?? [], payload: { authoredIndex: i } },
  })),
});

// Independent, intentionally simple quadratic reference scheduler. Consult
// the plan's admitted statuses, then scan authored order on *every* step.
// It is not a copy of the production heap or reverse-dependency planner.
function referenceSchedule(plan) {
  const remaining = plan.features.filter((x) => x.status === 'ready');
  const completed = new Set();
  const result = [];
  while (remaining.length) {
    const i = remaining.findIndex((entry) =>
      entry.feature.dependsOn.every((dep) => completed.has(dep)));
    assert.notEqual(i, -1, 'ready features must form an acyclic graph');
    const [selected] = remaining.splice(i, 1);
    result.push(selected.feature.id);
    completed.add(selected.feature.id);
  }
  return result;
}

test('24,000 independent features retain authored-order stable scheduling', () => {
  const size = 24000;
  const doc = document('project.wide', Array.from({ length: size }, () => []));
  const plan = planProject(doc);
  assert.equal(plan.revision, size);
  assert.equal(plan.executableOrder.length, size);
  assert.equal(plan.authoredOrder.length, size);
  assert.deepEqual(plan.executableOrder, plan.authoredOrder);
  assert.equal(plan.executableOrder[0], id(0));
  assert.equal(plan.executableOrder.at(-1), id(size - 1));
  assert.ok(plan.features.every((entry) =>
    entry.status === 'ready' && entry.diagnostics.length === 0));
});

test('alternating wide and narrow frontiers match an independent scheduling oracle', () => {
  let seed = 0xa1e8f12d;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 80; trial++) {
    const count = 30 + (trial % 40);
    const deps = Array.from({ length: count }, (_, i) => {
      const d = [];
      for (let j = 0; j < count; j++) {
        if (j === i) continue;
        if (next() < 0.016) d.push(id(j));
      }
      // Include pending intent, self-cycles, and ordinary conflicts as inputs
      // to classification; none should leak into the executable heap.
      if (trial % 7 === 0 && i === 3) d.push('feature.not-yet-authored');
      if (trial % 11 === 0 && i === count - 1) d.push(id(i));
      return d;
    });
    const plan = planProject(document('project.oracle.' + trial, deps));
    assert.deepEqual(plan.executableOrder, referenceSchedule(plan), 'trial ' + trial);
    assert.equal(new Set(plan.executableOrder).size, plan.executableOrder.length);
    for (const state of plan.features) {
      assert.equal(plan.executableOrder.includes(state.feature.id),
        state.status === 'ready', 'state membership trial ' + trial);
    }
  }
});

test('long interleaved dependency chains preserve stable eligible ordering', () => {
  const size = 6000;
  const deps = Array.from({ length: size }, (_, i) => {
    if (i % 3 === 2) return [id(i - 1), id(i - 2)];
    if (i % 3 === 1) return [id(i - 1)];
    return [];
  });
  const plan = planProject(document('project.interleaved', deps));
  assert.equal(plan.executableOrder.length, size);
  assert.deepEqual(plan.executableOrder, referenceSchedule(plan));
});

test('save/reopen and later insertion of a future dependency preserve readiness and ordering', () => {
  let doc = document('project.future', [
    ['feature.future'], [], ['feature.w1'], [], ['feature.w0'], [], [],
  ]);
  let plan = planProject(doc);
  assert.equal(plan.features[0].status, 'pending');
  assert.equal(plan.features[4].status, 'blocked');
  assert.equal(plan.executableOrder.includes(id(4)), false);
  assert.deepEqual(plan.executableOrder, referenceSchedule(plan));
  doc = deserializeProject(serializeProject(doc));
  assert.deepEqual(planProject(doc), plan);
  doc = commitEvent(doc, {
    eventId: 'event.future', type: 'feature.create',
    feature: { id: 'feature.future', kind: 'parameter', dependsOn: [],
      writeTargets: [], payload: { lengthMm: 12 } },
  });
  const recovered = planProject(deserializeProject(serializeProject(doc)));
  assert.ok(recovered.features.every((x) => x.status === 'ready'));
  assert.deepEqual(recovered.executableOrder, referenceSchedule(recovered));
  assert.equal(recovered.executableOrder.indexOf('feature.future') <
    recovered.executableOrder.indexOf(id(0)), true);
});
