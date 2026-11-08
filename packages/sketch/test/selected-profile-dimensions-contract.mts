import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {serializeSketch} from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {SELECTED_PROFILE_DIMENSIONS_VERSION,inspectSelectedProfileDimensions,
  editSelectedProfileDimensions,dragSelectedProfileDimension}
  from '../selected-profile-dimensions.mjs';
import type {DimensionInspection,DimensionRefusal,DimensionAccepted,
  EditSelectedDimensionsCommand,DimensionGesture} from '../selected-profile-dimensions.mjs';
const doc=createDimensionedLPlateSketch(),selection={
  candidateId:discoverPlateProfiles(doc).candidates[0].id,
  sourceSignature:serializeSketch(doc)};
const version:1=SELECTED_PROFILE_DIMENSIONS_VERSION;
const view=inspectSelectedProfileDimensions(doc,selection);
if(view.kind==='selected_profile_dimensions'){
  const typed:DimensionInspection=view;
  const value:number=typed.dimensions[0].value;
  const command:EditSelectedDimensionsCommand={kind:'edit-selected-dimensions',
    version,sourceSignature:selection.sourceSignature,
    changes:[{constraintId:typed.dimensions[0].constraintId,value:value+1}]};
  const result=editSelectedProfileDimensions(doc,selection,command);
  if(result.kind==='accepted'){
    const accepted:DimensionAccepted=result;
    const gesture:DimensionGesture={version:1,
      sourceSignature:accepted.nextSourceSignature,
      handleId:typed.dimensions[0].handle.id,target:{x:150,y:0}};
    const next=dragSelectedProfileDimension(accepted.sketch,accepted.selection,gesture);
    if(next.kind==='accepted')console.log(next.gesture.applied.x);
  }else{
    const refused:DimensionRefusal=result;
    console.log(refused.conflict?.constraintIds);
  }
}
