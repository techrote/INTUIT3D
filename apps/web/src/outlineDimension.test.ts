import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginDimensionGesture, cancelDimensionGesture, commitDimensionGesture, diagnostics,
  geometryIsAdmissible, newWorkspace, previewDimensionGesture, serializeDocument, parseDocument, undo, redo } from './model.ts';
import { nudgeOutlineDimension, outlineAxis, proposeOutlineDimension } from './outlineDimension.ts';

test('three outline handles use correct coordinate axes and symmetric full-dimension offsets', () => {
  assert.equal(outlineAxis('width'), 'x');
  assert.equal(outlineAxis('depth'), 'y');
  assert.equal(outlineAxis('holeDiameter'), 'x');
  assert.equal(proposeOutlineDimension({ key: 'width', startCoordinate: 700, startValueMm: 120, pixelsPerMm: 4 }, 714), 127);
  assert.equal(proposeOutlineDimension({ key: 'depth', startCoordinate: 500, startValueMm: 80, pixelsPerMm: 4 }, 484), 72);
  assert.equal(proposeOutlineDimension({ key: 'holeDiameter', startCoordinate: 400, startValueMm: 12, pixelsPerMm: 4 }, 410), 17);
});

test('fine precision is stable, preserves negative intent and never clamps an overlap', () => {
  const start = { key: 'holeDiameter' as const, startCoordinate: 350, startValueMm: 12, pixelsPerMm: 3.2 };
  assert.equal(proposeOutlineDimension(start, 352, 0.1), 13.3);
  assert.equal(proposeOutlineDimension(start, 350, 0.1), 12);
  assert.equal(proposeOutlineDimension(start, 320), -7);
  assert.equal(proposeOutlineDimension({ ...start, startValueMm: 30 }, 350), 30);
});

test('repeated pointer movements do not accumulate fractional drift', () => {
  const original = { key: 'width' as const, startCoordinate: 500, startValueMm: 120, pixelsPerMm: 3.6 };
  for (let i = 0; i < 256; i++) {
    assert.equal(proposeOutlineDimension(original, 500 + 1.8 * i, 0.1), 120 + i);
  }
});

test('keyboard nudges use only the chosen axis, with exact 0.1 mm increments', () => {
  assert.equal(nudgeOutlineDimension(120, 'width', 'ArrowRight'), 121);
  assert.equal(nudgeOutlineDimension(120, 'width', 'ArrowLeft', 0.1), 119.9);
  assert.equal(nudgeOutlineDimension(80, 'depth', 'ArrowDown', 0.1), 80.1);
  assert.equal(nudgeOutlineDimension(80, 'depth', 'ArrowUp'), 79);
  assert.equal(nudgeOutlineDimension(12, 'holeDiameter', 'ArrowDown'), null);
  assert.equal(nudgeOutlineDimension(80, 'depth', 'ArrowRight'), null);
});

test('nonfinite positions, broken scales, unknown keys and unsupported steps fail closed', () => {
  const s = { key: 'width' as const, startCoordinate: 200, startValueMm: 120, pixelsPerMm: 4 };
  assert.throws(() => proposeOutlineDimension(s, NaN), /Invalid frozen/);
  assert.throws(() => proposeOutlineDimension({ ...s, pixelsPerMm: 0 }, 400), /Invalid frozen/);
  assert.throws(() => proposeOutlineDimension({ ...s, pixelsPerMm: Infinity }, 400), /Invalid frozen/);
  assert.throws(() => proposeOutlineDimension(s, 201, 0), /Unsupported/);
  assert.throws(() => proposeOutlineDimension({ ...s, key: 'bogus' as never }, 300), /Unknown/);
  assert.throws(() => proposeOutlineDimension(s, 1e15), /outside/);
  assert.throws(() => nudgeOutlineDimension(NaN, 'width', 'ArrowRight'), /Invalid/);
});

test('width drag is one undo event, survives export/reopen and preserves semantic chronology', () => {
  let w = newWorkspace();
  w = beginDimensionGesture(w, 'width');
  const start = { key: 'width' as const, startCoordinate: 700, startValueMm: 120, pixelsPerMm: 4 };
  for (let i = 1; i <= 128; i++) w = previewDimensionGesture(w, proposeOutlineDimension(start, 700 + i * 0.25, 0.1));
  assert.equal(w.document.revision, 0);
  assert.equal(w.past.length, 0);
  w = commitDimensionGesture(w);
  assert.equal(w.document.revision, 1);
  assert.equal(w.past.length, 1);
  assert.equal(w.document.params.width, 136);
  assert.equal(parseDocument(serializeDocument(w.document)).params.width, 136);
  assert.equal(undo(w).document.params.width, 120);
  assert.equal(redo(undo(w)).document.params.width, 136);
});

test('invalid outline drag retains edit and stale last-good geometry; cancellation restores all', () => {
  const start = newWorkspace();
  let w = beginDimensionGesture(start, 'holeDiameter');
  w = previewDimensionGesture(w, 99);
  assert.equal(geometryIsAdmissible(w.document), false);
  assert.equal(w.lastValid, start.document);
  w = commitDimensionGesture(w);
  assert.ok(diagnostics(w.document).some((d) => d.code === 'hole-boundary'));
  assert.equal(w.document.params.holeDiameter, 99);
  assert.equal(w.lastValid, start.document);
  assert.equal(undo(w).document.params.holeDiameter, 12);
  let draft = beginDimensionGesture(start, 'depth');
  draft = previewDimensionGesture(draft, -20);
  assert.equal(cancelDimensionGesture(draft).document, start.document);
  assert.equal(cancelDimensionGesture(draft).past.length, 0);
});

test('journal-full document refuses outline transaction and does not partially commit', () => {
  let w = newWorkspace({ ...newWorkspace().document, chronology: Array(1024).fill('Existing operation') });
  w = beginDimensionGesture(w, 'depth');
  w = previewDimensionGesture(w, 123);
  assert.throws(() => commitDimensionGesture(w), /capacity reached/);
  assert.equal(w.document.revision, 0);
  assert.equal(w.document.params.depth, 123);
  assert.equal(undo(w).document.params.depth, 80);
});
