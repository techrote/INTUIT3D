/**
 * INTUIT3D sketch v1: a deterministic, dependency-free **linear** constraint
 * provider, not a general nonlinear solver or an exact geometry kernel.
 * Constraint dimensions and all coordinates are millimetres.
 */
export const SKETCH_VERSION = 1;
const DEFAULT_PIVOT_TOLERANCE = 1e-12;
const DEFAULT_RESIDUAL_TOLERANCE_MM = 1e-9;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const fail = (message) => { throw new TypeError(`sketch: ${message}`); };

/** @param {unknown} source */
export function validateSketch(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('expected object');
  const doc = /** @type {any} */ (source);
  if (doc.version !== SKETCH_VERSION || doc.units !== 'mm') fail('unsupported version or units');
  if (!Array.isArray(doc.points) || !Array.isArray(doc.lines) || !Array.isArray(doc.circles) || !Array.isArray(doc.constraints)) fail('missing entity arrays');
  // A closed schema prevents derived state, kernel IDs and arbitrary payloads
  // from being persisted as authoritative sketch intent.
  const exactKeys = (value, allowed, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some((key) => !allowed.includes(key)) ||
        allowed.some((key) => !Object.hasOwn(value, key))) fail(`invalid ${label} fields`);
  };
  exactKeys(doc, ['version', 'units', 'points', 'lines', 'circles', 'constraints'], 'document');
  const all = new Set();
  const add = (id) => {
    if (typeof id !== 'string' || !/^[A-Za-z][\w:.-]{0,127}$/.test(id) || all.has(id)) fail(`invalid or duplicate ID ${String(id)}`);
    all.add(id);
  };
  for (const p of doc.points) {
    exactKeys(p, ['id', 'x', 'y'], 'point');
    add(p?.id);
    if (!finite(p.x) || !finite(p.y)) fail(`nonfinite point ${p.id}`);
  }
  const points = new Set(doc.points.map((p) => p.id));
  for (const line of doc.lines) {
    exactKeys(line, ['id', 'start', 'end'], 'line');
    add(line?.id);
    if (!points.has(line.start) || !points.has(line.end) || line.start === line.end) fail(`bad line endpoints ${line.id}`);
  }
  const lines = new Set(doc.lines.map((l) => l.id));
  for (const circle of doc.circles) {
    exactKeys(circle, ['id', 'center', 'radius'], 'circle');
    add(circle?.id);
    if (!points.has(circle.center) || !finite(circle.radius) || circle.radius <= 0) fail(`bad circle ${circle.id}`);
  }
  const circles = new Set(doc.circles.map((c) => c.id));
  const pointPair = (c) => points.has(c.a) && points.has(c.b) && c.a !== c.b;
  for (const c of doc.constraints) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) fail('invalid constraint');
    const fields = {
      fixed: ['id', 'kind', 'point', 'x', 'y'],
      horizontal: ['id', 'kind', 'line'], vertical: ['id', 'kind', 'line'],
      coincident: ['id', 'kind', 'a', 'b'],
      distanceX: ['id', 'kind', 'a', 'b', 'value'],
      distanceY: ['id', 'kind', 'a', 'b', 'value'],
      radius: ['id', 'kind', 'circle', 'value'],
      equalRadius: ['id', 'kind', 'a', 'b']
    }[c.kind];
    if (fields) exactKeys(c, fields, 'constraint');
    add(c?.id);
    switch (c.kind) {
      case 'fixed':
        if (!points.has(c.point) || !finite(c.x) || !finite(c.y)) fail(`bad fixed constraint ${c.id}`);
        break;
      case 'horizontal':
      case 'vertical':
        if (!lines.has(c.line)) fail(`bad line constraint ${c.id}`);
        break;
      case 'coincident':
        if (!pointPair(c)) fail(`bad coincident constraint ${c.id}`);
        break;
      case 'distanceX':
      case 'distanceY':
        if (!pointPair(c) || !finite(c.value)) fail(`bad signed distance ${c.id}`);
        break;
      case 'radius':
        if (!circles.has(c.circle) || !finite(c.value) || c.value <= 0) fail(`bad radius constraint ${c.id}`);
        break;
      case 'equalRadius':
        if (!circles.has(c.a) || !circles.has(c.b) || c.a === c.b) fail(`bad equal radius ${c.id}`);
        break;
      default: fail(`unsupported constraint kind ${String(c.kind)}`);
    }
  }
  return /** @type {import('./index.d.mts').SketchDocument} */ (structuredClone(doc));
}

