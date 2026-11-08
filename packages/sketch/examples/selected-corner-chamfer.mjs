import assert from 'node:assert/strict';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {serializeSketch,parseSketch,editConstraint} from '../index.mjs';
import {createSelectedCornerChamfer,inspectSelectedCornerChamfer,
  editSelectedCornerChamfer,dragSelectedCornerChamferHandle}
  from '../selected-corner-chamfer.mjs';
const sel=d=>({candidateId:discoverPlateProfiles(d).candidates[0].id,
  sourceSignature:serializeSketch(d)});
let sketch=createDimensionedLPlateSketch(),selection=sel(sketch);
const created=createSelectedCornerChamfer(sketch,selection,{
  kind:'create-corner-chamfer',version:1,sourceSignature:selection.sourceSignature,
  chamferId:'mount:chamfer',cornerPointId:'L:b',incomingMm:12,outgoingMm:8});
assert.equal(created.kind,'accepted',JSON.stringify(created));
sketch=created.sketch;selection=created.selection;
const edited=editSelectedCornerChamfer(sketch,selection,{
  kind:'edit-corner-chamfer',version:1,sourceSignature:selection.sourceSignature,
  chamferId:'mount:chamfer',incomingMm:18,outgoingMm:10});
assert.equal(edited.kind,'accepted',JSON.stringify(edited));
sketch=edited.sketch;selection=edited.selection;
const handle=inspectSelectedCornerChamfer(sketch,selection,'mount:chamfer')
  .handles.find(h=>h.kind==='outgoing');
const dragged=dragSelectedCornerChamferHandle(sketch,selection,{
  version:1,sourceSignature:selection.sourceSignature,
  chamferId:'mount:chamfer',handleId:handle.id,
  target:{x:123,y:12}});
assert.equal(dragged.kind,'accepted',JSON.stringify(dragged));
sketch=parseSketch(serializeSketch(dragged.sketch));
sketch=editConstraint(sketch,'L:length',{value:150});
const view=inspectSelectedCornerChamfer(sketch,sel(sketch),'mount:chamfer');
assert.equal(view.kind,'selected_corner_chamfer',JSON.stringify(view));
console.log(JSON.stringify({status:view.kind,corner:view.corner,
  incomingMm:view.incomingMm,outgoingMm:view.outgoingMm,
  holeIds:view.profile.holeIds,sourceSignature:view.sourceSignature,
  previewOnly:view.previewOnly,nativeExact:view.nativeExact}));
