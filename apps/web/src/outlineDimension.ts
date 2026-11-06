/**
 * UI-only sketch-dimension manipulation. Coordinates are in the fixed SVG
 * sketch plane, not screen pixels or an authoritative solver reference.
 * The authored dimension and scale are frozen at pointer-down so a rerender
 * does not compound drift or accidentally choose the opposite handle.
 */
import type { DimensionKey } from './model';

export type OutlineKey = Extract<DimensionKey, 'width' | 'depth' | 'holeDiameter'>;
export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export interface OutlineDimensionDrag {
  readonly key: OutlineKey;
  readonly startCoordinate: number;
  readonly startValueMm: number;
  readonly pixelsPerMm: number;
}

export function outlineAxis(key: OutlineKey): 'x' | 'y' {
  if (key === 'depth') return 'y';
  if (key === 'width' || key === 'holeDiameter') return 'x';
  throw new Error('Unknown outline dimension');
}

function checkedStep(step: number): void {
  if (step !== 1 && step !== 0.1) throw new Error('Unsupported sketch increment (expected 1 or 0.1 mm)');
}

function quantize(value: number, step: number): number {
  checkedStep(step);
  // Fail explicitly rather than silently clipping an inadmissible dimension.
  if (!Number.isFinite(value) || Math.abs(value) > 1e10) {
    throw new Error('Sketch dimension proposal is outside the finite interaction range');
  }
  const result = step === 1 ? Math.round(value) : Math.round(value * 10) / 10;
  if (!Number.isFinite(result)) throw new Error('Sketch dimension proposal overflow');
  return Object.is(result, -0) ? 0 : result;
}

/**
 * Width/depth change symmetrically around the origin. Hole diameter changes
 * symmetrically about its own centre. A right/bottom perimeter movement of
 * 1 mm therefore changes the full nominal dimension by 2 mm.
 *
 * Invalid geometry (negative, overlapping, too wide) is returned unchanged
 * for the preview document to diagnose; no solver or automatic healing runs.
 */
export function proposeOutlineDimension(gesture: OutlineDimensionDrag, coordinate: number, step = 1): number {
  if (outlineAxis(gesture.key) === 'y' && gesture.key !== 'depth') throw new Error('Invalid sketch axis');
  if (![gesture.startCoordinate, gesture.startValueMm, gesture.pixelsPerMm, coordinate].every(Number.isFinite) ||
      gesture.pixelsPerMm <= 0) throw new Error('Invalid frozen sketch transform');
  return quantize(gesture.startValueMm + (2 * (coordinate - gesture.startCoordinate)) / gesture.pixelsPerMm, step);
}

/** Orthogonal arrow keys are deliberately ignored, not mapped to unrelated edits. */
export function nudgeOutlineDimension(value: number, key: OutlineKey, arrow: Arrow, step = 1): number | null {
  const axis = outlineAxis(key);
  if ((axis === 'x' && arrow !== 'ArrowLeft' && arrow !== 'ArrowRight') ||
      (axis === 'y' && arrow !== 'ArrowUp' && arrow !== 'ArrowDown')) return null;
  if (!Number.isFinite(value)) throw new Error('Invalid existing dimension');
  return quantize(value + (arrow === 'ArrowLeft' || arrow === 'ArrowUp' ? -step : step), step);
}
