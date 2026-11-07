// @intuit3d/kernel-contract/plate-v1 — untrusted JSON admission at a provider boundary.
 // OCP 7.9.3.1 remains experimental: no external STEP or OCCT 8.0.1 qualification.
 // Numeric predicates mirror native/protocol.py; changes require differential review.
export const PLATE_PROTOCOL = 'intuit3d/kernel/plate-v1';
export const EXPERIMENTAL_BACKEND = 'OCP-python-prototype';
export const EXPERIMENTAL_OCCT_VERSION = '7.9.3.1';
const MAX_HOLES = 64;
const MAX_DIM_MM = 1_000_000;
const MIN_DIM_MM = 1e-6;
const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

export class KernelContractError extends Error {
  constructor(message) { super(message); this.name = 'KernelContractError'; }
}
function reject(message) { throw new KernelContractError(message); }
function object(value, keys, context) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key))) reject(`${context}: expected exactly ${keys.join(', ')}`);
  return value;
}
function finite(value, label, minimum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) reject(`${label}: finite number required`);
  if (minimum !== undefined && !(minimum <= value && value <= MAX_DIM_MM))
    reject(`${label}: outside supported range [${minimum}, ${MAX_DIM_MM}]`);
  return value;
}
function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) reject(`${label}: invalid semantic identifier`);
  return value;
}
function safeRevision(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) reject(`${label}: nonnegative safe integer required`);
  return value;
}

// Parse untrusted JSON input into a new, independent, versioned request.
export function parsePlateRequest(value) {
  const doc = object(value, ['protocol', 'requestId', 'featureId', 'revision', 'units', 'plate', 'exportStep'], 'request');
  if (doc.protocol !== PLATE_PROTOCOL || doc.units !== 'mm') reject('unsupported protocol or units');
  const requestId = id(doc.requestId, 'requestId');
  const featureId = id(doc.featureId, 'featureId');
  const revision = safeRevision(doc.revision, 'revision');
  if (typeof doc.exportStep !== 'boolean') reject('exportStep must be boolean');
  const plate = object(doc.plate, ['width', 'depth', 'thickness', 'holes'], 'plate');
  const width = finite(plate.width, 'width', MIN_DIM_MM);
  const depth = finite(plate.depth, 'depth', MIN_DIM_MM);
  const thickness = finite(plate.thickness, 'thickness', MIN_DIM_MM);
  if (!Array.isArray(plate.holes) || plate.holes.length > MAX_HOLES) reject('holes: invalid list length');
  const holes = [];
  for (const [index, raw] of plate.holes.entries()) {
    const hole = object(raw, ['x', 'y', 'radius'], `hole ${index}`);
    const x = finite(hole.x, `hole ${index}.x`);
    const y = finite(hole.y, `hole ${index}.y`);
    const radius = finite(hole.radius, `hole ${index}.radius`, MIN_DIM_MM);
    if (!(Math.abs(x) + radius < width / 2 && Math.abs(y) + radius < depth / 2))
      reject(`hole ${index}: outside or tangent to plate boundary`);
    for (const [j, previous] of holes.entries()) {
      if (Math.hypot(x - previous.x, y - previous.y) <= radius + previous.radius)
        reject(`hole ${index}: overlaps or touches hole ${j}`);
    }
    holes.push({ x, y, radius });
  }
  return { protocol: PLATE_PROTOCOL, requestId, featureId, revision, units: 'mm',
    plate: { width, depth, thickness, holes }, exportStep: doc.exportStep };
}

