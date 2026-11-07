import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectReplacement, PreviewImportGate } from './importReview.ts';
import { newDocument, type Document } from './model.ts';

test('identical preview intent is not reported as a scalar change', () => {
  const a = newDocument(); const review = inspectReplacement(a, { ...a, params: { ...a.params }, chronology: [...a.chronology] });
  assert.deepEqual(review.changedDimensions, []);
  assert.equal(review.chronologyChanged, false);
  assert.equal(review.referenceChanged, false);
  assert.equal(review.currentOperations, 4);
});
test('replacement review preserves exact entered scalars and all changed keys', () => {
  const a = newDocument(); const b = { ...a, id: 'other', name: 'Imported', params: { ...a.params, width: 180, thickness: -1, holeSpacing: 72 }, futureReference: true, chronology: ['Sketch', 'Cut'] };
  const review = inspectReplacement(a, b);
  assert.deepEqual(review.changedDimensions.map(x => x.key), ['width', 'thickness', 'holeSpacing']);
  assert.equal(review.changedDimensions[1]?.incomingMm, -1);
  assert.equal(review.nameChanged, true);
  assert.equal(review.referenceChanged, true);
  assert.equal(review.chronologyChanged, true);
});
test('signed zero remains a visible change, not a silently equivalent scalar', () => {
  const a = newDocument(); const b = { ...a, params: { ...a.params, thickness: -0 } } satisfies Document;
  assert.equal(inspectReplacement(a, b).changedDimensions.length, 1);
  assert.ok(Object.is(inspectReplacement(a, b).changedDimensions[0]?.incomingMm, -0));
});
test('chronology changes with same count are detected', () => {
  const a = newDocument(); const b = { ...a, chronology: [...a.chronology.slice(0,-1), 'Replacement cut'] };
  assert.equal(inspectReplacement(a, b).chronologyChanged, true);
});
test('identity and retrospective resolution changes appear without dimension changes', () => {
  const a = newDocument(); const b = { ...a, id: 'other', referenceResolved: true };
  const r = inspectReplacement(a, b);
  assert.equal(r.nameChanged, true);
  assert.equal(r.referenceChanged, true);
  assert.equal(r.changedDimensions.length, 0);
});
test('async file import tickets reject stale and canceled reads', async () => {
  const gate = new PreviewImportGate();
  let resolveOld!: (value: string) => void;
  const old = new Promise<string>((resolve) => { resolveOld = resolve; });
  const oldTicket = gate.begin();
  const newestTicket = gate.begin();
  resolveOld('valid but stale file');
  await old;
  assert.equal(gate.isCurrent(oldTicket), false);
  assert.equal(gate.isCurrent(newestTicket), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(newestTicket), false);
  assert.equal(gate.isCurrent(0), false);
  assert.equal(gate.isCurrent(NaN), false);
});
