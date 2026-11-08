import {createDimensionedLPlateSketch} from '@intuit3d/sketch/selected-profile/v1';
import {serializeSketch} from '@intuit3d/sketch';
import {selectContourAtPointer} from '@intuit3d/sketch/pointer-contour-selection/v1';
import {inspectPointerEditableHandles,pickProfileHandleAtPointer,
  dragProfileHandleAtPointer,POINTER_PROFILE_EDIT_VERSION}
  from '@intuit3d/sketch/pointer-profile-edit/v1';
import type {PointerEditableInventory,PointerEditRefusal,
  PickProfileHandleCommand,PickProfileHandleResult,AmbiguousProfileHandleResult,
  MissProfileHandleResult,DragProfileHandleCommand,DragProfileHandleAccepted,
  PointerEditableHandle} from '@intuit3d/sketch/pointer-profile-edit/v1';
const source=createDimensionedLPlateSketch(),stamp=serializeSketch(source);
const selected=selectContourAtPointer(source,{kind:'select-contour-at-pointer',
  version:1,sourceSignature:stamp,point:{x:10,y:40},boundaryClearanceMm:0.1});
if(selected.kind==='selected'){
  const inventory:PointerEditableInventory|PointerEditRefusal=
    inspectPointerEditableHandles(source,selected.selection);
  const cmd:PickProfileHandleCommand={kind:'pick-profile-handle',
    version:POINTER_PROFILE_EDIT_VERSION,sourceSignature:stamp,
    point:{x:120,y:0},maxDistanceMm:0.2,filter:'dimension'};
  const result:PickProfileHandleResult|AmbiguousProfileHandleResult|
    MissProfileHandleResult|PointerEditRefusal=
    pickProfileHandleAtPointer(source,selected.selection,cmd);
  if(result.kind==='picked'){
    const handle:PointerEditableHandle=result.handle;
    const gesture:DragProfileHandleCommand={kind:'drag-profile-handle',
      version:1,sourceSignature:stamp,handleId:handle.handleId,
      target:{x:150,y:0}};
    const edit:DragProfileHandleAccepted|PointerEditRefusal=
      dragProfileHandleAtPointer(source,selected.selection,gesture);
    if(edit.kind==='accepted'){
      const id:string=edit.selection.candidateId;
      const error:number=edit.gesture.deviationMm;
      void id;void error;
    }
  }
  if(inventory.kind==='pointer_editable_handles'){
    const editable:PointerEditableHandle[]=inventory.handles;
    void editable;
  }
}
