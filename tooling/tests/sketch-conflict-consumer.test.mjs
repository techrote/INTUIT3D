/**
 * Integration-owned consumer gate for the admitted SKETCH conflict-explanation
 * API. A witness is a derived linear-solver diagnosis, never B-rep authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { plateSketchFixture, editConstraint, parseSketch, serializeSketch, solveSketch } from '../../packages/sketch/index.mjs';
import { explainLinearConflict } from '../../packages/sketch/conflict-explanation/v1';

function contradictoryPlate() {
  const source = plateSketchFixture();
  source.constraints.push({ id: 'opposed-width', kind: 'distanceX', a: 'p0', b: 'p1', value: 140 });
  return source;
}

test('integration consumer: derived conflict witness never changes authored sketch', () => {
  const source = contradictoryPlate();
  const before = serializeSketch(source);
  const explanation = explainLinearConflict(source);
  assert.equal(explanation.status, 'minimal_conflict');
  assert.equal(explanation.previewOnly, true);
  assert.equal(explanation.sourceStatus, 'conflicted');
  assert.deepEqual(explanation.constraintIds, ['opposed-width', 'width']);
  assert.equal(explanation.inputSignature, before);
  assert.equal(serializeSketch(source), before);
  assert.equal(solveSketch(source).geometry, null);
});

test('integration consumer: retrospective dimension change invalidates witness stamp', () => {
  const before = contradictoryPlate();
  const previous = explainLinearConflict(before);
  const changed = editConstraint(before, 'width', { value: 150 });
  const reopened = parseSketch(serializeSketch(changed));
  const current = explainLinearConflict(reopened);
  assert.notEqual(previous.inputSignature, current.inputSignature);
  assert.equal(current.inputSignature, serializeSketch(reopened));
  assert.equal(current.status, 'minimal_conflict');
  assert.deepEqual(current.constraintIds, ['opposed-width', 'width']);
  assert.equal(current.previewOnly, true);
});

test('integration consumer: solved documents and exhausted budgets never invent conflict IDs', () => {
  const valid = explainLinearConflict(plateSketchFixture());
  assert.equal(valid.status, 'no_conflict');
  assert.deepEqual(valid.constraintIds, []);
  const budget = explainLinearConflict(contradictoryPlate(), { maxSolves: 1 });
  assert.equal(budget.status, 'budget_exceeded');
  assert.equal(budget.minimal, false);
  assert.deepEqual(budget.constraintIds, []);
  assert.equal(budget.reason, 'solve_count');
});
