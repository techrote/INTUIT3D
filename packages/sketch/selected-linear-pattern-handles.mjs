/**
 * Consumer-facing, solved 2D direct manipulators for an authored linear-hole
 * array. Every gesture is one revision-fenced SKETCH transaction. Neither a
 * pointer drag nor this preview supplies native B-rep/STEP authority.
 */
import {createSketch,serializeSketch} from './index.mjs';
import {inspectSelectedLinearHolePattern,editSelectedLinearHolePattern}
  from './selected-linear-hole-pattern.mjs';
import {inspectSelectedProfileHandles,moveSelectedProfileHoleCenter}
  from './selected-profile-handles.mjs';

export const SELECTED_LINEAR_PATTERN_HANDLES_VERSION=1;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const refuse=(stamp,reason,detail=null)=>({
  kind:'refused',version:1,sourceSignature:stamp,reason,detail,
  sourceStatus:null,diagnostics:[],previewOnly:true,nativeExact:false
});

/**
 * Display-ready solved handles for the pattern's starting position, signed
 * XY pitch vector and common radius. Stable semantic IDs survive replay.
 */
export function inspectSelectedLinearPatternHandles(source,selection,patternId) {
  const pattern=inspectSelectedLinearHolePattern(source,selection,patternId);
  if(pattern.kind!=='selected_linear_hole_pattern')return pattern;
  const inspected=inspectSelectedProfileHandles(source,selection);
  if(inspected.kind!=='selected_profile_handles')return inspected;
  const first=pattern.members[0],second=pattern.members[1];
  const origin=inspected.holeCenters.find(h=>h.holeId===first.holeId);
  if(!origin)return refuse(pattern.sourceSignature,'pattern_origin_handle_unavailable');
  const handles=[
    {
      id:'pattern:'+patternId+':origin',kind:'origin',holeId:first.holeId,
      anchor:{...origin.xAnchor},position:{...first.position},
      constraintIds:[first.xConstraintId,first.yConstraintId]
    },
    {
      id:'pattern:'+patternId+':pitch',kind:'pitch',holeId:second.holeId,
      anchor:{...first.position},position:{...second.position},
      constraintIds:pattern.members.slice(1).flatMap(m=>
        [m.xConstraintId,m.yConstraintId])
    },
    {
      id:'pattern:'+patternId+':radius',kind:'radius',holeId:first.holeId,
      anchor:{...first.position},
      position:{x:first.position.x+pattern.radiusMm,y:first.position.y},
      constraintIds:pattern.members.map(m=>m.radiusConstraintId)
    }
  ];
  return {
    kind:'selected_linear_pattern_handles',version:1,
    sourceSignature:pattern.sourceSignature,
    selection:pattern.selection,semanticProfileId:pattern.semanticProfileId,
    patternId:pattern.patternId,pattern,handles,
    previewOnly:true,nativeExact:false
  };
}

/**
 * Drag only at gesture completion, in sketch millimetres. The pattern setter
 * handles all coupled radius/pitch dimensions atomically; the origin adapter
 * retains its original authored X/Y constraint references and translates the
 * whole dependent chain. Refusals never provide a replacement sketch.
 */
export function dragSelectedLinearPatternHandle(source,selection,command) {
  const doc=createSketch(source),stamp=serializeSketch(doc);
  if(!exact(command,['kind','sourceSignature','patternId','handleId','xMm','yMm'])||
      command.kind!=='drag-pattern-handle'||
      typeof command.sourceSignature!=='string'||
      typeof command.patternId!=='string'||
      typeof command.handleId!=='string')
    return refuse(stamp,'invalid_command');
  if(command.sourceSignature!==stamp)return refuse(stamp,'stale_source');
  if(!finite(command.xMm)||!finite(command.yMm))
    return refuse(stamp,'invalid_pointer');
  const view=inspectSelectedLinearPatternHandles(doc,selection,command.patternId);
  if(view.kind!=='selected_linear_pattern_handles')return view;
  const handle=view.handles.find(h=>h.id===command.handleId);
  if(!handle)return refuse(stamp,'unknown_handle');
  const p=view.pattern;
  let result;
  if(handle.kind==='origin'){
    result=moveSelectedProfileHoleCenter(doc,selection,{
      kind:'move-hole-center',sourceSignature:stamp,
      handleId:'hole-center:'+p.members[0].holeId,
      xMm:command.xMm,yMm:command.yMm
    });
  }else{
    const pitchXmm=handle.kind==='pitch'?
      command.xMm-p.members[0].position.x:p.pitchXmm;
    const pitchYmm=handle.kind==='pitch'?
      command.yMm-p.members[0].position.y:p.pitchYmm;
    const radiusMm=handle.kind==='radius'?
      Math.hypot(command.xMm-p.members[0].position.x,
        command.yMm-p.members[0].position.y):p.radiusMm;
    if(![pitchXmm,pitchYmm,radiusMm].every(finite))
      return refuse(stamp,'unrepresentable_dimension');
    result=editSelectedLinearHolePattern(doc,selection,{
      kind:'set-pattern',sourceSignature:stamp,patternId:p.patternId,
      pitchXmm,pitchYmm,radiusMm,count:p.count
    });
  }
  if(result.kind!=='accepted')return result;
  const updated=inspectSelectedLinearPatternHandles(result.sketch,
    result.selection,p.patternId);
  if(updated.kind!=='selected_linear_pattern_handles')
    return refuse(stamp,'pattern_reinspection_failed',updated.reason);
  if(updated.semanticProfileId!==view.semanticProfileId)
    return refuse(stamp,'semantic_profile_changed');
  const applied=updated.handles.find(h=>h.id===handle.id);
  if(!applied)return refuse(stamp,'updated_handle_unavailable');
  return {
    kind:'accepted',version:1,sourceSignature:stamp,
    nextSourceSignature:result.nextSourceSignature,
    sketch:result.sketch,selection:result.selection,profile:result.profile,
    semanticProfileId:updated.semanticProfileId,
    patternId:p.patternId,pattern:updated.pattern,
    handleId:handle.id,
    changedConstraintIds:result.changedConstraintIds??result.editedConstraintIds,
    gesture:{
      target:{x:command.xMm,y:command.yMm},
      appliedPoint:{...applied.position},
      deviationMm:Math.hypot(applied.position.x-command.xMm,
        applied.position.y-command.yMm)
    },
    previewOnly:true,nativeExact:false,exactBrepAvailable:false,
    independentStepQualified:false
  };
}
