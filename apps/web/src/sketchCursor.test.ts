import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPreviewCursorMm, inferPreviewSketchCursor, type PreviewSketchLayout } from './sketchCursor.ts';

const layout: PreviewSketchLayout = Object.freeze({
  centreX: 500, centreY: 325, pixelsPerMm: 4,
  widthMm: 120, depthMm: 80, holePitchMm: 64,
});
const withProfile = { allowProfileSnaps: true } as const;

test('cursor maps screen Y down to sketch Y up in exact preview mm', () => {
  const cursor = inferPreviewSketchCursor(layout, 512, 317, withProfile);
  assert.equal(cursor.rawXmm, 3);
  assert.equal(cursor.rawYmm, 2);
  assert.equal(cursor.snap, null);
});

test('origin takes stable precedence over coincident visual grid', () => {
  const cursor = inferPreviewSketchCursor(layout, 500, 325, withProfile);
  assert.equal(cursor.snap?.kind, 'origin');
  assert.equal(cursor.snap?.id, 'origin');
  assert.equal(cursor.snap?.featureId, 'sketch-plate');
});

test('plate corners and edge midpoints use authored preview dimensions', () => {
  const topRight = inferPreviewSketchCursor(layout, 741, 164, withProfile);
  assert.equal(topRight.snap?.kind, 'plate-corner');
  assert.equal(topRight.snap?.xMm, 60);
  assert.equal(topRight.snap?.yMm, 40);
  const edge = inferPreviewSketchCursor(layout, 740, 325, withProfile);
  assert.equal(edge.snap?.kind, 'plate-midpoint');
  assert.equal(edge.snap?.featureId, 'sketch-plate');
});

test('hole-centre inference keeps stable semantic demo target and side', () => {
  assert.equal(inferPreviewSketchCursor(layout, 627, 325, withProfile).snap?.id, 'hole-1');
  assert.equal(inferPreviewSketchCursor(layout, 373, 325, withProfile).snap?.id, 'hole--1');
  assert.equal(inferPreviewSketchCursor(layout, 628, 325, withProfile).snap?.featureId, 'sketch-holes');
});

test('grid suggestion is explicitly visual and never claims feature identity', () => {
  const cursor = inferPreviewSketchCursor(layout, 540, 285, withProfile);
  assert.deepEqual([cursor.snap?.kind, cursor.snap?.xMm, cursor.snap?.yMm, cursor.snap?.featureId],
    ['grid', 10, 10, null]);
});

test('disabled profile snaps do not advertise invalid plate/hole geometry', () => {
  const cursor = inferPreviewSketchCursor(layout, 628, 325, { allowProfileSnaps: false });
  assert.equal(cursor.snap?.kind, 'grid');
  assert.equal(cursor.snap?.featureId, null);
  const grid = inferPreviewSketchCursor(layout, 500, 325, { allowProfileSnaps: false });
  assert.equal(grid.snap?.kind, 'grid');
  assert.equal(grid.snap?.featureId, null);
});

test('suggestions cannot attract remote points outside the pixel radius', () => {
  const cursor = inferPreviewSketchCursor(layout, 520, 325, { ...withProfile, radiusPx: 4 });
  assert.equal(cursor.snap, null);
  assert.equal(cursor.rawXmm, 5);
});

test('layout, cursor point, and options remain unchanged by read-only inference', () => {
  const original = JSON.stringify(layout);
  for (let i = 0; i < 512; i++) {
    inferPreviewSketchCursor(layout, 300 + i / 16, 250 + i / 10, withProfile);
  }
  assert.equal(JSON.stringify(layout), original);
});

test('inference is stable under 256 subpixel probes and independent of call order', () => {
  const points = Array.from({ length: 256 }, (_, i) => [500 + Math.sin(i) * 3, 325 + Math.cos(i) * 3] as const);
  const forwards = points.map(([x, y]) => inferPreviewSketchCursor(layout, x, y, withProfile));
  const backwards = [...points].reverse().map(([x, y]) => inferPreviewSketchCursor(layout, x, y, withProfile)).reverse();
  assert.deepEqual(forwards, backwards);
});

test('broken transforms, policy bounds and numerical overflows fail closed', () => {
  assert.throws(() => inferPreviewSketchCursor({ ...layout, pixelsPerMm: 0 }, 500, 325, withProfile), /transform/);
  assert.throws(() => inferPreviewSketchCursor({ ...layout, widthMm: Infinity }, 500, 325, withProfile), /transform/);
  assert.throws(() => inferPreviewSketchCursor(layout, NaN, 0, withProfile), /transform/);
  assert.throws(() => inferPreviewSketchCursor(layout, 1e8, 0, withProfile), /transform/);
  assert.throws(() => inferPreviewSketchCursor(layout, 500, 325, { ...withProfile, radiusPx: -2 }), /policy/);
  assert.throws(() => inferPreviewSketchCursor(layout, 500, 325, { ...withProfile, gridMm: 0 }), /policy/);
});

test('display formatting rounds mm without negative zero or engineering accuracy claims', () => {
  assert.equal(formatPreviewCursorMm(-0.001), '0.0');
  assert.equal(formatPreviewCursorMm(-12.26), '-12.3');
  assert.equal(formatPreviewCursorMm(1.24), '1.2');
  assert.throws(() => formatPreviewCursorMm(Infinity), /Invalid/);
});
