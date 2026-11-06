import test from 'node:test';
import assert from 'node:assert/strict';
import { createSketch, plateSketchFixture, editConstraint, solveSketch, serializeSketch, parseSketch } from '../index.mjs';
import { explainLinearConflict, CONFLICT_EXPLANATION_VERSION } from '../conflict-explanation.mjs';

const contradictory = () => {
  const doc = plateSketchFixture();
  doc.constraints.push({ id: 'width:opposed', kind: 'distanceX', a: 'p0', b: 'p1', value: 140 });
  return doc;
};
const witness = doc => explainLinearConflict(doc);

test('linear contradictory width isolates exact pair, not unrelated plate constraints', () => {
  const doc = contradictory();
  const saved = serializeSketch(doc);
  const result = witness(doc);
  assert.equal(result.version, CONFLICT_EXPLANATION_VERSION);
  assert.equal(result.status, 'minimal_conflict');
  assert.equal(result.sourceStatus, 'conflicted');
  assert.equal(result.minimal, true);
  assert.equal(result.previewOnly, true);
  assert.deepEqual(result.constraintIds, ['width', 'width:opposed']);
  assert.ok(result.witnessDiagnostics.some(d => d.code === 'contradictory_constraints'));
  assert.equal(result.inputSignature, saved);
  assert.equal(serializeSketch(doc), saved);
  assert.ok(result.solves > 2);
});

test('each returned constraint is necessary for a contradictory witness', () => {
  const doc = contradictory();
  const result = witness(doc);
  const set = new Set(result.constraintIds);
  const sub = constraints => solveSketch({ ...doc, constraints });
  assert.equal(sub(doc.constraints.filter(c => set.has(c.id))).status, 'conflicted');
  for (const id of set) {
    const reduced = sub(doc.constraints.filter(c => set.has(c.id) && c.id !== id));
    assert.notEqual(reduced.status, 'conflicted');
    assert.notEqual(reduced.status, 'numerical_failure');
  }
});

test('order-independent witness even with redundant and unrelated constraints', () => {
  const doc = contradictory();
  doc.constraints.push({ id: 'width:duplicate', kind: 'distanceX', a: 'p0', b: 'p1', value: 120 });
  const first = witness(doc);
  const reversed = witness({ ...doc, constraints: [...doc.constraints].reverse() });
  assert.equal(first.status, 'minimal_conflict');
  assert.deepEqual(first.constraintIds, reversed.constraintIds);
  assert.equal(first.constraintIds.length, 2);
  assert.ok(first.constraintIds.includes('width:opposed'));
});

test('independent conflicts yield one irreducible witness, not an invented complete explanation', () => {
  const doc = contradictory();
  doc.constraints.push({ id: 'height:opposed', kind: 'distanceY', a: 'p1', b: 'p2', value: 99 });
  const result = witness(doc);
  assert.equal(result.status, 'minimal_conflict');
  assert.equal(result.constraintIds.length, 2);
  assert.ok(result.constraintIds.includes('width:opposed') || result.constraintIds.includes('height:opposed'));
  const selected = new Set(result.constraintIds);
  assert.equal(solveSketch({ ...doc, constraints: doc.constraints.filter(c => selected.has(c.id)) }).status, 'conflicted');
});

test('equal-radius contradiction identifies three authored constraints', () => {
  const doc = createSketch({ version:1,units:'mm',
    points:[{id:'ca',x:0,y:0},{id:'cb',x:10,y:0}], lines:[],
    circles:[{id:'a',center:'ca',radius:3},{id:'b',center:'cb',radius:4}],
    constraints:[
      {id:'radiusA',kind:'radius',circle:'a',value:3},
      {id:'radiusB',kind:'radius',circle:'b',value:4},
      {id:'tie',kind:'equalRadius',a:'a',b:'b'}
    ] });
  const result = witness(doc);
  assert.equal(result.status, 'minimal_conflict');
  assert.deepEqual(result.constraintIds, ['radiusA', 'radiusB', 'tie']);
});

