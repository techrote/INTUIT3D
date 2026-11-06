import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  apply, beginDimensionGesture, cancelDimensionGesture, commitDimensionGesture,
  diagnostics, newDocument, newWorkspace, parseDocument, previewDimensionGesture,
  redo, serializeDocument, undo,
} from './model.ts';
import { nudgeHolePitch, proposeHolePitch } from './sketchInteraction.ts';
import { proposeThicknessDrag } from './thicknessDrag.ts';

test('100 move events are one undoable dimension and one journal entry', () => {
  const original = newWorkspace();
  let w = beginDimensionGesture(original, 'holeSpacing');
  for (let i = 1; i <= 100; i++) {
    w = previewDimensionGesture(w, 64 + i * 0.1);
    assert.equal(w.document.revision, 0);
    assert.equal(w.past.length, 0);
    assert.equal(w.document.chronology.length, 4);
  }
  w = commitDimensionGesture(w);
  assert.equal(w.document.params.holeSpacing, 74);
  assert.equal(w.document.revision, 1);
  assert.equal(w.past.length, 1);
  assert.equal(w.document.chronology.length, 5);
  assert.equal(w.gesture, null);
  assert.equal(undo(w).document.params.holeSpacing, 64);
  assert.equal(redo(undo(w)).document.params.holeSpacing, 74);
  assert.equal(parseDocument(serializeDocument(w.document)).params.holeSpacing, 74);
});

test('drag cancellation and no-op commit leave no history or dirty revision', () => {
  const initial = newWorkspace();
  let w = beginDimensionGesture(initial, 'holeSpacing');
  w = previewDimensionGesture(w, 50);
  assert.equal(cancelDimensionGesture(w).document, initial.document);
  assert.equal(cancelDimensionGesture(w).past.length, 0);
  w = previewDimensionGesture(w, 64);
  assert.equal(commitDimensionGesture(w).document, initial.document);
  assert.equal(commitDimensionGesture(w).past.length, 0);
});

test('invalid drag keeps the authored proposal and visibly retains the committed last-good preview', () => {
  const initial = newWorkspace();
  let w = beginDimensionGesture(initial, 'holeSpacing');
  w = previewDimensionGesture(w, 8);
  assert.ok(diagnostics(w.document).some((x) => x.code === 'hole-overlap'));
  assert.equal(w.lastValid, initial.document);
  w = commitDimensionGesture(w);
  assert.equal(w.document.params.holeSpacing, 8);
  assert.equal(w.lastValid, initial.document);
  assert.equal(undo(w).document.params.holeSpacing, 64);
  assert.equal(redo(undo(w)).document.params.holeSpacing, 8);
});

test('an invalid imported project cannot acquire a fabricated last-good mesh while dragging', () => {
  const invalid = { ...newDocument(), params: { ...newDocument().params, holeSpacing: 0 } };
  let w = newWorkspace(invalid);
  assert.equal(w.lastValid, null);
  w = beginDimensionGesture(w, 'holeSpacing');
  w = previewDimensionGesture(w, 8);
  assert.equal(w.lastValid, null);
  assert.equal(commitDimensionGesture(w).lastValid, null);
  w = commitDimensionGesture(w);
  w = apply(w, { kind: 'dimension', key: 'holeSpacing', value: 64 });
  assert.equal(w.lastValid?.params.holeSpacing, 64);
});

test('other commands settle an active drag before editing; undo while dragging cancels only draft', () => {
  let w = beginDimensionGesture(newWorkspace(), 'holeSpacing');
  w = previewDimensionGesture(w, 57);
  const renamed = apply(w, { kind: 'rename', name: 'Cured design' });
  assert.equal(renamed.document.revision, 2);
  assert.equal(renamed.past.length, 2);
  assert.equal(undo(renamed).document.params.holeSpacing, 57);
  const mid = beginDimensionGesture(renamed, 'holeSpacing');
  const cancelled = undo(previewDimensionGesture(mid, 22));
  assert.equal(cancelled.document, renamed.document);
  assert.equal(cancelled.document.revision, 2);
  assert.equal(cancelled.past.length, 2);
});

test('drag starts on right and continues smoothly even after crossing the sketch origin', () => {
  const start = { side: 'right' as const, startSvgX: 550, startPitchMm: 64, pixelsPerMm: 4 };
  assert.equal(proposeHolePitch(start, 530), 54);
  assert.equal(proposeHolePitch(start, 500), 39);
  assert.equal(proposeHolePitch(start, 490), 34);
  assert.equal(proposeHolePitch(start, 390), -16); // preserved invalid intent
  assert.equal(proposeHolePitch({ ...start, side: 'left' }, 530), 74);
});

test('sketch drag uses frozen pixel scale and precision snap without cumulative drift', () => {
  const gesture = { side: 'right' as const, startSvgX: 250, startPitchMm: 64, pixelsPerMm: 3.2 };
  assert.equal(proposeHolePitch(gesture, 254, 0.1), 66.5);
  assert.equal(proposeHolePitch(gesture, 252, 1), 65);
  assert.equal(proposeHolePitch(gesture, 250), 64);
  assert.equal(proposeHolePitch(gesture, 254, 0.5), 66.5);
});

