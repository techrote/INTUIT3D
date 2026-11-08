import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {serializeSketch} from '../index.mjs';
import {createSelectedCornerChamfer,inspectSelectedCornerChamfer,
  dragSelectedCornerChamferHandle} from '../selected-corner-chamfer.mjs';
import type {CreateChamferCommand,ChamferInspection} from '../selected-corner-chamfer.mjs';
const doc=createDimensionedLPlateSketch();
const sel={candidateId:discoverPlateProfiles(doc).candidates[0].id,
  sourceSignature:serializeSketch(doc)};
const command:CreateChamferCommand={kind:'create-corner-chamfer',version:1,
  sourceSignature:sel.sourceSignature,chamferId:'bevel',
  cornerPointId:'L:b',incomingMm:12,outgoingMm:8};
const r=createSelectedCornerChamfer(doc,sel,command);
if(r.kind==='accepted'){
  const view=inspectSelectedCornerChamfer(r.sketch,r.selection,r.chamferId);
  if(view.kind==='selected_corner_chamfer'){
    const inspection:ChamferInspection=view;
    const x:number=inspection.incomingMm;
    const y=dragSelectedCornerChamferHandle(r.sketch,r.selection,{
      version:1,sourceSignature:r.nextSourceSignature,
      chamferId:r.chamferId,handleId:view.handles[0].id,
      target:{x,y:5}});
    if(y.kind==='accepted')console.log(y.sketch.lines.length);
  }
}
