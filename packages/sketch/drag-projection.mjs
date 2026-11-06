import { validateSketch, solveSketch, serializeSketch } from './index.mjs';

/**
 * Additive v1 preview-only drag projection for axis-separated linear
 * constraints. Never edits constraints or claims kernel-grade exact geometry.
 */
export const DRAG_PROJECTION_VERSION = 1;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const valid = s => Boolean(s.geometry) && (s.status === 'solved' || s.status === 'underconstrained');

function reserve(doc) {
  const ids = new Set([...doc.points, ...doc.lines, ...doc.circles, ...doc.constraints].map(x => x.id));
  for (let i=0; i <= ids.size; i++) {
    const root='dragPreview:origin:'+i;
    const names=[root,root+':lock',root+':x',root+':y'];
    if (names.every(x=>!ids.has(x))) return names;
  }
  throw new TypeError('sketch drag projection: no temporary ID available');
}

function attempt(doc, pointId, target, axes, ids) {
  const [origin,lock,xId,yId]=ids;
  const tmp=structuredClone(doc);
  tmp.points.push({id:origin,x:0,y:0});
  tmp.constraints.push({id:lock,kind:'fixed',point:origin,x:0,y:0});
  for(const axis of axes) tmp.constraints.push({
    id:axis==='x'?xId:yId,kind:axis==='x'?'distanceX':'distanceY',
    a:origin,b:pointId,value:target[axis]
  });
  return solveSketch(tmp);
}
const strip = (r,origin)=>({
  points:r.geometry.points.filter(p=>p.id!==origin),
  lines:structuredClone(r.geometry.lines),circles:structuredClone(r.geometry.circles)
});

/**
 * Project a cursor request onto admissible X/Y coordinates in the limited
 * linear contract v1. Every change is tested as a temporary dimension.
 * Contradictory/numerically uncertain requests never bypass the solver.
 * @param {import('./index.d.mts').SketchDocument} source
 * @param {string} pointId
 * @param {{x:number,y:number}} target
 */
export function suggestProjectedDrag(source,pointId,target) {
  const doc=validateSketch(source);
  if(typeof pointId!=='string'||!doc.points.some(p=>p.id===pointId))
    throw new TypeError('sketch drag projection: unknown point');
  if(!target||!finite(target.x)||!finite(target.y))
    throw new TypeError('sketch drag projection: finite x/y target required');
  const baseSolve=solveSketch(doc);
  const base={
    version:DRAG_PROJECTION_VERSION,previewOnly:true,
    sourceSignature:serializeSketch(doc),
    sourceSolverStatus:baseSolve.status,
    target:{pointId,x:target.x,y:target.y}
  };
  if(!valid(baseSolve)) return {...base,status:baseSolve.status,geometry:null,
    resolvedTarget:null,acceptedAxes:[],blockedAxes:['x','y'],
    diagnostics:[{axis:'sketch',reason:'invalid_source_solution',details:baseSolve.diagnostics}]};

  const ids=reserve(doc);
  const both=attempt(doc,pointId,target,['x','y'],ids);
  let final=null, accepted=[];
  const diagnostics=[];
  const numerical=(axis,reason,details)=>({...base,status:'numerical_failure',
    geometry:null,resolvedTarget:null,acceptedAxes:[],blockedAxes:['x','y'],
    diagnostics:[{axis,reason,details}]});
  if(valid(both)){final=both;accepted=['x','y'];}
  else if(both.status==='numerical_failure') return numerical('both','numerical_failure',both.diagnostics);
  else {
    const xs=attempt(doc,pointId,target,['x'],ids);
    const ys=attempt(doc,pointId,target,['y'],ids);
    for(const [axis,result] of [['x',xs],['y',ys]]) {
      if(result.status==='numerical_failure')
        return numerical(axis,'numerical_failure',result.diagnostics);
      if(valid(result)){accepted.push(axis);final=result;}
      else diagnostics.push({axis,reason:'constraint_blocked',details:result.diagnostics});
    }
    if(accepted.length===2) {
      // Do not assume axis separability if the provider later changes.
      const joint=attempt(doc,pointId,target,accepted,ids);
      if(!valid(joint))return numerical('both','joint_admission_failed',joint.diagnostics);
      final=joint;
    }
  }
  const geometry=final?strip(final,ids[0]):structuredClone(baseSolve.geometry);
  const p=geometry.points.find(p=>p.id===pointId);
  const blocked=['x','y'].filter(a=>!accepted.includes(a));
  return {...base,status:blocked.length?(accepted.length?'projected':'blocked'):'ready',
    geometry,resolvedTarget:{x:p.x,y:p.y},acceptedAxes:accepted,
    blockedAxes:blocked,diagnostics};
}
