import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROJECT_FORMAT, SCHEMA_VERSION, planProject, commitEvent,
  serializeProject, deserializeProject,
} from '../src/index.ts';

// Construct a journal directly: repeated commitEvent would test quadratic full
// journal validation instead of the dependency planner under qualification.
function document(projectId, dependencies, writes = new Map()) {
  const journal = dependencies.map((deps, i) => ({
    eventId: 'event.n' + i,
    type: 'feature.create',
    feature: {
      id: 'feature.n' + i, kind: 'feature',
      dependsOn: deps, writeTargets: writes.get(i) ?? [], payload: {},
    },
  }));
  return { format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION,
    projectId, revision: journal.length, journal };
}
const id = (i) => 'feature.n' + i;
const states = (plan) => new Map(plan.features.map((entry) => [entry.feature.id, entry]));

test('12,000 nonchronological feature dependencies retain executable order and transitive same-body writes', () => {
  const size = 12000;
  const deps = Array.from({ length: size }, (_, i) => i + 1 < size ? [id(i + 1)] : []);
  const writes = new Map([[0, ['body.plate']], [size - 1, ['body.plate']]]);
  const result = planProject(document('project.long', deps, writes));
  assert.equal(result.authoredOrder.length, size);
  assert.equal(result.authoredOrder[0], id(0));
  assert.equal(result.executableOrder.length, size);
  assert.equal(result.executableOrder[0], id(size - 1));
  assert.equal(result.executableOrder[size - 1], id(0));
  assert.ok(result.features.every((entry) => entry.status === 'ready'));
  assert.ok(result.features.every((entry) => entry.diagnostics.length === 0));
});

test('10,000-node dependency graph retains a small deep cycle, blocks upstream dependents and admits an unrelated branch', () => {
  const size = 10000;
  const deps = Array.from({ length: size }, (_, i) => i + 1 < size ? [id(i + 1)] : [id(size - 2)]);
  const doc = document('project.deep-cycle', deps);
  const independent = commitEvent(doc, {
    eventId: 'event.unrelated', type: 'feature.create',
    feature: { id: 'feature.unrelated', kind: 'feature', dependsOn: [],
      writeTargets: ['body.unrelated'], payload: {} },
  });
  const result = planProject(independent);
  const byId = states(result);
  assert.deepEqual(result.executableOrder, ['feature.unrelated']);
  assert.equal(byId.get(id(size - 1)).status, 'conflicted');
  assert.equal(byId.get(id(size - 2)).status, 'conflicted');
  assert.deepEqual(
    byId.get(id(size - 1)).diagnostics.find((d) => d.code === 'DEPENDENCY_CYCLE').relatedIds,
    [id(size - 2), id(size - 1)],
  );
  assert.equal(byId.get(id(size - 3)).status, 'blocked');
  assert.deepEqual(byId.get(id(size - 3)).diagnostics.map((d) => d.code), ['BLOCKED_DEPENDENCY']);
  assert.equal(byId.get(id(0)).status, 'blocked');
  assert.equal(byId.get('feature.unrelated').status, 'ready');
});

test('independent reachability oracle agrees on SCC conflicts, pending intent and blocked descendants', () => {
  let seed = 0x1a2b3c4d;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 100; trial++) {
    const count = 9;
    const deps = Array.from({length: count}, () => {
      const entries = [];
      for (let j = 0; j < count; j++) if (next() < 0.13) entries.push(id(j));
      if (next() < 0.08) entries.push('feature.future.' + trial);
      return entries;
    });
    const plan = planProject(document('project.oracle.' + trial, deps));
    const byId = states(plan);
    const reach = Array.from({length: count}, (_, root) => {
      const visited = new Set(), queue = [root];
      while (queue.length) {
        const node = queue.pop();
        for (const dep of deps[node]) {
          const n = Number(dep.slice('feature.n'.length));
          if (!dep.startsWith('feature.n') || !Number.isInteger(n) ||
              n < 0 || n >= count || visited.has(n)) continue;
          visited.add(n);
          queue.push(n);
        }
      }
      return visited;
    });
    const expected = new Map();
    for (let i = 0; i < count; i++) {
      const cycle = deps[i].includes(id(i)) ||
        [...reach[i]].some((j) => j !== i && reach[j].has(i));
      if (cycle) expected.set(id(i), 'conflicted');
      else if (deps[i].some((dep) => dep.startsWith('feature.future.'))) {
        expected.set(id(i), 'pending');
      }
    }
    // Since every true cycle has already been marked, pending/conflict
    // descendants admit a simple finite fixed-point propagation oracle.
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < count; i++) {
        if (expected.has(id(i))) continue;
        if (deps[i].some((dep) => expected.has(dep))) {
          expected.set(id(i), 'blocked');
          changed = true;
        }
      }
    }
    for (let i = 0; i < count; i++) {
      const actual = byId.get(id(i));
      assert.equal(actual.status, expected.get(id(i)) ?? 'ready', 'trial ' + trial + ' feature ' + i);
      if (actual.status === 'blocked') {
        const directBlocked = deps[i].filter((dep) => (expected.get(dep) ?? 'ready') !== 'ready');
        assert.deepEqual(
          actual.diagnostics.filter((d) => d.code === 'BLOCKED_DEPENDENCY').map((d) => d.relatedIds[0]),
          directBlocked, 'direct diagnostic fidelity trial ' + trial + ' feature ' + i,
        );
      }
      if (actual.status === 'conflicted') {
        assert.ok(actual.diagnostics.some((d) => d.code === 'SELF_DEPENDENCY' ||
          d.code === 'DEPENDENCY_CYCLE'));
      }
    }
  }
});

test('replay preserves pending-to-ready recovery and authored order distinct from dependency order', () => {
  const deps = Array.from({length: 180}, (_, i) => i + 1 < 180 ? [id(i + 1)] : []);
  let doc = document('project.replay', deps);
  doc = commitEvent(doc, {eventId: 'event.retarget', type: 'feature.edit',
    featureId: id(175), patch: {dependsOn: ['feature.future']}});
  const blocked = planProject(doc);
  assert.equal(states(blocked).get(id(175)).status, 'pending');
  assert.equal(states(blocked).get(id(0)).status, 'blocked');
  assert.equal(states(blocked).get(id(176)).status, 'ready');
  const reloaded = deserializeProject(serializeProject(doc));
  assert.deepEqual(planProject(reloaded), blocked);
  doc = commitEvent(reloaded, {eventId: 'event.future', type: 'feature.create',
    feature: {id: 'feature.future', kind: 'feature', dependsOn: [],
      writeTargets: [], payload: {parameter: 12}}});
  const recovered = planProject(deserializeProject(serializeProject(doc)));
  assert.equal(recovered.authoredOrder[0], id(0));
  assert.equal(recovered.authoredOrder.at(-1), 'feature.future');
  assert.equal(recovered.executableOrder[0], id(179));
  assert.equal(recovered.executableOrder.at(-1), id(0));
  assert.ok(recovered.features.every((entry) => entry.status === 'ready'));
});
