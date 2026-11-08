import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {serializeSketch,editConstraint} from '../index.mjs';
import {createSelectedEdgeRoundSlot,editSelectedEdgeRoundSlot,
  dragSelectedEdgeRoundSlotHandle,inspectSelectedEdgeRoundSlot,
  serializeSelectedEdgeRoundSlot,parseSelectedEdgeRoundSlot,
  rebaseSelectedEdgeRoundSlot} from '../selected-edge-round-slot.mjs';
const doc=createDimensionedLPlateSketch();
const chosen=discoverPlateProfiles(doc).candidates.find(c=>
  c.lineIds.includes('L:edge0'));
if(!chosen)throw new Error('no selected bracket contour');
const select={candidateId:chosen.id,sourceSignature:serializeSketch(doc)};
const created=createSelectedEdgeRoundSlot(doc,select,{
  kind:'create-selected-edge-round-slot',version:1,
  sourceSignature:serializeSketch(doc),id:'uSlot',edgeId:'L:edge0',
  fromMm:45,toMm:65,straightDepthMm:8
});
if(created.kind!=='accepted')throw new Error('create: '+JSON.stringify(created));
console.log(JSON.stringify({step:'created',status:created.solution.status,
  areaMm2:created.profile.materialAreaMm2,
  arcCount:created.arcSketch.arcs.length,nativeExact:created.nativeExact}));
const edited=editSelectedEdgeRoundSlot(created.authoring,{
  kind:'edit-selected-edge-round-slot',version:1,
  sourceSignature:created.authoringSignature,
  fromMm:40,toMm:68,straightDepthMm:10
});
if(edited.kind!=='accepted')throw new Error('edit: '+JSON.stringify(edited));
const archive=serializeSelectedEdgeRoundSlot(edited.authoring);
const reopened=parseSelectedEdgeRoundSlot(archive);
const inspected=inspectSelectedEdgeRoundSlot(reopened);
if(inspected.kind!=='selected_edge_round_slot')
  throw new Error('inspect: '+JSON.stringify(inspected));
console.log(JSON.stringify({step:'edited-reopened',arcCount:inspected.arcSketch.arcs.length,
  widthMm:inspected.slot.toMm-inspected.slot.fromMm,
  areaMm2:inspected.profile.materialAreaMm2}));
const tip=inspected.handles.find(h=>h.kind==='cap-tip');
const dragged=dragSelectedEdgeRoundSlotHandle(reopened,{
  version:1,sourceSignature:inspected.authoringSignature,
  handleId:tip.id,target:{x:tip.position.x+3,y:tip.position.y+2}
});
if(dragged.kind!=='accepted')throw new Error('drag: '+JSON.stringify(dragged));
console.log(JSON.stringify({step:'dragged',depthMm:dragged.slot.straightDepthMm,
  projectionDeviationMm:dragged.gesture.projectionDeviationMm}));
const wider=editConstraint(dragged.authoring.source,'L:length',{value:140});
const selW=discoverPlateProfiles(wider).candidates.find(c=>
  c.lineIds.includes('L:edge0'));
if(!selW)throw new Error('lost L contour');
const updated=rebaseSelectedEdgeRoundSlot(dragged.authoring,wider,{
  candidateId:selW.id,sourceSignature:serializeSketch(wider)
},{
  kind:'rebase-selected-edge-round-slot',version:1,
  sourceSignature:dragged.authoringSignature
});
if(updated.kind!=='accepted')throw new Error('rebase: '+JSON.stringify(updated));
console.log(JSON.stringify({step:'rebased',lengthMm:updated.originalLengthMm,
  holeIds:updated.holeIds,nativeExact:updated.nativeExact}));
const denied=editSelectedEdgeRoundSlot(updated.authoring,{
  kind:'edit-selected-edge-round-slot',version:1,
  sourceSignature:updated.authoringSignature,
  fromMm:80,toMm:100,straightDepthMm:15
});
if(denied.kind!=='refused')throw new Error('unsafe slot unexpectedly accepted');
console.log(JSON.stringify({step:'refused',reason:denied.reason}));