test('keyboard arrow direction depends on selected side and supports fine increments', () => {
  assert.equal(nudgeHolePitch(64, 'right', 'right'), 65);
  assert.equal(nudgeHolePitch(64, 'right', 'left'), 63);
  assert.equal(nudgeHolePitch(64, 'left', 'left'), 65);
  assert.equal(nudgeHolePitch(64, 'left', 'right', 0.1), 63.9);
});

test('gesture validation fails closed on bad transforms, unknown keys and nonfinite proposals', () => {
  assert.throws(() => beginDimensionGesture(newWorkspace(), 'hack' as never), /Unknown/);
  assert.throws(() => previewDimensionGesture(newWorkspace(), 5), /No active/);
  assert.throws(() => previewDimensionGesture(beginDimensionGesture(newWorkspace(), 'holeSpacing'), NaN), /finite/);
  assert.throws(() => proposeHolePitch({ side: 'right', startSvgX: 0, startPitchMm: 2, pixelsPerMm: 0 }, 100), /Invalid/);
  assert.throws(() => proposeHolePitch({ side: 'right', startSvgX: 0, startPitchMm: 2, pixelsPerMm: 2 }, Infinity), /Invalid/);
  assert.throws(() => nudgeHolePitch(64, 'left', 'left', 0), /Invalid/);
});

test('journal capacity fails closed before creating an unsaveable preview project', () => {
  const full = { ...newDocument(), chronology: Array(1024).fill('Previously authored action') };
  const w = newWorkspace(full);
  assert.throws(() => apply(w, { kind: 'dimension', key: 'width', value: 124 }), /capacity reached/);
  assert.equal(w.document.params.width, 120);
  assert.equal(w.document.chronology.length, 1024);
  assert.deepEqual(parseDocument(serializeDocument(w.document)).chronology, full.chronology);
});

test('undo across invalid revisions cannot display future geometry as an earlier last-good mesh', () => {
  let w = newWorkspace();
  const original = w.document;
  w = apply(w, { kind: 'dimension', key: 'holeSpacing', value: 4 }); // invalid
  w = apply(w, { kind: 'dimension', key: 'holeSpacing', value: 70 }); // valid later
  assert.equal(w.lastValid?.params.holeSpacing, 70);
  w = undo(w); // revision 1 invalid
  assert.equal(w.document.params.holeSpacing, 4);
  assert.equal(w.lastValid, original);
  w = redo(w);
  assert.equal(w.document.params.holeSpacing, 70);
  const invalidImport = { ...newDocument(), params: { ...newDocument().params, thickness: -5 } };
  let loaded = newWorkspace(invalidImport);
  loaded = apply(loaded, { kind: 'dimension', key: 'thickness', value: 8 });
  assert.equal(loaded.lastValid?.params.thickness, 8);
  loaded = undo(loaded);
  assert.equal(loaded.lastValid, null);
});

test('3D projected thickness drag is one undoable preview command and survives save/reopen', () => {
  const before = newWorkspace();
  const slope = { x: 2, y: -3 };
  const drag = { startClient: { x: 200, y: 180 }, initialMm: 8, axisPixelsPerMm: slope };
  let w = beginDimensionGesture(before, 'thickness');
  for (let i = 1; i <= 100; i++) {
    w = previewDimensionGesture(w, proposeThicknessDrag(drag,
      { x: 200 + i * slope.x / 20, y: 180 + i * slope.y / 20 }, 0.1));
    assert.equal(w.document.revision, 0);
    assert.equal(w.past.length, 0);
  }
  w = commitDimensionGesture(w);
  assert.equal(w.document.params.thickness, 13);
  assert.equal(w.document.revision, 1);
  assert.equal(w.past.length, 1);
  assert.equal(undo(w).document.params.thickness, 8);
  assert.equal(redo(undo(w)).document.params.thickness, 13);
  assert.equal(parseDocument(serializeDocument(w.document)).params.thickness, 13);
});

test('3D thickness crossing zero preserves pending intent and a stale preview, not a false solid', () => {
  let w = newWorkspace();
  const original = w.document;
  const drag = { startClient: { x: 30, y: 30 }, initialMm: 8, axisPixelsPerMm: { x: 0, y: -4 } };
  w = beginDimensionGesture(w, 'thickness');
  w = previewDimensionGesture(w, proposeThicknessDrag(drag, { x: 30, y: 70 }));
  assert.equal(w.document.params.thickness, -2);
  assert.equal(w.document.revision, 0);
  assert.equal(w.lastValid, original);
  assert.ok(diagnostics(w.document).some(d => d.featureId === 'extrude-plate'));
  w = commitDimensionGesture(w);
  assert.equal(w.document.params.thickness, -2);
  assert.equal(w.lastValid, original);
  assert.equal(undo(w).document.params.thickness, 8);
  assert.equal(cancelDimensionGesture(beginDimensionGesture(w, 'thickness')).document, w.document);
});
