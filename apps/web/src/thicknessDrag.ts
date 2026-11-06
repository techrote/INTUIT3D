/**
 * Screen-space direct manipulation for the WORKBENCH's *polygonal preview*
 * extrusion thickness. Neither this projection nor its snapped values are
 * OCCT, a sketch constraint, or an authoritative geometric measurement.
 *
 * The camera-derived screen axis is frozen at pointer-down: orbit, resizing,
 * invalid proposals and rerenders cannot silently change gesture sensitivity.
 */
export interface ScreenPoint { readonly x: number; readonly y: number }
export interface ThicknessDrag {
  readonly startClient: ScreenPoint;
  readonly initialMm: number;
  readonly axisPixelsPerMm: ScreenPoint;
}

function finitePoint(point: ScreenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Refuse a nearly end-on (unusable) axis rather than inventing a drag scale. */
export function projectThicknessAxis(base: ScreenPoint, raised: ScreenPoint, spanMm: number): ScreenPoint {
  if (!finitePoint(base) || !finitePoint(raised) || !Number.isFinite(spanMm) || spanMm <= 0) {
    throw new Error('Invalid projected thickness axis');
  }
  const x = (raised.x - base.x) / spanMm;
  const y = (raised.y - base.y) / spanMm;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 0.02) {
    throw new Error('Thickness axis is nearly edge-on or unprojectable');
  }
  return { x, y };
}

/**
 * Orthogonal projection of pointer displacement onto the screen-space world-Y
 * axis, then deterministic length snapping. A negative/unsolved thickness
 * remains an editable proposal; it is never clamped to a fabricated solid.
 */
export function proposeThicknessDrag(drag: ThicknessDrag, current: ScreenPoint, snapMm = 1): number {
  const a = drag.axisPixelsPerMm;
  if (!finitePoint(drag.startClient) || !finitePoint(current) || !finitePoint(a) ||
      !Number.isFinite(drag.initialMm) || !Number.isFinite(snapMm) || snapMm <= 0) {
    throw new Error('Invalid thickness gesture input');
  }
  const denominator = a.x * a.x + a.y * a.y;
  if (!Number.isFinite(denominator) || denominator < 0.02 ** 2) {
    throw new Error('Thickness axis has insufficient screen projection');
  }
  const dx = current.x - drag.startClient.x;
  const dy = current.y - drag.startClient.y;
  const unrounded = drag.initialMm + (dx * a.x + dy * a.y) / denominator;
  const snapped = Math.round(unrounded / snapMm) * snapMm;
  if (!Number.isFinite(snapped) || Math.abs(snapped) > 1e9) {
    throw new Error('Thickness gesture overflow');
  }
  return Number(snapped.toPrecision(12));
}

export function nudgeThickness(currentMm: number, direction: 'up' | 'down', snapMm = 1): number {
  if (!Number.isFinite(currentMm) || !Number.isFinite(snapMm) || snapMm <= 0 ||
      (direction !== 'up' && direction !== 'down')) {
    throw new Error('Invalid thickness keyboard proposal');
  }
  const proposed = currentMm + (direction === 'up' ? snapMm : -snapMm);
  if (!Number.isFinite(proposed) || Math.abs(proposed) > 1e9) throw new Error('Thickness keyboard overflow');
  return Number(proposed.toPrecision(12));
}
