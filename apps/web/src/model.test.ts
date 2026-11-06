import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  apply, diagnostics, featureStates, geometryIsAdmissible, newDocument,
  newWorkspace, parseDocument, redo, serializeDocument, undo, type Document,
} from './model.ts';

test('initial plate is admissible as sketch intent, never exact B-rep', () => {
  const initial = newDocument();
  assert.equal(initial.params.width, 120);
  assert.equal(geometryIsAdmissible(initial), true);
  assert.deepEqual(diagnostics(initial), []);
  assert.equal(featureStates(initial).length, 4);
});

test('dimension edits preserve authored feature IDs and append chronology', () => {
  const before = newWorkspace();
  const after = apply(before, { kind: 'dimension', key: 'width', value: 144 });
  assert.equal(after.document.params.width, 144);
  assert.equal(after.document.revision, 1);
  assert.deepEqual(featureStates(before.document).map((f) => f.id), featureStates(after.document).map((f) => f.id));
  assert.match(after.document.chronology.at(-1)!, /width = 144 mm/);
  assert.equal(after.past.length, 1);
  assert.equal(before.document.params.width, 120);
});

test('undo and redo are transactional with new edits clearing redo', () => {
  let w = newWorkspace();
  w = apply(w, { kind: 'dimension', key: 'thickness', value: 10 });
  w = apply(w, { kind: 'dimension', key: 'width', value: 150 });
  assert.equal(w.document.revision, 2);
  w = undo(w);
  assert.equal(w.document.params.width, 120);
  assert.equal(w.document.params.thickness, 10);
  assert.equal(w.future.length, 1);
  w = redo(w);
  assert.equal(w.document.params.width, 150);
  w = undo(w);
  w = apply(w, { kind: 'dimension', key: 'depth', value: 85 });
  assert.equal(w.future.length, 0);
  assert.equal(w.document.params.width, 120);
});

test('invalid hole edits remain editable and stale preview is identified', () => {
  let w = newWorkspace();
  const validated = w.document;
  w = apply(w, { kind: 'dimension', key: 'holeDiameter', value: 74 });
  assert.equal(w.document.params.holeDiameter, 74);
  assert.equal(w.lastValid, validated);
  assert.equal(geometryIsAdmissible(w.document), false);
  assert.ok(diagnostics(w.document).some((d) => d.code === 'hole-overlap'));
  assert.equal(featureStates(w.document).find((x) => x.id === 'cut-holes')?.status, 'blocked');
  w = undo(w);
  assert.equal(geometryIsAdmissible(w.document), true);
  assert.equal(w.document.params.holeDiameter, 12);
});

test('zero and negative dimensions are preserved but never treated as valid geometry', () => {
  let w = newWorkspace();
  w = apply(w, { kind: 'dimension', key: 'thickness', value: 0 });
  assert.equal(w.document.params.thickness, 0);
  assert.equal(geometryIsAdmissible(w.document), false);
  assert.equal(featureStates(w.document).find((x) => x.id === 'extrude-plate')?.status, 'blocked');
  assert.throws(() => apply(w, { kind: 'dimension', key: 'width', value: Infinity }), /finite/);
  assert.throws(() => apply(w, { kind: 'dimension', key: 'width', value: NaN }), /finite/);
});

test('pending forward datum persists and resolves without changing plate readiness', () => {
  let w = newWorkspace();
  w = apply(w, { kind: 'pending-reference', enabled: true });
  assert.equal(featureStates(w.document).find((f) => f.id === 'future-datum')?.status, 'pending');
  assert.equal(geometryIsAdmissible(w.document), true);
  w = apply(w, { kind: 'resolve-reference', enabled: true });
  assert.equal(featureStates(w.document).find((f) => f.id === 'future-datum')?.status, 'preview-ready');
  w = undo(w);
  assert.equal(featureStates(w.document).find((f) => f.id === 'future-datum')?.status, 'pending');
});

test('versioned project save and reopen preserves parameter changes, intent and edit order', () => {
  let w = newWorkspace();
  w = apply(w, { kind: 'dimension', key: 'holeSpacing', value: 60 });
  w = apply(w, { kind: 'pending-reference', enabled: true });
  const loaded = parseDocument(serializeDocument(w.document));
  assert.deepEqual(loaded, w.document);
  assert.equal(loaded.chronology.length, 6);
  assert.equal(loaded.revision, 2);
});

test('import rejects malicious/corrupt, unsupported and nonfinite data', () => {
  const good = newDocument();
  const data = JSON.parse(serializeDocument(good)) as Record<string, unknown>;
  assert.throws(() => parseDocument('{not JSON'), SyntaxError);
  assert.throws(() => parseDocument(JSON.stringify({ ...data, version: 99 })), /Unsupported/);
  assert.throws(() => parseDocument(JSON.stringify({ ...data, units: 'in' })), /millimetre/);
  assert.throws(() => parseDocument(JSON.stringify({ ...data, rogue: true })), /envelope/);
  assert.throws(() => parseDocument(JSON.stringify({ ...data, id: '<script>' })), /project ID/);
  assert.throws(() => parseDocument(JSON.stringify({ ...data, params: { ...(good.params as object), thickness: null } })), /finite/);
  assert.throws(() => parseDocument(JSON.stringify({ ...data, chronology: Array(1025).fill('x') })), /chronology/);
  assert.throws(() => parseDocument(' '.repeat(1024 * 1024 + 1)), /1 MiB/);
});

test('invalid-but-well-formed import shows no unrelated last-good geometry', () => {
  const invalid = { ...newDocument(), params: { ...newDocument().params, thickness: -1 } } satisfies Document;
  const loaded = newWorkspace(parseDocument(serializeDocument(invalid)));
  assert.equal(loaded.lastValid, null);
  assert.ok(diagnostics(loaded.document).length > 0);
});

test('equivalent no-op commands do not grow journal or undo history', () => {
  const w = newWorkspace();
  assert.equal(apply(w, { kind: 'dimension', key: 'width', value: 120 }), w);
  assert.equal(apply(w, { kind: 'pending-reference', enabled: false }), w);
  assert.equal(apply(w, { kind: 'resolve-reference', enabled: true }), w);
});
