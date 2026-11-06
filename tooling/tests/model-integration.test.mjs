/**
 * Consumer contract. It is deliberately not a second model-engine test suite:
 * this checks only the exported model API used across lane boundaries.
 * No B-rep/solver geometry is produced, regardless of dependency-plan status.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyticPlate } from '../plate-oracle.mjs';

const modelPath = fileURLToPath(new URL('../../packages/model/src/index.ts', import.meta.url));
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../integration/fixtures/plate-two-holes.v1.json', import.meta.url)), 'utf8'));

if (!existsSync(modelPath)) {
  test('MODEL_NOT_IMPLEMENTED: no model integration contract executed', { skip: 'packages/model/src/index.ts not yet accepted on main' }, () => {});
} else {
  // Import published TypeScript source through Node 22's strip-types flag.
  // Fail loudly rather than skip if a present model's export cannot be imported.
  const {newProject, commitEvent, planProject, serializeProject, deserializeProject} = await import('../../packages/model/src/index.ts');
  const create = (eventId, id, kind, dependsOn, writeTargets, payload) => ({
    eventId, type: 'feature.create', feature: {id, kind, dependsOn, writeTargets, payload},
  });
  const get = (plan, id) => plan.features.find(x => x.feature.id === id);
  test('consumer: future cut remains pending; plate makes authored-before-target cut executable', () => {
    let d = newProject('project.plate-intent');
    d = commitEvent(d, create('event.cut', 'feature.cut', 'cut', ['feature.plate'], ['body.plate'], {holes:fixture.holes}));
    assert.equal(get(planProject(d), 'feature.cut').status, 'pending');
    d = commitEvent(d, create('event.plate', 'feature.plate', 'extrude', [], ['body.plate'], {
      widthMm:fixture.width, depthMm:fixture.depth, thicknessMm:fixture.thickness,
    }));
    const plan = planProject(d);
    assert.deepEqual(plan.authoredOrder, ['feature.cut', 'feature.plate']);
    assert.deepEqual(plan.executableOrder, ['feature.plate', 'feature.cut']);
    assert.equal(get(plan, 'feature.cut').status, 'ready');
    assert.equal(get(plan, 'feature.plate').status, 'ready');
    assert.equal(analyticPlate(fixture).status, 'analytic_intent_only');
  });
  test('consumer: historical thickness edit survives JSON replay without geometry claims', () => {
    let d = newProject('project.replay-intent');
    d = commitEvent(d, create('event.plate', 'feature.plate', 'extrude', [], ['body.plate'], {thicknessMm:8}));
    const first = d;
    d = commitEvent(d, {
      eventId:'event.edit', type:'feature.edit', featureId:'feature.plate', patch:{payload:{thicknessMm:12}},
    });
    const copy = deserializeProject(serializeProject(d));
    assert.deepEqual(planProject(copy), planProject(d));
    assert.equal(get(planProject(copy), 'feature.plate').feature.payload.thicknessMm, 12);
    assert.equal(get(planProject(first), 'feature.plate').feature.payload.thicknessMm, 8);
    assert.equal(copy.revision, 2);
  });
  test('consumer: unordered writes remain conflicted, not silently linearized by chronology', () => {
    let d = newProject('project.conflict');
    d = commitEvent(d, create('event.a', 'feature.a', 'cut', [], ['body.plate'], {}));
    d = commitEvent(d, create('event.b', 'feature.b', 'cut', [], ['body.plate'], {}));
    const plan = planProject(d);
    assert.deepEqual(plan.executableOrder, []);
    assert.equal(get(plan,'feature.a').status, 'conflicted');
    assert.equal(get(plan,'feature.b').status, 'conflicted');
    assert.ok(get(plan,'feature.b').diagnostics.some(x => x.code === 'UNORDERED_MUTATION'));
  });
}