// Independent elementary plate target; these numbers are not B-rep evidence.
export function expectedPlateMetrics(plate) {
  const cuts = plate.holes.reduce((sum, hole) => sum + Math.PI * hole.radius ** 2, 0);
  const walls = plate.holes.reduce((sum, hole) => sum + 2 * Math.PI * hole.radius, 0);
  return { volumeMm3: (plate.width * plate.depth - cuts) * plate.thickness,
    surfaceAreaMm2: 2 * (plate.width * plate.depth - cuts) +
      (2 * (plate.width + plate.depth) + walls) * plate.thickness };
}
function close(actual, expected) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1e-7, Math.abs(expected) * 1e-10);
}
function verifyMetrics(raw, expected, holes, label) {
  const value = object(raw, ['valid', 'solidCount', 'volumeMm3', 'surfaceAreaMm2', 'cylindricalHoles'], label);
  if (value.valid !== true || value.solidCount !== 1) reject(`${label}: invalid body topology`);
  if (!close(value.volumeMm3, expected.volumeMm3) || !close(value.surfaceAreaMm2, expected.surfaceAreaMm2))
    reject(`${label}: numerical invariants disagree with authored plate`);
  const reported = value.cylindricalHoles;
  if (!Array.isArray(reported) || reported.length !== holes.length)
    reject(`${label}: incorrect hole count`);
  const sorted = [...holes].sort((a,b) => a.x - b.x || a.y - b.y || a.radius - b.radius);
  for (const [index, hole] of sorted.entries()) {
    const cylinder = object(reported[index], ['x', 'y', 'radius', 'axisZ'], `${label}.cylinder${index}`);
    for (const key of ['x', 'y', 'radius']) {
      const value = cylinder[key];
      if (typeof value !== 'number' || !Number.isFinite(value) ||
          Math.abs(value - hole[key]) > Math.max(1e-11, Math.abs(hole[key]) * 1e-9))
        reject(`${label}: wrong hole ${index} ${key}`);
    }
    const z = cylinder.axisZ;
    if (typeof z !== 'number' || !Number.isFinite(z) || Math.abs(Math.abs(z) - 1) > 1e-10)
      reject(`${label}: hole ${index} axis not vertical`);
  }
}

// Assess JSON only for the current semantic revision. Never claims exact CAD authority.
function assessPinnedBackend(requestInput, response, { currentRevision } = {}, expectedBackend, expectedVersion) {
  const request = parsePlateRequest(requestInput);
  safeRevision(currentRevision, 'currentRevision');
  if (currentRevision !== request.revision) return {
    kind: 'unresolved', code: 'stale_revision', requestId: request.requestId,
    featureId: request.featureId, revision: request.revision,
  };
  if (response === null || typeof response !== 'object' || Array.isArray(response))
    reject('response must be an object');
  if (response.protocol !== PLATE_PROTOCOL || response.requestId !== request.requestId)
    reject('response protocol or request identity mismatch');
  if (response.status !== 'validated_exact') {
    object(response, Object.hasOwn(response, 'diagnostic')
      ? ['protocol', 'requestId', 'status', 'message', 'diagnostic']
      : ['protocol', 'requestId', 'status', 'message'], 'failure response');
    if (!['invalid_request', 'timeout', 'worker_crash', 'requires_reconciliation'].includes(response.status) ||
        typeof response.message !== 'string' || !response.message ||
        ('diagnostic' in response && typeof response.diagnostic !== 'string'))
      reject('unsupported or malformed failure response');
    return {kind: 'unresolved', code: response.status, requestId: request.requestId,
      featureId: request.featureId, revision: request.revision};
  }
  const keys = ['protocol', 'requestId', 'featureId', 'revision', 'backend', 'occtVersion', 'status',
    'units', 'source', 'stepReadback', 'stepWritten'];
  if (Object.hasOwn(response, 'stepPath')) keys.push('stepPath');
  object(response, keys, 'success response');
  if (response.featureId !== request.featureId || response.revision !== request.revision || response.units !== 'mm')
    reject('response feature/revision/units mismatch');
  if (response.backend !== expectedBackend || response.occtVersion !== expectedVersion)
    reject('unsupported experimental backend/version');
  if (response.stepWritten !== request.exportStep) reject('STEP report contradicts export request');
  if ('stepPath' in response && (!request.exportStep || typeof response.stepPath !== 'string' || !response.stepPath))
    reject('unexpected or malformed STEP path');
  const target = expectedPlateMetrics(request.plate);
  verifyMetrics(response.source, target, request.plate.holes, 'source');
  if (request.exportStep) verifyMetrics(response.stepReadback, target, request.plate.holes, 'stepReadback');
  else if (response.stepReadback !== null) reject('unexpected STEP readback');
  return {kind: 'experimental_report', requestId: request.requestId, featureId: request.featureId,
    revision: request.revision, backend: expectedBackend,
    occtVersion: expectedVersion,
    expectedMetrics: target,
    step: request.exportStep ? 'same_engine_readback_reported' : 'not_requested',
    exactAuthority: false, independentInteroperability: false};
}


// Both public assessment paths are fixed backend/version allowlists. Never take
// a backend name from untrusted project JSON or an options override.
export function assessPlateResponse(requestInput, response, options = {}) {
  return assessPinnedBackend(requestInput, response, options,
    EXPERIMENTAL_BACKEND, EXPERIMENTAL_OCCT_VERSION);
}
export function assessOcct8PlateResponse(requestInput, response, options = {}) {
  return assessPinnedBackend(requestInput, response, options,
    'OCCT-cxx-8.0.1', '8.0.1');
}