test('consistent, redundant and underconstrained documents do not get conflicts', () => {
  const doc = plateSketchFixture();
  assert.equal(witness(doc).status, 'no_conflict');
  doc.constraints.push({id:'sameWidth',kind:'distanceX',a:'p0',b:'p1',value:120});
  assert.equal(witness(doc).status, 'no_conflict');
  doc.constraints = [];
  const free = witness(doc);
  assert.equal(free.status, 'no_conflict');
  assert.equal(free.sourceStatus, 'underconstrained');
  assert.deepEqual(free.constraintIds, []);
  assert.equal(free.minimal, false);
});

test('save/reopen and retrospective dimensional changes preserve diagnosis', () => {
  for (const width of [90,110,125,200]) {
    const doc = contradictory();
    const next = editConstraint(doc, 'width', { value: width });
    const replay = parseSketch(serializeSketch(next));
    assert.deepEqual(witness(next), witness(replay));
    assert.equal(witness(replay).status, 'minimal_conflict');
    assert.deepEqual(witness(replay).constraintIds, ['width', 'width:opposed']);
  }
});

test('strict variable and constraint budgets fail closed without solver calls', () => {
  const doc = contradictory();
  const tooManyConstraints = explainLinearConflict(doc, {maxConstraints:2});
  assert.equal(tooManyConstraints.status, 'budget_exceeded');
  assert.equal(tooManyConstraints.reason, 'constraint_count');
  assert.equal(tooManyConstraints.solves, 0);
  assert.deepEqual(tooManyConstraints.constraintIds, []);
  const tooManyVariables = explainLinearConflict(doc, {maxVariables:13});
  assert.equal(tooManyVariables.status, 'budget_exceeded');
  assert.equal(tooManyVariables.reason, 'variable_count');
  assert.equal(tooManyVariables.solves, 0);
});

test('insufficient solve budget cannot claim minimality', () => {
  const result = explainLinearConflict(contradictory(), {maxSolves:1});
  assert.equal(result.status, 'budget_exceeded');
  assert.equal(result.reason, 'solve_count');
  assert.equal(result.solves, 1);
  assert.equal(result.minimal, false);
  assert.deepEqual(result.constraintIds, []);
});

test('malformed options and source are rejected rather than silently weakened', () => {
  const doc = contradictory();
  for (const options of [null, [], { maxSolves:0 }, { maxSolves:257 },
    { maxVariables:1.5 }, { maxConstraints:Infinity }, { unlimited:true }]) {
    assert.throws(() => explainLinearConflict(doc, options), /invalid/);
  }
  assert.throws(() => witness({ ...doc, units:'inches' }), /unsupported version or units/);
});

test('near-overflow inputs are not certified as a minimal conflict on numeric failure', () => {
  const doc = createSketch({version:1,units:'mm',
    points:[{id:'a',x:1e308,y:0},{id:'b',x:-1e308,y:0}],
    lines:[],circles:[],constraints:[
      {id:'aFixed',kind:'fixed',point:'a',x:1e308,y:0},
      {id:'bFixed',kind:'fixed',point:'b',x:-1e308,y:0},
      {id:'difference',kind:'distanceX',a:'a',b:'b',value:1e308}
    ]});
  const result = witness(doc);
  assert.notEqual(result.status, 'no_conflict');
  assert.notEqual(result.status, 'minimal_conflict');
  assert.equal(result.minimal, false);
  assert.deepEqual(result.constraintIds, []);
});

test('32 changed-dimension contradictions retain deterministic bounded witnesses', () => {
  const base = contradictory();
  for (let n=0; n<32; n++) {
    const doc = editConstraint(base,'width',{value:100+n});
    const result = witness(doc);
    assert.equal(result.status, 'minimal_conflict', 'dimension iteration ' + n);
    assert.deepEqual(result.constraintIds, ['width','width:opposed']);
    assert.ok(result.solves <= 2*doc.constraints.length+2);
  }
});
