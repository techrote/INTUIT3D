import {createObroundSlot} from '@intuit3d/sketch/obround-slot/v1';
import {inspectObroundSlotHandles,dragObroundSlotHandle}
  from '@intuit3d/sketch/obround-slot-handles/v1';
import type {SlotHandle,SlotDragGesture} from '@intuit3d/sketch/obround-slot-handles/v1';
const doc=createObroundSlot({id:'mount',overallLengthMm:60,diameterMm:12});
const inspection=inspectObroundSlotHandles(doc,'mount');
const control:SlotHandle=inspection.handles[0]!;
const req:SlotDragGesture={version:1,handleId:control.id,
  expectedSignature:inspection.sourceSignature,target:{x:100,y:12}};
const result=dragObroundSlotHandle(doc,'mount',req);
if(result.kind==='accepted'){
  const exactNative:false=result.profile.exactBrepAvailable;
  const notStep:false=result.profile.stepQualified;
  const preview:true=result.previewOnly;
  void exactNative;void notStep;void preview;
}
