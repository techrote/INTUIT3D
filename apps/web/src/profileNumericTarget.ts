import type { PointerEditableHandle } from '@intuit3d/sketch/pointer-profile-edit/v1';

/**
 * Convert an explicitly selected, solver-authored semantic handle's numeric
 * input into the same sketch-local pointer target used by the admitted SKETCH
 * and RUNTIME drag path. No geometry, constraints, or second document are
 * manufactured in the browser.
 */
export function numericProfileHandleTarget(
  handle: PointerEditableHandle,
  input: { value?: string; x?: string; y?: string },
): { x: number; y: number } {
  const parse = (source: string | undefined, label: string): number => {
    if (!source?.trim()) throw Error(label + ' is required.');
    const value = Number(source);
    if (!Number.isFinite(value) || Math.abs(value) > 10000)
      throw Error(label + ' must be a finite millimetre value within ±10,000.');
    return value;
  };
  if (!Number.isFinite(handle.position.x) || !Number.isFinite(handle.position.y))
    throw Error('Selected semantic handle has an invalid solved position.');

  if (handle.kind === 'hole_center') {
    const x = parse(input.x, 'Hole centre X');
    const y = parse(input.y, 'Hole centre Y');
    if (x === handle.position.x && y === handle.position.y)
      throw Error('The hole centre is unchanged.');
    return { x, y };
  }
  if (handle.kind !== 'dimension' ||
      !['distanceX', 'distanceY', 'radius'].includes(String(handle.dimensionKind)) ||
      typeof handle.valueMm !== 'number' || !Number.isFinite(handle.valueMm))
    throw Error('Selected semantic handle has no editable scalar dimension.');

  const value = parse(input.value, 'Dimension');
  if (handle.dimensionKind === 'radius' && value <= 0)
    throw Error('Circle radius must be positive.');
  if (value === handle.valueMm)
    throw Error('The selected dimension is unchanged.');

  // The public SKETCH pointer adapter evaluates a signed distance by the
  // driven point's axis coordinate, or radius by circle-centre-relative X.
  // Preserve the off-axis coordinate; the solver still independently admits
  // the resulting constraints and physical profile.
  return handle.dimensionKind === 'distanceY'
    ? { x: handle.position.x, y: handle.position.y + value - handle.valueMm }
    : { x: handle.position.x + value - handle.valueMm, y: handle.position.y };
}
