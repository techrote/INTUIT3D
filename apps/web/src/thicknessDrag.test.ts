import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nudgeThickness, projectThicknessAxis, proposeThicknessDrag } from './thicknessDrag.ts';

test('vertical world-Y projects to screen-up, with a millimetre snap', () => {
  const axis = projectThicknessAxis({ x: 300, y: 380 }, { x: 300, y: 280 }, 20);
  assert.deepEqual(axis, { x: 0, y: -5 });
  const drag = { startClient: { x: 400, y: 350 }, initialMm: 8, axisPixelsPerMm: axis };
  assert.equal(proposeThicknessDrag(drag, { x: 400, y: 335 }), 11);
  assert.equal(proposeThicknessDrag(drag, { x: 400, y: 355 }), 7);
  assert.equal(proposeThicknessDrag(drag, { x: 400, y: 350 }), 8);
});

test('orthogonal motion cannot change thickness, including diagonally projected axes', () => {
  const drag = { startClient: { x: 20, y: 20 }, initialMm: 8, axisPixelsPerMm: { x: 3, y: -4 } };
  assert.equal(proposeThicknessDrag(drag, { x: 60, y: 50 }), 8); // perpendicular: (40,30)
  assert.equal(proposeThicknessDrag(drag, { x: 50, y: -20 }), 18);
});

test('shift-like fine snapping, negative intent and keyboard edits are not clamped', () => {
  const drag = { startClient: { x: 0, y: 0 }, initialMm: 8, axisPixelsPerMm: { x: 0, y: -10 } };
  assert.equal(proposeThicknessDrag(drag, { x: 0, y: -13 }, 0.1), 9.3);
  assert.equal(proposeThicknessDrag(drag, { x: 0, y: 120 }), -4);
  assert.equal(nudgeThickness(8, 'up'), 9);
  assert.equal(nudgeThickness(8, 'down', 0.1), 7.9);
  assert.equal(nudgeThickness(-1, 'down'), -2);
});

test('camera flip is explicit; frozen axis remains unchanged across subsequent projections', () => {
  const frozen = projectThicknessAxis({ x: 0, y: 0 }, { x: 40, y: 20 }, 10);
  const drag = { startClient: { x: 0, y: 0 }, initialMm: 5, axisPixelsPerMm: frozen };
  assert.equal(proposeThicknessDrag(drag, { x: 20, y: 10 }), 10);
  assert.deepEqual(frozen, { x: 4, y: 2 });
  assert.deepEqual(projectThicknessAxis({ x: 0, y: 0 }, { x: -40, y: -20 }, 10), { x: -4, y: -2 });
  assert.equal(proposeThicknessDrag(drag, { x: 20, y: 10 }), 10);
});

test('singular, near-end-on and corrupt projected screen axes fail closed', () => {
  assert.throws(() => projectThicknessAxis({ x: 0, y: 0 }, { x: 0, y: 0 }, 10), /edge-on/);
  assert.throws(() => projectThicknessAxis({ x: 0, y: 0 }, { x: 0.01, y: 0 }, 1), /edge-on/);
  assert.throws(() => projectThicknessAxis({ x: NaN, y: 0 }, { x: 0, y: 0 }, 1), /Invalid/);
  assert.throws(() => projectThicknessAxis({ x: 0, y: 0 }, { x: 1, y: 0 }, 0), /Invalid/);
  assert.throws(() => projectThicknessAxis({ x: 0, y: 0 }, { x: Infinity, y: 0 }, 1), /Invalid/);
});

test('bad runtime gesture input, unsupported increment and overflow do not produce valid proposals', () => {
  const drag = { startClient: { x: 0, y: 0 }, initialMm: 8, axisPixelsPerMm: { x: 0, y: -4 } };
  assert.throws(() => proposeThicknessDrag(drag, { x: NaN, y: 0 }), /Invalid/);
  assert.throws(() => proposeThicknessDrag(drag, { x: 0, y: 5 }, 0), /Invalid/);
  assert.throws(() => proposeThicknessDrag({ ...drag, axisPixelsPerMm: { x: 0, y: 0 } }, { x: 0, y: 4 }), /insufficient/);
  assert.throws(() => proposeThicknessDrag(drag, { x: 0, y: 1e15 }), /overflow/);
  assert.throws(() => nudgeThickness(Infinity, 'up'), /Invalid/);
  assert.throws(() => nudgeThickness(1e9, 'up'), /overflow/);
});

test('rounding is deterministic across repeated no-motion and subpixel drags', () => {
  const drag = { startClient: { x: 400, y: 350 }, initialMm: 8, axisPixelsPerMm: { x: 0, y: -5 } };
  for (let i = 0; i < 1000; i++) assert.equal(proposeThicknessDrag(drag, { x: 400, y: 349.5 }), 8);
  assert.equal(proposeThicknessDrag(drag, { x: 400, y: 349.5 }, 0.1), 8.1);
});