/** @param {unknown} source */
export function createSketch(source) { return validateSketch(source); }
/** @param {import('./index.d.mts').SketchDocument} sketch */
export function serializeSketch(sketch) { return JSON.stringify(validateSketch(sketch)); }
/** @param {string} json */
export function parseSketch(json) { return validateSketch(JSON.parse(json)); }

/** Preserve constraint identity, authored order and input immutability. */
export function editConstraint(sketch, id, patch) {
  const doc = validateSketch(sketch);
  const index = doc.constraints.findIndex((c) => c.id === id);
  if (index === -1) fail(`missing constraint ${id}`);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('expected patch object');
  const allowed = doc.constraints[index].kind === 'fixed' ? ['x', 'y'] : ['value'];
  if (!Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.includes(key))) fail('patch keys do not match dimension type');
  doc.constraints[index] = { ...doc.constraints[index], ...patch };
  return validateSketch(doc);
}

/** @param {import('./index.d.mts').SketchDocument} source
 *  @param {{pivotTolerance?: number, residualToleranceMm?: number}} [options] */
export function solveSketch(source, options = {}) {
  const sketch = validateSketch(source);
  const pivotTolerance = options.pivotTolerance ?? DEFAULT_PIVOT_TOLERANCE;
  const residualTolerance = options.residualToleranceMm ?? DEFAULT_RESIDUAL_TOLERANCE_MM;
  if (!finite(pivotTolerance) || pivotTolerance <= 0 || pivotTolerance > DEFAULT_PIVOT_TOLERANCE ||
      !finite(residualTolerance) || residualTolerance <= 0 || residualTolerance > DEFAULT_RESIDUAL_TOLERANCE_MM) fail('invalid numerical policy');
  const vars = [];
  const seed = [];
  const ids = new Map();
  const addVar = (name, value) => { ids.set(name, vars.length); vars.push(name); seed.push(value); };
  for (const p of sketch.points) { addVar(`${p.id}.x`, p.x); addVar(`${p.id}.y`, p.y); }
  for (const c of sketch.circles) addVar(`${c.id}.radius`, c.radius);
  /** @type {{ coefficients: number[], rhs: number, owner: string }[]} */
  const equations = [];
  const equation = (owner, terms, rhs) => {
    const row = Array(vars.length).fill(0);
    for (const [name, coeff] of terms) row[ids.get(name)] += coeff;
    equations.push({ coefficients: row, rhs, owner });
  };
  const coord = (id, axis) => `${id}.${axis}`;
  const lineMap = new Map(sketch.lines.map((line) => [line.id, line]));
  for (const c of sketch.constraints) {
    switch (c.kind) {
      case 'fixed':
        equation(c.id, [[coord(c.point, 'x'), 1]], c.x);
        equation(c.id, [[coord(c.point, 'y'), 1]], c.y);
        break;
      case 'horizontal':
      case 'vertical': {
        const line = lineMap.get(c.line);
        const axis = c.kind === 'horizontal' ? 'y' : 'x';
        equation(c.id, [[coord(line.end, axis), 1], [coord(line.start, axis), -1]], 0);
        break;
      }
      case 'coincident':
        for (const axis of ['x', 'y']) equation(c.id, [[coord(c.a, axis), 1], [coord(c.b, axis), -1]], 0);
        break;
      case 'distanceX':
      case 'distanceY': {
        const axis = c.kind === 'distanceX' ? 'x' : 'y';
        equation(c.id, [[coord(c.b, axis), 1], [coord(c.a, axis), -1]], c.value);
        break;
      }
      case 'radius': equation(c.id, [[`${c.circle}.radius`, 1]], c.value); break;
      case 'equalRadius': equation(c.id, [[`${c.a}.radius`, 1], [`${c.b}.radius`, -1]], 0); break;
    }
  }
  const n = vars.length;
  const rows = equations.map((e) => [...e.coefficients, e.rhs]);
  const origins = equations.map((e) => new Set([e.owner]));
  const pivots = [];
  let rank = 0;
  for (let col = 0; col < n && rank < rows.length; col++) {
    let index = rank;
    for (let row = rank + 1; row < rows.length; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[index][col])) index = row;
    if (Math.abs(rows[index][col]) <= pivotTolerance) continue;
    [rows[index], rows[rank]] = [rows[rank], rows[index]];
    [origins[index], origins[rank]] = [origins[rank], origins[index]];
    const scale = rows[rank][col];
    for (let j = col; j <= n; j++) rows[rank][j] /= scale;
    for (let row = 0; row < rows.length; row++) {
      if (row === rank) continue;
      const factor = rows[row][col];
      if (Math.abs(factor) <= pivotTolerance) continue;
      for (let j = col; j <= n; j++) rows[row][j] -= factor * rows[rank][j];
      for (const owner of origins[rank]) origins[row].add(owner);
    }
    pivots.push(col);
    rank++;
  }
  const resultWithPolicy = {
    inputSignature: serializeSketch(sketch), rank, degreesOfFreedom: n - rank,
    scalarEquations: equations.length, redundantEquations: null,
    numericalPolicy: { pivotTolerance, residualToleranceMm: residualTolerance }
  };
  // Finite authored inputs may still overflow during elimination.
  if (rows.some((row) => row.some((value) => !Number.isFinite(value)))) return {
    ...resultWithPolicy, status: 'numerical_failure', geometry: null,
    diagnostics: [{ code: 'arithmetic_overflow', candidates: [...new Set(equations.map((e) => e.owner))], magnitudeMm: null }]
  };
  const inconsistent = [];
  for (let row = rank; row < rows.length; row++) if (Math.abs(rows[row][n]) > residualTolerance) {
    inconsistent.push({ code: 'contradictory_constraints', candidates: [...origins[row]].sort(), magnitudeMm: Math.abs(rows[row][n]) });
  }
  const resultBase = { inputSignature: serializeSketch(sketch), rank, degreesOfFreedom: n - rank, scalarEquations: equations.length,
    redundantEquations: inconsistent.length ? null : equations.length - rank,
    numericalPolicy: { pivotTolerance, residualToleranceMm: residualTolerance } };
  if (inconsistent.length) return { ...resultBase, status: 'conflicted', geometry: null, diagnostics: inconsistent };
  const solved = [...seed];
  for (let row = rank - 1; row >= 0; row--) {
    let rhs = rows[row][n];
    for (let col = pivots[row] + 1; col < n; col++) rhs -= rows[row][col] * solved[col];
    solved[pivots[row]] = rhs;
  }
  if (solved.some((v) => !Number.isFinite(v))) return { ...resultBase, status: 'numerical_failure', geometry: null,
    diagnostics: [{ code: 'arithmetic_overflow', candidates: [...new Set(equations.map((e) => e.owner))], magnitudeMm: null }] };
  const bad = equations.filter((e) => {
    const error = e.coefficients.reduce((sum, coeff, i) => sum + coeff * solved[i], -e.rhs);
    return !Number.isFinite(error) || Math.abs(error) > residualTolerance;
  });
  if (bad.length) return { ...resultBase, status: 'numerical_failure', geometry: null,
    diagnostics: [{ code: 'residual_tolerance_exceeded', candidates: bad.map((e) => e.owner), magnitudeMm: null }] };
  const radiusFailures = sketch.circles.filter((c) => solved[ids.get(`${c.id}.radius`)] <= 0);
  if (radiusFailures.length) return { ...resultBase, status: 'conflicted', geometry: null,
    diagnostics: radiusFailures.map((c) => ({ code: 'nonpositive_solved_radius', candidates: [c.id], magnitudeMm: null })) };
  const geometry = {
    points: sketch.points.map((p) => ({ id: p.id, x: solved[ids.get(`${p.id}.x`)], y: solved[ids.get(`${p.id}.y`)] })),
    lines: structuredClone(sketch.lines),
    circles: sketch.circles.map((c) => ({ id: c.id, center: c.center, radius: solved[ids.get(`${c.id}.radius`)] }))
  };
  const diagnostics = [];
  if (equations.length > rank) diagnostics.push({ code: 'redundant_constraints', count: equations.length - rank });
  if (n > rank) diagnostics.push({ code: 'free_degrees_of_freedom', count: n - rank });
  return { ...resultBase, status: n === rank ? 'solved' : 'underconstrained', geometry, diagnostics };
}

