import {createObroundSlot,inspectObroundSlot,editObroundSlot,
  type ObroundSlotRequest,type ObroundSlotEdit,type ObroundSlotResult}
  from '../obround-slot.mjs';
const spec:ObroundSlotRequest={id:'slotA',overallLengthMm:60,diameterMm:12};
const doc=createObroundSlot(spec);
const state=inspectObroundSlot(doc,spec.id);
const action:ObroundSlotEdit={kind:'resize',overallLengthMm:90,diameterMm:16};
const result:ObroundSlotResult=editObroundSlot(doc,'slotA',action,state.sourceSignature);
if(result.kind==='accepted'){
  const profileId:string=result.profile.id;
  const exact:false=result.profile.exactBrepAvailable;
  void profileId;void exact;
}
// @ts-expect-error a slot does not claim production native geometry
const bad:true=state.previewOnly;
void bad;
