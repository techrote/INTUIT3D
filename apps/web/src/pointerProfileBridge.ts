/**
 * Read-only source projection and one-transaction consumption of the accepted
 * SKETCH pointer-to-semantic-profile editor. The UI never stores a second CAD
 * document, infers constraint IDs from pixels or publishes analytic STEP.
 */
import * as model from '@intuit3d/model';
import * as sketch from '@intuit3d/sketch';
import {
  selectContourAtPointer,
} from '@intuit3d/sketch/pointer-contour-selection/v1';
import {
  inspectPointerEditableHandles, dragProfileHandleAtPointer,
} from '@intuit3d/sketch/pointer-profile-edit/v1';
import type {SelectedProfileSelection} from '@intuit3d/sketch/selected-profile/v1';
import {runtime, type ModelSession} from './runtimeSession';

function sourceSketch(history:ModelSession):sketch.SketchDocument {
  const feature=model.featuresOf(history.document).find(item=>item.id==='sketch.plate'&&item.kind==='sketch');
  if(!feature)throw Error('Active authoritative sketch.plate is unavailable.');
  return sketch.validateSketch(feature.payload.sketch);
}

export function selectModelProfileAtPointer(history:ModelSession,x:number,y:number) {
  const source=sourceSketch(history),sourceSignature=sketch.serializeSketch(source);
  return selectContourAtPointer(source,{
    kind:'select-contour-at-pointer',version:1,sourceSignature,
    point:{x,y},boundaryClearanceMm:0.5,
  });
}

export function inspectModelPointerProfile(history:ModelSession,selection:SelectedProfileSelection) {
  const source=sourceSketch(history),signature=sketch.serializeSketch(source);
  if(selection.sourceSignature!==signature)
    throw Error('Selection is stale: click the solved profile again after this edit.');
  return inspectPointerEditableHandles(source,selection);
}

/** Accept ONLY solver-authored modified scalar constraints into RUNTIME.
 * An unselected contour, multi-contour source or extra hidden changes must
 * never be represented as a successful browser edit.
 */
export function dragModelPointerProfileHandle(
  history:ModelSession,selection:SelectedProfileSelection,
  handleId:string,target:{x:number;y:number},
):{history:ModelSession;selection:SelectedProfileSelection;invalidatedFeatureIds:readonly string[]} {
  const source=sourceSketch(history),signature=sketch.serializeSketch(source);
  if(selection.sourceSignature!==signature)
    throw Error('Profile edit refused: stale source; reselect the profile.');
  const candidate=dragProfileHandleAtPointer(source,selection,{
    kind:'drag-profile-handle',version:1,sourceSignature:signature,handleId,target,
  });
  if(candidate.kind!=='accepted')
    throw Error('Profile edit refused by SKETCH: '+candidate.reason+
      (candidate.detail?(' ('+candidate.detail+')'):''));
  if(candidate.changedConstraintIds.length<1 || candidate.changedConstraintIds.length>2 ||
     new Set(candidate.changedConstraintIds).size!==candidate.changedConstraintIds.length)
    throw Error('Profile edit refused: invalid solver constraint change set.');
  const changed=new Set(candidate.changedConstraintIds);
  const oldConstraints=new Map(source.constraints.map(c=>[c.id,c]));
  const newConstraints=new Map(candidate.sketch.constraints.map(c=>[c.id,c]));
  if(oldConstraints.size!==source.constraints.length ||
     newConstraints.size!==candidate.sketch.constraints.length ||
     oldConstraints.size!==newConstraints.size ||
     JSON.stringify({...source,constraints:[]})!==JSON.stringify({...candidate.sketch,constraints:[]}))
    throw Error('Profile edit refused: solver changed non-constraint sketch entities.');
  const edits: {constraintId:string;patch:Partial<{value:number;x:number;y:number}>}[]=[];
  for(const [id,oldValue] of oldConstraints){
    const nextValue=newConstraints.get(id);
    if(!nextValue)throw Error('Profile edit refused: solver removed a constraint.');
    const oldFields=oldValue as unknown as Record<string,unknown>;
    const newFields=nextValue as unknown as Record<string,unknown>;
    const stable=(fields:Record<string,unknown>)=>
      Object.fromEntries(Object.entries(fields).filter(([key])=>!['x','y','value'].includes(key)));
    if(JSON.stringify(stable(oldFields))!==JSON.stringify(stable(newFields)))
      throw Error('Profile edit refused: solver changed a constraint identity or kind.');
    if(!changed.has(id)){
      if(JSON.stringify(oldValue)!==JSON.stringify(nextValue))
        throw Error('Profile edit refused: solver changed an undeclared constraint.');
      continue;
    }
    const patch:Partial<{value:number;x:number;y:number}>={};
    for(const key of ['value','x','y'] as const){
      if(oldFields[key]===newFields[key])continue;
      if(typeof newFields[key]!=='number'||!Number.isFinite(newFields[key]))
        throw Error('Profile edit refused: invalid solver scalar.');
      patch[key]=newFields[key] as number;
    }
    if(!Object.keys(patch).length)
      throw Error('Profile edit refused: solver declared a no-op constraint.');
    edits.push({constraintId:id,patch});
  }
  if(edits.length!==changed.size)
    throw Error('Profile edit refused: unrecognized solver constraint IDs.');
  const committed=runtime.editSketchConstraints(history,{
    sketchFeatureId:'sketch.plate',
    eventId:'workbench.profile.pointer.'+history.document.revision,
    expectedRevision:history.document.revision,admission:'require_admissible',edits,
  });
  if(committed.kind!=='committed')
    throw Error('Profile edit refused by RUNTIME: '+committed.reason);
  if(sketch.serializeSketch(sourceSketch(committed.history))!==candidate.nextSourceSignature)
    throw Error('Profile edit refused: RUNTIME successor differs from SKETCH acceptance.');
  return {history:committed.history,selection:candidate.selection,
    invalidatedFeatureIds:committed.invalidation.invalidatedFeatureIds};
}