/**
 * Preview-only drag suggestion. A temporary fixed-point constraint is solved
 * against the existing authored constraints, but is never persisted.
 * The returned geometry is not a verified exact profile; sourceSignature
 * lets consumers discard the suggestion following any intervening edit.
 *
 * A constrained move that would violate dimensions returns 'conflicted'
 * with no geometry instead of changing or deleting authored constraints.
 * @param {import('./index.d.mts').SketchDocument} source
 * @param {string} pointId
 * @param {{x:number,y:number}} target
 */
export function suggestDrag(source, pointId, target) {
  const sketch = validateSketch(source);
  if (typeof pointId !== 'string' || !sketch.points.some((p) => p.id === pointId))
    fail('unknown drag point ' + String(pointId));
  if (!target || !finite(target.x) || !finite(target.y))
    fail('drag target must have finite x/y coordinates');
  const occupied = new Set([
    ...sketch.points.map((entity) => entity.id),
    ...sketch.lines.map((entity) => entity.id),
    ...sketch.circles.map((entity) => entity.id),
    ...sketch.constraints.map((entity) => entity.id)
  ]);
  let index = 0;
  let temporaryId = 'drag:' + pointId + ':' + index;
  while (occupied.has(temporaryId)) temporaryId = 'drag:' + pointId + ':' + ++index;
  const proposal = structuredClone(sketch);
  proposal.constraints.push({ id: temporaryId, kind: 'fixed', point: pointId, x: target.x, y: target.y });
  const solution = solveSketch(proposal);
  return {
    sourceSignature: serializeSketch(sketch),
    status: solution.status,
    geometry: solution.geometry,
    degreesOfFreedom: solution.degreesOfFreedom,
    diagnostics: solution.diagnostics,
    target: { pointId, x: target.x, y: target.y },
    previewOnly: true
  };
}

