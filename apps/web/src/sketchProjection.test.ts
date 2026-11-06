import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectClientToSketchSvg } from './sketchProjection.ts';

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as const;

test('identity projection preserves client coordinates', () => {
  assert.deepEqual(projectClientToSketchSvg(500, 325, identity), { x: 500, y: 325 });
});

test('viewport translation and CSS scaling do not change the sketch origin', () => {
  const screen = { a: 0.5, b: 0, c: 0, d: 0.5, e: 100, f: 200 };
  assert.deepEqual(projectClientToSketchSvg(350, 362.5, screen), { x: 500, y: 325 });
});

test('skewed and rotated viewBox can be inverted without browser DOM', () => {
  const matrix = { a: 2, b: -1, c: 1, d: 2, e: 120, f: 40 };
  assert.deepEqual(projectClientToSketchSvg(2 * 12 + 1 * 8 + 120, -12 + 2 * 8 + 40, matrix), { x: 12, y: 8 });
});

test('mirrored coordinate axes retain orientation without cursor flipping', () => {
  assert.deepEqual(projectClientToSketchSvg(430, 230,
    { a: -2, b: 0, c: 0, d: 3, e: 500, f: -70 }), { x: 35, y: 100 });
});

test('missing DOM screen transform never invents an SVG origin', () => {
  assert.equal(projectClientToSketchSvg(500, 325, null), null);
});

test('singular, rank-deficient, near-collinear and all-zero matrices fail closed', () => {
  for (const matrix of [
    { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
    { a: 2, b: 4, c: 3, d: 6, e: 0, f: 0 },
    { a: 1, b: 1, c: 1, d: 1 + 1e-14, e: 0, f: 0 },
  ]) assert.equal(projectClientToSketchSvg(500, 325, matrix), null);
});

test('non-finite screen points and matrix entries are rejected', () => {
  for (const point of [[NaN, 0], [Infinity, 1], [0, -Infinity]]) {
    assert.equal(projectClientToSketchSvg(point[0]!, point[1]!, identity), null);
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(projectClientToSketchSvg(500, 325, { ...identity, c: value }), null);
  }
});

test('unbounded and tiny matrix scales fail closed, while valid tiny scales invert', () => {
  assert.equal(projectClientToSketchSvg(10, 10, { ...identity, a: 1e15 }), null);
  assert.equal(projectClientToSketchSvg(10, 10, { ...identity, a: 1e-16, d: 1e-16 }), null);
  const point = projectClientToSketchSvg(0.005, 0.00325,
    { a: 1e-5, b: 0, c: 0, d: 1e-5, e: 0, f: 0 });
  assert.ok(point && Math.abs(point.x - 500) < 1e-10 && Math.abs(point.y - 325) < 1e-10);
});

test('extreme inverse coordinates and determinant overflow fail closed', () => {
  assert.equal(projectClientToSketchSvg(1e9, 0, identity), null);
  assert.equal(projectClientToSketchSvg(1, 2, { ...identity, a: 1e200, d: 1e200 }), null);
});

test('input objects are not mutated by coordinate projection', () => {
  const screen = Object.freeze({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
  assert.deepEqual(projectClientToSketchSvg(4, 8, screen), { x: 2, y: 4 });
  assert.equal(screen.a, 2);
});
