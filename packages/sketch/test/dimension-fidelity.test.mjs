import test from 'node:test';
import assert from 'node:assert/strict';
import { createSketch, solveSketch, editConstraint, serializeSketch, parseSketch, plateSketchFixture, buildPlateProfile } from '../index.mjs';
import { assessSignedDistanceFidelity, SIGNED_DIMENSION_FIDELITY_VERSION } from '../dimension-fidelity.mjs';

function distanceSketch(anchor, dimension, y = false) {
  const axis = y ? 'y' : 'x';
  return createSketch({
    version: 1, units: 'mm',
    points: [{ id: 'a', x: y ? 0 : anchor, y: y ? anchor : 0 },
             { id: 'b', x: y ? 0 : anchor, y: y ? anchor : 0 }],
    lines: [], circles: [],
    constraints: [
      { id: 'anchor', kind: 'fixed', point: 'a', x: y ? 0 : anchor, y: y ? anchor : 0 },
      { id: 'distance', kind: y ? 'distanceY' : 'distanceX',
        a: 'a', b: 'b', value: dimension }
    ]
  });
}
test('large-origin positive signed dimension cannot vanish under absolute residual tolerance', () => {
  const sketch = distanceSketch(1e155, 1e-170);
  const result = solveSketch(sketch);
  assert.equal(result.status, 'numerical_failure');
  assert.equal(result.geometry, null);
  assert.deepEqual(result.diagnostics[0].candidates, ['distance']);
  assert.equal(result.diagnostics[0].code, 'dimension_precision_lost');
});
test('negative Y dimension cannot silently collapse at a negative large origin', () => {
  const sketch = distanceSketch(-1e155, -1e-170, true);
  const result = solveSketch(sketch);
  assert.equal(result.status, 'numerical_failure');
  assert.equal(result.geometry, null);
  assert.deepEqual(result.diagnostics[0].candidates, ['distance']);
});
test('true microscopic nonzero X/Y displacement remains an editable underconstrained preview', () => {
  for (const y of [false, true]) for (const distance of [-1e-170, 1e-170]) {
    const sketch = distanceSketch(0, distance, y);
    const result = solveSketch(sketch);
    assert.equal(result.status, 'underconstrained');
    assert.equal(result.geometry.points[1][y ? 'y' : 'x'], distance);
    assert.equal(result.diagnostics.some(d => d.code === 'dimension_precision_lost'), false);
  }
});
test('ordinary fractional dimensions and the solved plate remain available', () => {
  const sketch = distanceSketch(120, 20.1);
  const result = solveSketch(sketch);
  assert.equal(result.status, 'underconstrained');
  assert.equal(assessSignedDistanceFidelity(sketch, result.geometry).status, 'verified');
  const plate = plateSketchFixture();
  const solved = solveSketch(plate);
  assert.equal(solved.status, 'solved');
  assert.equal(buildPlateProfile(plate, solved, ['bottom','right','top','left'], ['holeA','holeB']).status, 'analytic_profile_only');
});
test('relative precision loss is rejected even when physical residual is below 1e-9 mm', () => {
  const sketch = distanceSketch(120, 1e-12);
  const result = solveSketch(sketch);
  assert.equal(result.status, 'numerical_failure');
  assert.equal(result.geometry, null);
  assert.ok(result.diagnostics.some(d => d.code === 'dimension_precision_lost'));
});
test('changing an authored dimension and JSON replay preserve refusal and IDs', () => {
  const original = distanceSketch(120, 0.25);
  assert.equal(solveSketch(original).status, 'underconstrained');
  const updated = editConstraint(original, 'distance', { value: 1e-15 });
  assert.equal(solveSketch(updated).status, 'numerical_failure');
  const reopened = parseSketch(serializeSketch(updated));
  assert.equal(solveSketch(reopened).status, 'numerical_failure');
  assert.equal(original.constraints[1].value, 0.25);
  assert.deepEqual(reopened.constraints.map(c => c.id), original.constraints.map(c => c.id));
});
test('a tiny contradictory dimension is not erased by absolute residual tolerance', () => {
  const sketch = distanceSketch(0, 1e-170);
  sketch.constraints.push({ id: 'lockB', kind: 'fixed', point: 'b', x: 0, y: 0 });
  const result = solveSketch(sketch);
  assert.notEqual(result.status, 'solved');
  assert.equal(result.geometry, null);
  assert.ok(result.diagnostics.some(d => d.code === 'dimension_precision_lost' || d.code === 'contradictory_constraints'));
  const candidate = {
    points: [{id:'a',x:0,y:0},{id:'b',x:1e-170,y:0}],
    lines: [], circles: []
  };
  assert.deepEqual(assessSignedDistanceFidelity(sketch, candidate).failedConstraintIds, ['lockB']);
});
test('diagnostic rejects tampered geometry and malformed inputs without promoting them', () => {
  const sketch = distanceSketch(0, 1e-170);
  const geometry = solveSketch(sketch).geometry;
  assert.equal(SIGNED_DIMENSION_FIDELITY_VERSION, 1);
  assert.equal(assessSignedDistanceFidelity(sketch, geometry).previewOnly, true);
  const forged = structuredClone(geometry);
  forged.points[1].x = 0;
  assert.deepEqual(assessSignedDistanceFidelity(sketch, forged).failedConstraintIds, ['distance']);
  assert.equal(assessSignedDistanceFidelity(sketch, { points: [{id:'a',x:NaN,y:0}] }).reason,'invalid_input');
  assert.equal(assessSignedDistanceFidelity(sketch, { points: [] }).reason,'invalid_input');
});