/**
 * Validated polygon + circular holes for profile-adapter consumption.
 * Refuses invalid/ambiguous loops. Not a B-rep or a boolean operation.
 */
export function buildPlateProfile(sketchSource, solution, edgeIds, holeIds = []) {
  const sketch = validateSketch(sketchSource);
  if (solution?.inputSignature !== serializeSketch(sketch)) fail('stale or mismatched solution');
  if (solution?.status !== 'solved' || !solution.geometry) fail('only fully constrained, consistent sketches may produce a profile');
  // External callers can mutate returned objects; a matching inputSignature alone
  // must not authenticate a fabricated result as admissible profile geometry.
  const independentRebuild = solveSketch(sketch);
  if (independentRebuild.status !== 'solved' ||
      JSON.stringify(independentRebuild.geometry) !== JSON.stringify(solution.geometry))
    fail('modified or unverifiable solver geometry');
  if (!Array.isArray(edgeIds) || edgeIds.length < 3 || !Array.isArray(holeIds)) fail('invalid loop input');
  if (new Set(edgeIds).size !== edgeIds.length || new Set(holeIds).size !== holeIds.length) fail('duplicate profile entities');
  const edges = new Map(sketch.lines.map((line) => [line.id, line]));
  const pts = new Map(solution.geometry.points.map((p) => [p.id, p]));
  const vertices = [];
  let previous = null;
  for (const id of edgeIds) {
    const line = edges.get(id);
    if (!line) fail(`unknown profile edge ${id}`);
    if (previous !== null && line.start !== previous) fail('ordered edges must have matching endpoints');
    vertices.push(pts.get(line.start));
    previous = line.end;
  }
  if (previous !== vertices[0].id || new Set(vertices.map((p) => p.id)).size !== vertices.length) fail('open, repeated or ambiguous polygon loop');
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (a, b, c) => Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
  const intersects = (a,b,c,d) => {
    const p = cross(a,b,c), q = cross(a,b,d), r = cross(c,d,a), s = cross(c,d,b);
    if ((p > 0 && q < 0 || p < 0 && q > 0) && (r > 0 && s < 0 || r < 0 && s > 0)) return true;
    return p === 0 && onSegment(a,b,c) || q === 0 && onSegment(a,b,d) || r === 0 && onSegment(c,d,a) || s === 0 && onSegment(c,d,b);
  };
  const count = vertices.length;
  for (let i = 0; i < count; i++) {
    const a = vertices[i], b = vertices[(i+1)%count];
    if (Math.hypot(b.x-a.x,b.y-a.y) <= 0) fail('zero-length polygon edge');
    for (let j = i + 1; j < count; j++) {
      if (j === i+1 || i === 0 && j === count-1) continue;
      if (intersects(a,b,vertices[j],vertices[(j+1)%count])) fail('self-intersecting polygon');
    }
  }
  let signedDoubleArea = 0;
  for (let i = 0; i < count; i++) {
    const a = vertices[i], b = vertices[(i + 1) % count];
    signedDoubleArea += a.x * b.y - b.x * a.y;
  }
  if (!Number.isFinite(signedDoubleArea) || signedDoubleArea === 0) fail('nonfinite or zero-area profile');
  const circleMap = new Map(solution.geometry.circles.map((c) => [c.id, c]));
  const holes = holeIds.map((id) => {
    const circle = circleMap.get(id);
    if (!circle) fail(`unknown circular hole ${id}`);
    return { id, center: pts.get(circle.center), radius: circle.radius };
  });
  for (const hole of holes) {
    // Strict ray casting: boundary-touching is rejected by distance check.
    let inside = false;
    const p = hole.center;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      const a = vertices[i], b = vertices[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside = !inside;
    }
    if (!inside) fail(`hole ${hole.id} is outside profile`);
    for (let i = 0; i < count; i++) {
      const a = vertices[i], b = vertices[(i+1)%count];
      const dx = b.x-a.x, dy = b.y-a.y;
      const t = Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
      if (Math.hypot(a.x+t*dx-p.x,a.y+t*dy-p.y) <= hole.radius) fail(`hole ${hole.id} touches or crosses outer boundary`);
    }
  }
  for (let i = 0; i < holes.length; i++) for (let j = i+1; j < holes.length; j++) {
    if (Math.hypot(holes[i].center.x-holes[j].center.x,holes[i].center.y-holes[j].center.y) <= holes[i].radius+holes[j].radius) fail('circular holes touch or overlap');
  }
  const areaMm2 = Math.abs(signedDoubleArea) / 2 - Math.PI * holes.reduce((sum,h) => sum + h.radius*h.radius, 0);
  if (!Number.isFinite(areaMm2) || areaMm2 <= 0) fail('nonpositive or nonfinite analytic area');
  return { status: 'analytic_profile_only', units: 'mm', outer: vertices.map(({id,x,y}) => ({id,x,y})),
    holes: holes.map((h) => ({ id: h.id, centerId: h.center.id, x: h.center.x, y: h.center.y, radius: h.radius })),
    areaMm2 };
}

