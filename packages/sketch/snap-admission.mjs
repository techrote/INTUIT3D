/**
 * Versioned bridge from provisional snapping inference to authored *linear*
 * constraints. A candidate is never admitted merely because it looks close:
 * independently re-infer the selected snap and re-solve the augmented sketch.
 * Neither this module nor a snap result is an exact geometric topology oracle.
 */
import {validateSketch, serializeSketch, solveSketch} from './index.mjs';
import {suggestSketchSnaps} from './snap.mjs';

export const SNAP_ADMISSION_VERSION = 1;
const fail = reason => { throw new TypeError('sketch snap admission: ' + reason); };
// Dense v1 Gauss–Jordan elimination is cubic; never allocate an unbounded
// speculative solve before enforcing a conservative admission-only limit.
const MAX_SCALAR_VARIABLES=256;
const MAX_SCALAR_EQUATIONS=512;
const empty = (base, status, reason, diagnostics = []) => ({
  ...base, status, reason, suggestedConstraint:null, resultStatus:null,
  degreesOfFreedomAfter:null, previewGeometry:null, movedPoints:[], diagnostics
});

/**
 * Evaluate an explicit, user-owned constraint request without modifying source.
 * The complete inference snapshot and its search options are rechecked rather
 * than trusting cached candidate coordinates or caller-supplied kind/target.
 * @param {import('./index.d.mts').SketchDocument} source
 * @param {import('./snap-admission.d.mts').SnapAdmissionCommand} command
 * @returns {import('./snap-admission.d.mts').SnapAdmissionProposal}
 */
export function proposeSnapConstraint(source, command) {
  const doc = validateSketch(source);
  if (!command || typeof command !== 'object' || Array.isArray(command) ||
      !['pointId','constraintId','snap'].every(k => Object.hasOwn(command,k)) ||
      Object.keys(command).some(k => !['pointId','constraintId','snap','options'].includes(k)))
    fail('expected pointId, constraintId and snap; optional options');
  if (typeof command.pointId !== 'string' || !doc.points.some(p=>p.id===command.pointId))
    fail('unknown source point');
  if (typeof command.constraintId !== 'string' ||
      !/^[A-Za-z][\w:.-]{0,127}$/.test(command.constraintId) ||
      [...doc.points,...doc.lines,...doc.circles,...doc.constraints].some(e=>e.id===command.constraintId))
    fail('invalid or duplicate authored constraint ID');
  // Clone at entry so later browser mutations cannot change proposal custody.
  const request = structuredClone(command);
  const signature = serializeSketch(doc);
  const budgetBase = {
    version:SNAP_ADMISSION_VERSION, previewOnly:true, inputSignature:signature,
    command:request, sourceStatus:null, degreesOfFreedomBefore:null,
    provisionalSource:false
  };
  const variables=doc.points.length*2+doc.circles.length;
  const equations=doc.constraints.reduce((n,c)=>n+(['fixed','coincident'].includes(c.kind)?2:1),0);
  if(variables>MAX_SCALAR_VARIABLES || equations+2>MAX_SCALAR_EQUATIONS)
    return empty(budgetBase,'budget_exceeded','dense_linear_system_limit');
  const initial = solveSketch(doc);
  const base = {...budgetBase,sourceStatus:initial.status,
    degreesOfFreedomBefore:initial.degreesOfFreedom,
    provisionalSource:initial.status==='underconstrained'};
  const snap = request.snap;
  if (!snap || typeof snap!=='object' || Array.isArray(snap) ||
      snap.version!==1 || snap.previewOnly!==true ||
      typeof snap.inputSignature!=='string' || !snap.cursor)
    return empty(base,'invalid_selection','malformed_snap');
  if (snap.inputSignature!==signature)
    return empty(base,'stale','source_revision_changed');
  // All snap options must be supplied exactly as used for the original infer.
  // Comparing the entire canonical response also guards ranking and status.
  const independentlyInferred = suggestSketchSnaps(doc,snap.cursor,request.options??{});
  if (JSON.stringify(independentlyInferred)!==JSON.stringify(snap))
    return empty(base,'invalid_selection','inference_mismatch');
  if (initial.status!=='solved' && initial.status!=='underconstrained')
    return empty(base,'source_unsolved',initial.status,initial.diagnostics);
  if (snap.status!=='ready' || !snap.selected)
    return empty(base,'snap_unavailable',snap.status);
  const target = snap.selected;
  /** @type {import('./snap-admission.d.mts').AdmissibleSnapConstraint|null} */
  let constraint = null;
  if (target.kind==='point' || target.kind==='circle_center') {
    let targetId = target.entityId;
    if (target.kind==='circle_center')
      targetId = doc.circles.find(c=>c.id===target.entityId)?.center;
    if (targetId===command.pointId)
      return empty(base,'unsupported_kind','self_reference');
    if (!doc.points.some(p=>p.id===targetId))
      return empty(base,'invalid_selection','missing_semantic_target');
    constraint = {id:command.constraintId,kind:'coincident',a:command.pointId,b:targetId};
  } else if (target.kind==='grid') {
    constraint = {id:command.constraintId,kind:'fixed',point:command.pointId,x:target.x,y:target.y};
  } else {
    // A line midpoint, quadrant, segment or curved perimeter needs a new
    // general geometry relation. Never silently fix the point in place.
    return empty(base,'unsupported_kind',target.kind);
  }
  const trial = validateSketch({...doc,constraints:[...doc.constraints,constraint]});
  const solution = solveSketch(trial);
  if (!solution.geometry || !['solved','underconstrained'].includes(solution.status))
    return {...empty(base,solution.status==='conflicted'?'conflicted':'numerical_failure',solution.status,solution.diagnostics),
      suggestedConstraint:constraint,resultStatus:solution.status,
      degreesOfFreedomAfter:solution.degreesOfFreedom};
  const previous = new Map(initial.geometry.points.map(p=>[p.id,p]));
  const movedPoints = solution.geometry.points.flatMap(p=>{
    const before=previous.get(p.id);
    return p.x!==before.x || p.y!==before.y
      ? [{id:p.id,from:{x:before.x,y:before.y},to:{x:p.x,y:p.y}}] : [];
  });
  return {...base,status:'admissible',reason:null,suggestedConstraint:constraint,
    resultStatus:solution.status,degreesOfFreedomAfter:solution.degreesOfFreedom,
    previewGeometry:solution.geometry,movedPoints,diagnostics:solution.diagnostics};
}

/**
 * Commit only a freshly reproducible, solver-admitted preview. A stale or
 * edited preview, rejected contact or forged proposed equation cannot mutate
 * authored geometry. Persistence/undo is delegated to INTENT.
 * @param {import('./index.d.mts').SketchDocument} source
 * @param {import('./snap-admission.d.mts').SnapAdmissionProposal} proposal
 */
export function commitSnapConstraint(source, proposal) {
  const doc = validateSketch(source);
  if (!proposal || typeof proposal!=='object' || Array.isArray(proposal) ||
      !proposal.command) fail('missing proposal');
  const fresh = proposeSnapConstraint(doc,proposal.command);
  if (fresh.status!=='admissible' || JSON.stringify(fresh)!==JSON.stringify(proposal))
    fail('stale, rejected or modified proposal');
  return validateSketch({...doc,constraints:[...doc.constraints,fresh.suggestedConstraint]});
}
