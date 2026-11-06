/**
 * Independent design-intent analytic oracle, NOT a B-rep/STEP validation.
 * All dimensions are millimetres; holes are vertical circular through-holes.
 * Tangencies/overlaps are rejected rather than guessed using a fuzzy epsilon.
 */
export function analyticPlate(input) {
  if (!input || input.schema !== 'intuit3d/rectangular-plate-v1' || input.units !== 'mm') {
    throw Error('unsupported fixture schema or units');
  }
  const { width, depth, thickness, holes } = input;
  if (![width, depth, thickness].every(x => Number.isFinite(x) && x > 0)) {
    throw Error('plate dimensions must be finite and positive');
  }
  if (!Array.isArray(holes)) throw Error('holes must be an array');
  let cutArea = 0;
  let holePerimeter = 0;
  for (let index = 0; index < holes.length; index++) {
    const { x, y, radius } = holes[index] || {};
    if (![x, y, radius].every(Number.isFinite) || radius <= 0) throw Error(`hole ${index}: invalid centre or radius`);
    if (!(Math.abs(x) + radius < width / 2 && Math.abs(y) + radius < depth / 2)) {
      throw Error(`hole ${index}: outside or tangent to plate boundary`);
    }
    for (let prior = 0; prior < index; prior++) {
      const h = holes[prior];
      if (Math.hypot(x - h.x, y - h.y) <= radius + h.radius) {
        throw Error(`hole ${index}: overlapping or tangent to hole ${prior}`);
      }
    }
    cutArea += Math.PI * radius ** 2;
    holePerimeter += 2 * Math.PI * radius;
  }
  const netArea = width * depth - cutArea;
  if (netArea <= 0) throw Error('nonpositive cross-sectional material area');
  return Object.freeze({
    status: 'analytic_intent_only',
    unitVolume: 'mm3',
    unitSurfaceArea: 'mm2',
    solidCount: 1,
    volume: netArea * thickness,
    surfaceArea: 2 * netArea + (2 * (width + depth) + holePerimeter) * thickness,
  });
}
