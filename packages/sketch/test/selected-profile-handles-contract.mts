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
