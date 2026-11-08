/**
 * Multi-slot authoring on genuinely selected contour edges. Each selected
 * edge slot is independently constrained using the existing tangent-arc
 * compiler; the resulting arc wires are composed and solved as ONE profile.
 * Original linear sketch constraints remain authoritative and immutable.
 */
import {createSketch,serializeSketch,solveSketch} from './index.mjs';
import {inspectSelectedEdgeHolePlacement} from './selected-edge-hole-placement.mjs';
import {createSelectedEdgeRoundSlot,dragSelectedEdgeRoundSlotHandle,
  rebaseSelectedEdgeRoundSlot} from './selected-edge-round-slot.mjs';
import {createArcSketch,serializeArcSketch,solveArcSketch} from './arc-constraints.mjs';
import {prepareArcProfileForProvider} from './arc-profile.mjs';

export const SELECTED_EDGE_ROUND_SLOT_LAYOUT_FORMAT='intuit3d.selected-edge-round-slot-layout';
export const SELECTED_EDGE_ROUND_SLOT_LAYOUT_VERSION=1;
export const MAX_SELECTED_EDGE_ROUND_SLOTS=8;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const specKeys=['id','edgeId','fromMm','toMm','straightDepthMm'];
const refusal=(stamp,reason,slotId=null,detail=null,status=null,diagnostics=[])=>({
  kind:'refused',format:SELECTED_EDGE_ROUND_SLOT_LAYOUT_FORMAT,version:1,
  sourceSignature:stamp,reason,slotId,detail,sourceStatus:status,
  diagnostics,previewOnly:true,nativeExact:false
});
const stamp=authoring=>JSON.stringify(authoring);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const slotAuthoring=(authoring,slot)=>({
  format:'intuit3d.selected-edge-round-slot',version:1,
  source:authoring.source,selection:authoring.selection,slot
});
function validate(value){
  if(!exact(value,['format','version','source','selection','slots'])||
     value.format!==SELECTED_EDGE_ROUND_SLOT_LAYOUT_FORMAT||value.version!==1||
     !exact(value.selection,['candidateId','sourceSignature'])||
     !Array.isArray(value.slots)||value.slots.length<1||
     value.slots.length>MAX_SELECTED_EDGE_ROUND_SLOTS||
     value.slots.some(s=>!exact(s,specKeys)))
    throw new TypeError('invalid selected round-slot layout envelope');
  const source=createSketch(value.source);
  if(value.selection.sourceSignature!==serializeSketch(source))
    throw new TypeError('stale selected contour token');
  const ids=new Set();
  for(const s of value.slots){
    if(typeof s.id!=='string'||ids.has(s.id))
      throw new TypeError('duplicate or invalid slot id');
    ids.add(s.id);
  }
  return {format:SELECTED_EDGE_ROUND_SLOT_LAYOUT_FORMAT,version:1,
    source,selection:{...value.selection},slots:value.slots.map(s=>({...s}))};
}
export function serializeSelectedEdgeRoundSlotLayout(authoring){
  return stamp(validate(authoring));
}
export function parseSelectedEdgeRoundSlotLayout(serialized){
  return validate(JSON.parse(serialized));
}
const sourceIdSet=(list)=>new Set(list.map(x=>x.id));
function compile(authoring){
  let a;
  try{a=validate(authoring);}
  catch(error){return refusal(null,'invalid_authoring',null,String(error?.message||error));}
  const baseStamp=serializeSketch(a.source);
  const original=inspectSelectedEdgeHolePlacement(a.source,a.selection);
  if(original.kind!=='selected_edge_hole_placement')
    return refusal(baseStamp,'selected_contour_not_ready',null,
      original.reason??null,original.sourceStatus??null,original.diagnostics??[]);
  const singles=[];
  for(const slot of a.slots){
    const r=createSelectedEdgeRoundSlot(a.source,a.selection,{
      kind:'create-selected-edge-round-slot',version:1,
      sourceSignature:baseStamp,...slot});
    if(r.kind!=='accepted')
      return refusal(baseStamp,r.reason,slot.id,r.detail??null,
        r.sourceStatus??null,r.diagnostics??[]);
    if(r.originalProfileId!==original.semanticProfileId||
       !same(r.holeIds,original.profile.holeIds))
      return refusal(baseStamp,'selected_profile_membership_changed',slot.id);
    singles.push(r);
  }
  // A slot on the same boundary edge must have disjoint, non-touching
  // mouth intervals. On adjacent edges all cap/wall collisions are handled
  // by the global analytic arc profile validator, not by an AABB heuristic.
  const byEdge=new Map();
  for(const result of singles){
    const edge=result.slot.edgeId;
    if(!byEdge.has(edge))byEdge.set(edge,[]);
    byEdge.get(edge).push(result);
  }
  for(const group of byEdge.values()){
    group.sort((x,y)=>x.slot.fromMm-y.slot.fromMm||
      x.slot.id.localeCompare(y.slot.id));
    for(let i=1;i<group.length;i++){
      if(group[i].slot.fromMm-group[i-1].slot.toMm<=1e-7)
        return refusal(baseStamp,'overlapping_slot_mouths',group[i].slot.id,
          group[i-1].slot.id);
    }
  }
  const arc=structuredClone(singles[0].arcSketch);
  const pIds=sourceIdSet(a.source.points),lIds=sourceIdSet(a.source.lines);
  const cIds=sourceIdSet(a.source.constraints);
  const circleIds=sourceIdSet(a.source.circles);
  // Copy only generated entities from further independently solved slots;
  // original constraints/points/circles come solely from the accepted source.
  for(const result of singles.slice(1)){
    arc.points.push(...result.arcSketch.points.filter(p=>!pIds.has(p.id)));
    arc.lines.push(...result.arcSketch.lines.filter(l=>!lIds.has(l.id)));
    arc.arcs.push(...result.arcSketch.arcs);
    arc.circles.push(...result.arcSketch.circles.filter(c=>!circleIds.has(c.id)));
    arc.constraints.push(...result.arcSketch.constraints.filter(c=>!cIds.has(c.id)));
  }
  const linesById=new Map(arc.lines.map(l=>[l.id,l]));
  for(const [edgeId,group] of byEdge){
    const boundary=original.profile.boundary.find(b=>b.edgeId===edgeId);
    const line=linesById.get(edgeId);
    if(!boundary||!line||line.start!==boundary.startPointId)
      return refusal(baseStamp,'selected_edge_semantics_changed',group[0].slot.id);
    line.end=group[0].slot.id+':p1';
    for(let i=0;i<group.length;i++){
      const tail=linesById.get(group[i].slot.id+':tail');
      if(!tail)return refusal(baseStamp,'missing_generated_tail',group[i].slot.id);
      tail.end=i+1<group.length?group[i+1].slot.id+':p1':
        boundary.endPointId;
    }
  }
  const boundaryIds=original.profile.boundary.flatMap(boundary=>{
    const group=byEdge.get(boundary.edgeId);
    return group?[boundary.edgeId,...group.flatMap(result=>{
      const id=result.slot.id;
      return [id+':wall-in',id+':cap',id+':wall-out',id+':tail'];
    })]:[boundary.edgeId];
  });
  // Fail closed on generated cross-slot ID collisions, rank deficiency,
  // nonlinear inconsistencies, hole contact and global arc intersections.
  let arcSketch,solution,profile;
  try{
    arcSketch=createArcSketch(arc);
    solution=solveArcSketch(arcSketch);
  }catch(error){
    return refusal(baseStamp,'composite_arc_sketch_invalid',null,
      String(error?.message||error));
  }
  if(solution.status!=='solved'||solution.degreesOfFreedom!==0||
     !solution.geometry)
    return refusal(baseStamp,'composite_not_fully_constrained',null,null,
      solution.status,solution.diagnostics);
  try{
    profile=prepareArcProfileForProvider(arcSketch,solution,{
      profileId:'round-slot-layout:selected-profile',
      boundaryIds,holeIds:original.profile.holeIds
    });
  }catch(error){
    return refusal(baseStamp,'composite_profile_rejected',null,
      String(error?.message||error),solution.status,solution.diagnostics);
  }
  if(profile.boundary.length!==original.profile.boundary.length+4*singles.length||
     profile.holes.length!==original.profile.holeIds.length)
    return refusal(baseStamp,'composite_contour_membership_changed');
  const before=solveSketch(a.source);
  const prior=new Map(before.geometry?.points.map(p=>[p.id,p])??[]);
  const after=new Map(solution.geometry.points.map(p=>[p.id,p]));
  for(const id of pIds){
    const p=prior.get(id),q=after.get(id);
    if(!p||!q||!finite(q.x)||!finite(q.y)||
       Math.abs(p.x-q.x)>1e-7||Math.abs(p.y-q.y)>1e-7)
      return refusal(baseStamp,'original_geometry_would_change',null,id);
  }
  const handles=singles.flatMap(s=>s.handles.map(h=>({...h,slotId:s.slot.id})));
  const bindings=singles.map(s=>({
    slotId:s.slot.id,edgeId:s.originalEdgeId,
    startPointId:s.originalStartPointId,endPointId:s.originalEndPointId,
    profileId:s.originalProfileId,lengthMm:s.originalLengthMm
  }));
  return {kind:'selected_edge_round_slot_layout',
    format:SELECTED_EDGE_ROUND_SLOT_LAYOUT_FORMAT,version:1,
    sourceSignature:baseStamp,authoring:a,authoringSignature:stamp(a),
    slots:a.slots.map(s=>({...s})),bindings,handles,boundaryIds,
    holeIds:[...original.profile.holeIds],
    arcSketch,arcSourceSignature:serializeArcSketch(arcSketch),solution,profile,
    originalProfileId:original.semanticProfileId,
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false};
}
export function inspectSelectedEdgeRoundSlotLayout(authoring){
  return compile(authoring);
}
function accepted(view,current,slots,gesture=null){
  const next={...view.authoring,slots};
  const result=compile(next);
  if(result.kind!=='selected_edge_round_slot_layout')return result;
  const output={...result,kind:'accepted',sourceSignature:current,
    nextSourceSignature:result.authoringSignature};
  if(gesture){
    const applied=result.handles.find(h=>h.id===gesture.handleId)?.position;
    output.gesture={handleId:gesture.handleId,
      requested:{...gesture.requested},applied:{...applied},
      projectionDeviationMm:Math.hypot(applied.x-gesture.requested.x,
        applied.y-gesture.requested.y)};
  }
  return output;
}
function checkCommand(view,command,fields,kind){
  const current=view.authoringSignature;
  if(!exact(command,['kind','version','sourceSignature',...fields])||
     command.kind!==kind||command.version!==1)
    return refusal(current,'invalid_command');
  if(command.sourceSignature!==current)return refusal(current,'stale_source');
  return null;
}
export function createSelectedEdgeRoundSlotLayout(source,selection,command){
  let doc;
  try{doc=createSketch(source);}
  catch(error){return refusal(null,'invalid_source',null,String(error?.message||error));}
  const sourceSignature=serializeSketch(doc);
  if(!exact(command,['kind','version','sourceSignature','slots'])||
     command.kind!=='create-selected-edge-round-slot-layout'||command.version!==1||
     !Array.isArray(command.slots))
    return refusal(sourceSignature,'invalid_command');
  if(command.sourceSignature!==sourceSignature)
    return refusal(sourceSignature,'stale_source');
  const a={format:SELECTED_EDGE_ROUND_SLOT_LAYOUT_FORMAT,version:1,
    source:doc,selection,slots:command.slots};
  const view=compile(a);
  return view.kind==='selected_edge_round_slot_layout'?
    {...view,kind:'accepted',nextSourceSignature:view.authoringSignature}:view;
}
export function addSelectedEdgeRoundSlotLayout(authoring,command){
  const view=compile(authoring);
  if(view.kind!=='selected_edge_round_slot_layout')return view;
  const invalid=checkCommand(view,command,['slot'],
    'add-selected-edge-round-slot-layout');
  if(invalid)return invalid;
  if(!exact(command.slot,specKeys))return refusal(view.authoringSignature,'invalid_slot_specification');
  if(view.slots.length>=MAX_SELECTED_EDGE_ROUND_SLOTS)
    return refusal(view.authoringSignature,'slot_limit_reached');
  if(view.slots.some(s=>s.id===command.slot.id))
    return refusal(view.authoringSignature,'duplicate_slot_id',command.slot.id);
  return accepted(view,view.authoringSignature,[...view.slots,{...command.slot}]);
}
export function editSelectedEdgeRoundSlotLayout(authoring,command){
  const view=compile(authoring);
  if(view.kind!=='selected_edge_round_slot_layout')return view;
  const invalid=checkCommand(view,command,
    ['slotId','fromMm','toMm','straightDepthMm'],
    'edit-selected-edge-round-slot-layout');
  if(invalid)return invalid;
  const old=view.slots.find(s=>s.id===command.slotId);
  if(!old)return refusal(view.authoringSignature,'unknown_slot',command.slotId);
  const next={...old,fromMm:command.fromMm,toMm:command.toMm,
    straightDepthMm:command.straightDepthMm};
  if(same(old,next))return refusal(view.authoringSignature,'no_change',old.id);
  return accepted(view,view.authoringSignature,
    view.slots.map(s=>s.id===old.id?next:s));
}
export function relocateSelectedEdgeRoundSlotLayout(authoring,command){
  const view=compile(authoring);
  if(view.kind!=='selected_edge_round_slot_layout')return view;
  const invalid=checkCommand(view,command,
    ['slotId','edgeId','fromMm','toMm','straightDepthMm'],
    'relocate-selected-edge-round-slot-layout');
  if(invalid)return invalid;
  const old=view.slots.find(s=>s.id===command.slotId);
  if(!old)return refusal(view.authoringSignature,'unknown_slot',command.slotId);
  if(typeof command.edgeId!=='string')
    return refusal(view.authoringSignature,'invalid_edge_reference',old.id);
  const next={...old,edgeId:command.edgeId,fromMm:command.fromMm,
    toMm:command.toMm,straightDepthMm:command.straightDepthMm};
  if(same(old,next))return refusal(view.authoringSignature,'no_change',old.id);
  return accepted(view,view.authoringSignature,
    view.slots.map(s=>s.id===old.id?next:s));
}
export function removeSelectedEdgeRoundSlotLayout(authoring,command){
  const view=compile(authoring);
  if(view.kind!=='selected_edge_round_slot_layout')return view;
  const invalid=checkCommand(view,command,['slotId'],
    'remove-selected-edge-round-slot-layout');
  if(invalid)return invalid;
  if(!view.slots.some(s=>s.id===command.slotId))
    return refusal(view.authoringSignature,'unknown_slot',command.slotId);
  if(view.slots.length===1)
    return refusal(view.authoringSignature,'last_slot_requires_feature_removal',
      command.slotId);
  return accepted(view,view.authoringSignature,
    view.slots.filter(s=>s.id!==command.slotId));
}
export function dragSelectedEdgeRoundSlotLayoutHandle(authoring,gesture){
  const view=compile(authoring);
  if(view.kind!=='selected_edge_round_slot_layout')return view;
  if(!exact(gesture,['version','sourceSignature','handleId','target'])||
     gesture.version!==1||!exact(gesture.target,['x','y'])||
     !finite(gesture.target.x)||!finite(gesture.target.y))
    return refusal(view.authoringSignature,'invalid_pointer_gesture');
  if(gesture.sourceSignature!==view.authoringSignature)
    return refusal(view.authoringSignature,'stale_source');
  const h=view.handles.find(h=>h.id===gesture.handleId);
  if(!h)return refusal(view.authoringSignature,'unknown_handle',null,gesture.handleId);
  const slot=view.slots.find(s=>s.id===h.slotId);
  const individual=dragSelectedEdgeRoundSlotHandle(slotAuthoring(view.authoring,slot),{
    version:1,sourceSignature:stamp(slotAuthoring(view.authoring,slot)),
    handleId:h.id,target:gesture.target
  });
  if(individual.kind!=='accepted')
    return refusal(view.authoringSignature,individual.reason,h.slotId,
      individual.detail??null,individual.sourceStatus??null,
      individual.diagnostics??[]);
  return accepted(view,view.authoringSignature,
    view.slots.map(s=>s.id===h.slotId?individual.slot:s),
    {handleId:h.id,requested:gesture.target});
}
export function rebaseSelectedEdgeRoundSlotLayout(authoring,source,selection,command){
  const view=compile(authoring);
  if(view.kind!=='selected_edge_round_slot_layout')return view;
  const invalid=checkCommand(view,command,[],
    'rebase-selected-edge-round-slot-layout');
  if(invalid)return invalid;
  let doc;
  try{doc=createSketch(source);}
  catch(error){return refusal(view.authoringSignature,'invalid_replacement_source',
    null,String(error?.message||error));}
  for(const old of view.slots){
    const individual=rebaseSelectedEdgeRoundSlot(
      slotAuthoring(view.authoring,old),doc,selection,{
        kind:'rebase-selected-edge-round-slot',version:1,
        sourceSignature:stamp(slotAuthoring(view.authoring,old))
      });
    if(individual.kind!=='accepted')
      return refusal(view.authoringSignature,individual.reason,old.id,
        individual.detail??null,individual.sourceStatus??null,
        individual.diagnostics??[]);
  }
  const next={...view.authoring,source:doc,selection:{...selection}};
  const result=compile(next);
  if(result.kind!=='selected_edge_round_slot_layout')return result;
  if(result.originalProfileId!==view.originalProfileId||
     !same(result.holeIds,view.holeIds)||
     !same(result.bindings.map(b=>[b.edgeId,b.startPointId,b.endPointId]),
       view.bindings.map(b=>[b.edgeId,b.startPointId,b.endPointId])))
    return refusal(view.authoringSignature,'source_semantic_reference_changed');
  return {...result,kind:'accepted',sourceSignature:view.authoringSignature,
    nextSourceSignature:result.authoringSignature};
}
