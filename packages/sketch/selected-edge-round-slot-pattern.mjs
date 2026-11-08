/**
 * Source-authored, equal-pitch arrays of genuinely tangent round-ended slots.
 * This envelope owns dimensions and semantic instance IDs; the existing v1
 * multi-slot compiler owns nonlinear solving and global contour admission.
 * Derived arc geometry is NEVER authoritative sketch history or native B-rep.
 */
import {createSketch,serializeSketch} from './index.mjs';
import {
  createSelectedEdgeRoundSlotLayout,dragSelectedEdgeRoundSlotLayoutHandle,
  rebaseSelectedEdgeRoundSlotLayout
} from './selected-edge-round-slot-layout.mjs';

export const SELECTED_EDGE_ROUND_SLOT_PATTERN_FORMAT='intuit3d.selected-edge-round-slot-pattern';
export const SELECTED_EDGE_ROUND_SLOT_PATTERN_VERSION=1;
export const MAX_SELECTED_EDGE_ROUND_SLOT_PATTERN_COUNT=8;
const keys=['id','edgeId','count','firstCenterMm','pitchMm','widthMm','straightDepthMm'];
const numeric=['firstCenterMm','pitchMm','widthMm','straightDepthMm'];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const exact=(v,k)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const signature=a=>JSON.stringify(a);
const refused=(sourceSignature,reason,detail=null,sourceStatus=null,diagnostics=[])=>({
  kind:'refused',format:SELECTED_EDGE_ROUND_SLOT_PATTERN_FORMAT,version:1,
  sourceSignature,reason,detail,sourceStatus,diagnostics,
  previewOnly:true,nativeExact:false
});
function validPattern(p){
  return exact(p,keys)&&typeof p.id==='string'&&
    /^[A-Za-z][\w:.-]{0,39}$/.test(p.id)&&
    typeof p.edgeId==='string'&&p.edgeId.length>0&&
    Number.isInteger(p.count)&&p.count>=2&&
    p.count<=MAX_SELECTED_EDGE_ROUND_SLOT_PATTERN_COUNT&&
    numeric.every(k=>finite(p[k]))&&
    p.widthMm>1e-6&&p.pitchMm-p.widthMm>1e-7&&
    p.straightDepthMm>0&&p.firstCenterMm-p.widthMm/2>0&&
    finite(p.firstCenterMm+(p.count-1)*p.pitchMm+p.widthMm/2);
}
function validate(value){
  if(!exact(value,['format','version','source','selection','pattern'])||
     value.format!==SELECTED_EDGE_ROUND_SLOT_PATTERN_FORMAT||
     value.version!==1||!exact(value.selection,['candidateId','sourceSignature'])||
     typeof value.selection.candidateId!=='string'||
     typeof value.selection.sourceSignature!=='string'||
     !validPattern(value.pattern))
    throw new TypeError('invalid equal-pitch slot-pattern envelope');
  const source=createSketch(value.source);
  if(value.selection.sourceSignature!==serializeSketch(source))
    throw new TypeError('stale selected contour');
  return {format:SELECTED_EDGE_ROUND_SLOT_PATTERN_FORMAT,version:1,
    source,selection:{...value.selection},pattern:{...value.pattern}};
}
export function serializeSelectedEdgeRoundSlotPattern(authoring){
  return signature(validate(authoring));
}
export function parseSelectedEdgeRoundSlotPattern(text){
  return validate(JSON.parse(text));
}
const slotId=(id,i)=>id+':repeat:'+i;
function buildSlots(pattern){
  return Array.from({length:pattern.count},(_,i)=>{
    const mid=pattern.firstCenterMm+i*pattern.pitchMm;
    return {id:slotId(pattern.id,i),edgeId:pattern.edgeId,
      fromMm:mid-pattern.widthMm/2,toMm:mid+pattern.widthMm/2,
      straightDepthMm:pattern.straightDepthMm};
  });
}
function compile(authoring){
  let a;
  try{a=validate(authoring);}
  catch(error){return refused(null,'invalid_authoring',String(error?.message||error));}
  const baseSignature=serializeSketch(a.source);
  const derived=createSelectedEdgeRoundSlotLayout(a.source,a.selection,{
    kind:'create-selected-edge-round-slot-layout',version:1,
    sourceSignature:baseSignature,slots:buildSlots(a.pattern)
  });
  if(derived.kind!=='accepted')
    return refused(signature(a),derived.reason,derived.detail??null,
      derived.sourceStatus??null,derived.diagnostics??[]);
  const byId=new Map(derived.handles.map(h=>[h.id,h]));
  const mapping=[
    ['origin',slotId(a.pattern.id,0)+':handle-slide'],
    ['pitch',slotId(a.pattern.id,1)+':handle-slide'],
    ['width',slotId(a.pattern.id,0)+':handle-to'],
    ['depth',slotId(a.pattern.id,0)+':handle-cap-tip']
  ];
  const handles=mapping.map(([kind,sourceHandleId])=>{
    const h=byId.get(sourceHandleId);
    return h&&{id:a.pattern.id+':handle-'+kind,kind,
      position:{...h.position},sourceHandleId};
  });
  if(handles.some(h=>!h))
    return refused(signature(a),'missing_pattern_handle');
  return {
    kind:'selected_edge_round_slot_pattern',
    format:SELECTED_EDGE_ROUND_SLOT_PATTERN_FORMAT,version:1,
    sourceSignature:baseSignature,authoringSignature:signature(a),
    authoring:a,pattern:{...a.pattern},slots:derived.slots,
    originalProfileId:derived.originalProfileId,bindings:derived.bindings,
    handles,boundaryIds:derived.boundaryIds,holeIds:derived.holeIds,
    arcSketch:derived.arcSketch,arcSourceSignature:derived.arcSourceSignature,
    solution:derived.solution,profile:derived.profile,
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false
  };
}
export function inspectSelectedEdgeRoundSlotPattern(authoring){
  return compile(authoring);
}
function accept(view,pattern,gesture=null){
  if(!validPattern(pattern))
    return refused(view.authoringSignature,'invalid_pattern_dimensions');
  if(signature(pattern)===signature(view.pattern))
    return refused(view.authoringSignature,'no_change');
  const next=compile({...view.authoring,pattern});
  if(next.kind!=='selected_edge_round_slot_pattern')return next;
  const result={...next,kind:'accepted',sourceSignature:view.authoringSignature,
    nextSourceSignature:next.authoringSignature};
  if(gesture){
    const applied=next.handles.find(h=>h.id===gesture.handleId)?.position;
    result.gesture={handleId:gesture.handleId,requested:{...gesture.target},
      applied:{...applied},
      projectionDeviationMm:Math.hypot(applied.x-gesture.target.x,
        applied.y-gesture.target.y)};
  }
  return result;
}
function commandError(view,command,kind,fields){
  if(!exact(command,['kind','version','sourceSignature',...fields])||
     command.kind!==kind||command.version!==1)
    return refused(view.authoringSignature,'invalid_command');
  if(command.sourceSignature!==view.authoringSignature)
    return refused(view.authoringSignature,'stale_source');
  return null;
}
export function createSelectedEdgeRoundSlotPattern(source,selection,command){
  let doc;
  try{doc=createSketch(source);}
  catch(error){return refused(null,'invalid_source',String(error?.message||error));}
  const s=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','pattern'])||
     command.kind!=='create-selected-edge-round-slot-pattern'||command.version!==1)
    return refused(s,'invalid_command');
  if(command.sourceSignature!==s)return refused(s,'stale_source');
  if(!validPattern(command.pattern))return refused(s,'invalid_pattern_dimensions');
  const result=compile({format:SELECTED_EDGE_ROUND_SLOT_PATTERN_FORMAT,
    version:1,source:doc,selection,pattern:command.pattern});
  return result.kind==='selected_edge_round_slot_pattern'?
    {...result,kind:'accepted',nextSourceSignature:result.authoringSignature}:result;
}
export function editSelectedEdgeRoundSlotPattern(authoring,command){
  const view=compile(authoring);
  if(view.kind!=='selected_edge_round_slot_pattern')return view;
  const error=commandError(view,command,'edit-selected-edge-round-slot-pattern',
    ['count','firstCenterMm','pitchMm','widthMm','straightDepthMm']);
  if(error)return error;
  return accept(view,{...view.pattern,
    count:command.count,firstCenterMm:command.firstCenterMm,
    pitchMm:command.pitchMm,widthMm:command.widthMm,
    straightDepthMm:command.straightDepthMm});
}
export function relocateSelectedEdgeRoundSlotPattern(authoring,command){
  const view=compile(authoring);
  if(view.kind!=='selected_edge_round_slot_pattern')return view;
  const error=commandError(view,command,'relocate-selected-edge-round-slot-pattern',
    ['edgeId','firstCenterMm','pitchMm','widthMm','straightDepthMm']);
  if(error)return error;
  return accept(view,{...view.pattern,edgeId:command.edgeId,
    firstCenterMm:command.firstCenterMm,pitchMm:command.pitchMm,
    widthMm:command.widthMm,straightDepthMm:command.straightDepthMm});
}
export function dragSelectedEdgeRoundSlotPatternHandle(authoring,gesture){
  const view=compile(authoring);
  if(view.kind!=='selected_edge_round_slot_pattern')return view;
  if(!exact(gesture,['version','sourceSignature','handleId','target'])||
     gesture.version!==1||!exact(gesture.target,['x','y'])||
     !finite(gesture.target.x)||!finite(gesture.target.y))
    return refused(view.authoringSignature,'invalid_pointer_gesture');
  if(gesture.sourceSignature!==view.authoringSignature)
    return refused(view.authoringSignature,'stale_source');
  const h=view.handles.find(x=>x.id===gesture.handleId);
  if(!h)return refused(view.authoringSignature,'unknown_handle',gesture.handleId);
  const source=view.authoring;
  const base=createSelectedEdgeRoundSlotLayout(source.source,source.selection,{
    kind:'create-selected-edge-round-slot-layout',version:1,
    sourceSignature:serializeSketch(source.source),slots:buildSlots(view.pattern)
  });
  if(base.kind!=='accepted')
    return refused(view.authoringSignature,base.reason,base.detail??null,
      base.sourceStatus??null,base.diagnostics??[]);
  const moved=dragSelectedEdgeRoundSlotLayoutHandle(base.authoring,{
    version:1,sourceSignature:base.authoringSignature,
    handleId:h.sourceHandleId,target:gesture.target
  });
  if(moved.kind!=='accepted')
    return refused(view.authoringSignature,moved.reason,moved.detail??null,
      moved.sourceStatus??null,moved.diagnostics??[]);
  const old=view.pattern,changed=moved.slots[h.kind==='pitch'?1:0];
  const next={...old};
  if(h.kind==='origin')
    next.firstCenterMm=(changed.fromMm+changed.toMm)/2;
  if(h.kind==='pitch')
    next.pitchMm=(changed.fromMm+changed.toMm)/2-old.firstCenterMm;
  if(h.kind==='width')
    next.widthMm=2*(changed.toMm-old.firstCenterMm);
  if(h.kind==='depth')
    next.straightDepthMm=changed.straightDepthMm;
  return accept(view,next,{handleId:h.id,target:gesture.target});
}
export function rebaseSelectedEdgeRoundSlotPattern(authoring,source,selection,command){
  const view=compile(authoring);
  if(view.kind!=='selected_edge_round_slot_pattern')return view;
  const error=commandError(view,command,'rebase-selected-edge-round-slot-pattern',[]);
  if(error)return error;
  let doc;
  try{doc=createSketch(source);}
  catch(err){return refused(view.authoringSignature,'invalid_replacement_source',
    String(err?.message||err));}
  const existing=createSelectedEdgeRoundSlotLayout(view.authoring.source,
    view.authoring.selection,{
      kind:'create-selected-edge-round-slot-layout',version:1,
      sourceSignature:serializeSketch(view.authoring.source),
      slots:buildSlots(view.pattern)});
  if(existing.kind!=='accepted')
    return refused(view.authoringSignature,existing.reason,existing.detail??null,
      existing.sourceStatus??null,existing.diagnostics??[]);
  const rebased=rebaseSelectedEdgeRoundSlotLayout(
    existing.authoring,doc,selection,{
      kind:'rebase-selected-edge-round-slot-layout',version:1,
      sourceSignature:existing.authoringSignature});
  if(rebased.kind!=='accepted')
    return refused(view.authoringSignature,rebased.reason,rebased.detail??null,
      rebased.sourceStatus??null,rebased.diagnostics??[]);
  const next=compile({...view.authoring,source:doc,selection});
  if(next.kind!=='selected_edge_round_slot_pattern')return next;
  if(next.originalProfileId!==view.originalProfileId||
     JSON.stringify(next.bindings.map(b=>[b.edgeId,b.startPointId,b.endPointId]))!==
     JSON.stringify(view.bindings.map(b=>[b.edgeId,b.startPointId,b.endPointId])))
    return refused(view.authoringSignature,'source_semantic_reference_changed');
  return {...next,kind:'accepted',sourceSignature:view.authoringSignature,
    nextSourceSignature:next.authoringSignature};
}
