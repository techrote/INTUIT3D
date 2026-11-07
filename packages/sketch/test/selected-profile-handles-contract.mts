import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {inspectSelectedProfileHandles,editSelectedProfileHandle,
  type SelectedProfileHandleCommand,type SelectedProfileHandleInspection,
  type SelectedProfileHandleEdit} from '../selected-profile-handles.mjs';
const sketch=createDimensionedLPlateSketch();
const discovery=discoverPlateProfiles(sketch);
const selection={candidateId:discovery.candidates[0]!.id,
  sourceSignature:discovery.inputSignature};
const state=inspectSelectedProfileHandles(sketch,selection);
if(state.kind==='selected_profile_handles'){
  const inspection:SelectedProfileHandleInspection=state;
  const cmd:SelectedProfileHandleCommand={kind:'set-dimension',
    sourceSignature:state.sourceSignature,handleId:state.controls[0]!.id,valueMm:150};
  const result=editSelectedProfileHandle(sketch,selection,cmd);
  if(result.kind==='accepted'){
    const edited:SelectedProfileHandleEdit=result;
    const area:number=edited.profile.profile.areaMm2;
    void [inspection,edited,area];
  }
}

// A WORKBENCH consumer can use the resolved position and send a single XY
// command; RUNTIME owns the resulting journal transaction and native rebuild.
import {moveSelectedProfileHoleCenter,
  type SelectedProfileHoleCenter,type SelectedProfileHoleMoveCommand,
  type SelectedProfileHoleMove} from '../selected-profile-handles.mjs';
const holes=state.kind==='selected_profile_handles'?state.holeCenters:[];
if(state.kind==='selected_profile_handles'&&holes.length){
  const hole:SelectedProfileHoleCenter=holes[0]!;
  const gesture:SelectedProfileHoleMoveCommand={
    kind:'move-hole-center',sourceSignature:state.sourceSignature,
    handleId:hole.id,xMm:hole.position.x+1,yMm:hole.position.y+1
  };
  const result=moveSelectedProfileHoleCenter(sketch,selection,gesture);
  if(result.kind==='accepted'){
    const accepted:SelectedProfileHoleMove=result;
    const holeId:string=accepted.holeId;
    const mm:number=accepted.gesture.deviationMm;
    void [holeId,mm];
  }
}
