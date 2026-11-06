/**
 * v1 exact predicates for the FINITE binary64 coordinates supplied to the
 * linear sketch provider. This checks polygon simplicity, not OCCT topology,
 * curve tolerances, source coordinate intent beyond binary64, or hole contact.
 *
 * Deliberately use the exact dyadic values represented by each JS Number:
 * naive floating-point cross-products can underflow to zero and overlook
 * genuine segment crossings in a mixed-scale sketch.
 */
export const BOUNDARY_GUARD_VERSION = 1;
const MAX_VERTICES = 256;
const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);
const fractionMask = (1n << 52n) - 1n;

function dyadic(value) {
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const biased = Number((bits >> 52n) & 2047n);
  let mantissa = bits & fractionMask;
  if (biased) mantissa |= 1n << 52n;
  if (bits >> 63n) mantissa = -mantissa;
  return { mantissa, exponent: mantissa === 0n ? 0 : biased ? biased - 1075 : -1074 };
}
function rejected(reason) {
  return { version: BOUNDARY_GUARD_VERSION, status: 'rejected', reason };
}
const sub = (a, b) => ({x: a.x - b.x, y: a.y - b.y});
const cross = (u, v) => u.x * v.y - u.y * v.x;
const dot = (u, v) => u.x * v.x + u.y * v.y;
const orient = (a, b, c) => cross(sub(b, a), sub(c, a));
const sign = n => n < 0n ? -1 : n > 0n ? 1 : 0;
const between = (a, b, c) => (a <= c && c <= b) || (b <= c && c <= a);
const onSegment = (a, b, p) =>
  between(a.x, b.x, p.x) && between(a.y, b.y, p.y);

function intersects(a, b, c, d) {
  const p = sign(orient(a, b, c)), q = sign(orient(a, b, d));
  const r = sign(orient(c, d, a)), s = sign(orient(c, d, b));
  if (p * q < 0 && r * s < 0) return true;
  return (p === 0 && onSegment(a, b, c)) ||
    (q === 0 && onSegment(a, b, d)) ||
    (r === 0 && onSegment(c, d, a)) ||
    (s === 0 && onSegment(c, d, b));
}

/**
 * Fail-closed, deterministic classification of one polygon cycle.
 * 'verified' means a simple nonzero-area polygon of the *encoded* finite
 * double-precision coordinates, NOT a validated manufacturable B-rep.
 * No floating epsilon, implicit snapping, ID mutation, or repair.
 */
export function assessPolygonBoundary(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return rejected('invalid_vertices');
  if (vertices.length > MAX_VERTICES) return rejected('budget_exceeded');
  if (vertices.some(p => !p || typeof p !== 'object' ||
      !Number.isFinite(p.x) || !Number.isFinite(p.y))) return rejected('invalid_vertices');

  const raw = vertices.map(p => ({x: dyadic(p.x), y: dyadic(p.y)}));
  let minExponent = 0;
  for (const p of raw) minExponent = Math.min(minExponent, p.x.exponent, p.y.exponent);
  const scaled = raw.map(p => ({
    x: p.x.mantissa << BigInt(p.x.exponent - minExponent),
    y: p.y.mantissa << BigInt(p.y.exponent - minExponent)
  }));
  const n = scaled.length;
  for (let i = 0; i < n; i++) {
    const a = scaled[i], b = scaled[(i + 1) % n], c = scaled[(i + 2) % n];
    if (a.x === b.x && a.y === b.y) return rejected('zero_length_edge');
    // Adjacent edges share an endpoint. Collinear reversal is NOT an
    // admissible simple boundary, even if all semantic point IDs are unique.
    const incoming = sub(b, a), outgoing = sub(c, b);
    if (cross(incoming, outgoing) === 0n && dot(incoming, outgoing) < 0n)
      return rejected('adjacent_backtrack');
  }
  for (let i = 0; i < n; i++) {
    const a = scaled[i], b = scaled[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (intersects(a, b, scaled[j], scaled[(j + 1) % n]))
        return rejected('nonadjacent_intersection');
    }
  }
  let area2 = 0n;
  for (let i = 0; i < n; i++) {
    const a = scaled[i], b = scaled[(i + 1) % n];
    area2 += cross(a, b);
  }
  if (area2 === 0n) return rejected('zero_area');
  return { version: BOUNDARY_GUARD_VERSION, status: 'verified', reason: null };
}

export function requireSimplePolygonBoundary(vertices) {
  const report = assessPolygonBoundary(vertices);
  if (report.status !== 'verified')
    throw new TypeError('sketch boundary guard: ' + report.reason);
  return report;
}
