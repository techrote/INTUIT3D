import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyticPlate } from '../plate-oracle.mjs';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../integration/fixtures/plate-two-holes.v1.json', import.meta.url)), 'utf8'));

function changed(mutator) {
  const copy = structuredClone(fixture);
  mutator(copy);
  return copy;
}

test('analytic oracle: 120x80x8 plate with two 6mm-radius through holes', () => {
  const result = analyticPlate(fixture);
  const expectedVolume = 76800 - 576 * Math.PI; // 120*80*8 - (2*pi*6^2*8)
  const expectedArea = 22400 + 48 * Math.PI; // top/bottom + four sides + two bore walls
  assert.equal(result.status, 'analytic_intent_only');
  assert.equal(result.solidCount, 1);
  assert.ok(Math.abs(result.volume - expectedVolume) < 1e-9);
  assert.ok(Math.abs(result.surfaceArea - expectedArea) < 1e-9);
  assert.ok(Math.abs(result.volume - fixture.expectedAnalytic.volumeMm3) < 1e-6);
});

test('retrospective thickness change scales expected exact material volume', () => {
  const updated = changed(x => { x.thickness = 12; });
  assert.ok(Math.abs(analyticPlate(updated).volume / analyticPlate(fixture).volume - 1.5) < 1e-12);
});

test('analytic oracle rejects ambiguous boundary contact, coincident and overlapping holes', () => {
  assert.throws(() => analyticPlate(changed(x => { x.holes[0].x = 54; })), /outside or tangent/);
  assert.throws(() => analyticPlate(changed(x => { x.holes[1].x = x.holes[0].x; })), /overlapping or tangent/);
  assert.throws(() => analyticPlate(changed(x => { x.holes[1].x = x.holes[0].x + 12; })), /overlapping or tangent/);
});

test('analytic oracle rejects missing, nonfinite and wrong-unit inputs', () => {
  assert.throws(() => analyticPlate(changed(x => { x.units = 'inch'; })), /unsupported/);
  assert.throws(() => analyticPlate(changed(x => { x.width = Infinity; })), /positive/);
  assert.throws(() => analyticPlate(changed(x => { x.holes[0].radius = 0; })), /invalid/);
  assert.throws(() => analyticPlate(changed(x => { x.holes = null; })), /array/);
});
