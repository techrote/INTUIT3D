/**
 * @intuit3d/sketch/dimension-fidelity/v1
 *
 * Fail-closed, exact-dyadic audit of *encoded binary64* solved coordinates
 * against authored nonzero signed X/Y dimensions. This is a diagnostic only:
 * it does not solve constraints, validate sketch sources, certify a physical
 * tolerance, or authenticate caller-supplied geometry.
 */
export const SIGNED_DIMENSION_FIDELITY_VERSION = 1;
const bits = new DataView(new ArrayBuffer(8));
const FIDELITY_BITS = 40n; // relative error <= 2^-40 for each nonzero dimension
const finite = value => typeof value === 'number' && Number.isFinite(value);
const reject = (reason, failedConstraintIds = []) => ({
  version: SIGNED_DIMENSION_FIDELITY_VERSION, status: 'rejected', reason,
  failedConstraintIds, previewOnly: true
});
function dyadic(value) {
  bits.setFloat64(0, value, false);
  const raw = bits.getBigUint64(0, false);
  const exponentBits = Number((raw >> 52n) & 2047n);
  let numerator = raw & ((1n << 52n) - 1n);
  if (exponentBits !== 0) numerator |= 1n << 52n;
  if ((raw >> 63n) !== 0n) numerator = -numerator;
  return { numerator, exponent: numerator === 0n ? 0 :
    exponentBits === 0 ? -1074 : exponentBits - 1075 };
}
function withinRelativeFidelity(start, end, intended) {
  const x = dyadic(start), y = dyadic(end), d = dyadic(intended);
  const exponent = Math.min(x.exponent, y.exponent, d.exponent);
  const integer = v => v.numerator << BigInt(v.exponent - exponent);
  const target = integer(d);
  // The old physical residual policy still applies to zero-valued
  // dimensions; this guard must not silently change that policy.
  if (target === 0n) return true;
  const observed = integer(y) - integer(x);
  const residual = observed - target;
  const absolute = n => n < 0n ? -n : n;
  return (absolute(residual) << FIDELITY_BITS) <= absolute(target);
}

/**
 * Inputs must already be a validated SketchDocument and derived SketchGeometry.
 * Refuses malformed inputs instead of silently claiming a verified diagnostic.
 * It is not an admission authority for fabricated solutions.
 */
export function assessSignedDistanceFidelity(sketch, geometry) {
  if (!sketch || !Array.isArray(sketch.constraints) ||
      !geometry || !Array.isArray(geometry.points)) return reject('invalid_input');
  const coordinates = new Map();
  for (const point of geometry.points) {
    if (!point || typeof point.id !== 'string' || !point.id ||
        !finite(point.x) || !finite(point.y) || coordinates.has(point.id))
      return reject('invalid_input');
    coordinates.set(point.id, point);
  }
  const failed = [];
  for (const constraint of sketch.constraints) {
    if (constraint?.kind !== 'distanceX' && constraint?.kind !== 'distanceY') continue;
    const a = coordinates.get(constraint.a), b = coordinates.get(constraint.b);
    if (!a || !b || !finite(constraint.value) || typeof constraint.id !== 'string')
      return reject('invalid_input');
    const axis = constraint.kind === 'distanceX' ? 'x' : 'y';
    if (!withinRelativeFidelity(a[axis], b[axis], constraint.value))
      failed.push(constraint.id);
  }
  return failed.length ? reject('dimension_precision_lost', failed) : {
    version: SIGNED_DIMENSION_FIDELITY_VERSION, status: 'verified',
    reason: null, failedConstraintIds: [], previewOnly: true
  };
}
