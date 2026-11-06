/**
 * Deterministic sketch-screen interaction helpers. They convert pointer movement
 * into a proposed preview dimension, NOT a solved geometric constraint.
 */
export type HoleSide = 'left' | 'right';

export interface HolePitchDrag {
  readonly side: HoleSide;
  readonly startSvgX: number;
  readonly startPitchMm: number;
  readonly pixelsPerMm: number;
}

/**
 * The initial hole side is fixed throughout a gesture. Testing the cursor's
 * current screen half would flip direction abruptly when crossing the origin.
 * Negative/overlapping proposals are deliberately not clamped: they remain
 * editable, with a diagnostic and stale visual state supplied by the adapter.
 */
export function proposeHolePitch(drag: HolePitchDrag, currentSvgX: number, snapMm = 1): number {
  if (!Number.isFinite(drag.startSvgX) || !Number.isFinite(drag.startPitchMm) ||
      !Number.isFinite(drag.pixelsPerMm) || drag.pixelsPerMm <= 0 ||
      !Number.isFinite(currentSvgX) || !Number.isFinite(snapMm) || snapMm <= 0) {
    throw new Error('Invalid sketch pointer transform or snap increment');
  }
  const direction = drag.side === 'right' ? 1 : -1;
  const unsnapped = drag.startPitchMm + 2 * direction * (currentSvgX - drag.startSvgX) / drag.pixelsPerMm;
  if (!Number.isFinite(unsnapped)) throw new Error('Sketch pointer overflow');
  const snapped = Math.round(unsnapped / snapMm) * snapMm;
  // Avoid floating-point presentation artifacts, while allowing 0.1 mm snap.
  return Number(snapped.toPrecision(12));
}

/** Keyboard proposal mirrors the selected hole's outward/inward directions. */
export function nudgeHolePitch(pitchMm: number, side: HoleSide, direction: 'left' | 'right', incrementMm = 1): number {
  if (!Number.isFinite(pitchMm) || !Number.isFinite(incrementMm) || incrementMm <= 0) {
    throw new Error('Invalid sketch keyboard increment');
  }
  const sign = (side === 'right' ? 1 : -1) * (direction === 'right' ? 1 : -1);
  return Number((pitchMm + sign * incrementMm).toPrecision(12));
}