/** Two-hole plate fixture with persistent, readable semantic entity IDs. */
export function plateSketchFixture() {
  const points = [
    {id:'p0',x:0,y:0}, {id:'p1',x:120,y:0}, {id:'p2',x:120,y:80}, {id:'p3',x:0,y:80},
    {id:'holeA:center',x:35,y:40}, {id:'holeB:center',x:85,y:40}
  ];
  const lines = [
    {id:'bottom',start:'p0',end:'p1'}, {id:'right',start:'p1',end:'p2'},
    {id:'top',start:'p2',end:'p3'}, {id:'left',start:'p3',end:'p0'}
  ];
  const circles = [
    {id:'holeA',center:'holeA:center',radius:6}, {id:'holeB',center:'holeB:center',radius:6}
  ];
  const constraints = [
    {id:'anchor',kind:'fixed',point:'p0',x:0,y:0},
    ...['bottom','top'].map((line) => ({id:`horizontal:${line}`,kind:'horizontal',line})),
    ...['right','left'].map((line) => ({id:`vertical:${line}`,kind:'vertical',line})),
    {id:'width',kind:'distanceX',a:'p0',b:'p1',value:120},
    {id:'height',kind:'distanceY',a:'p1',b:'p2',value:80},
    {id:'holeA:fixed',kind:'fixed',point:'holeA:center',x:35,y:40},
    {id:'holeB:fixed',kind:'fixed',point:'holeB:center',x:85,y:40},
    {id:'holeA:diameter',kind:'radius',circle:'holeA',value:6},
    {id:'holeB:diameter',kind:'radius',circle:'holeB',value:6}
  ];
  return validateSketch({version:1,units:'mm',points,lines,circles,constraints});
}
