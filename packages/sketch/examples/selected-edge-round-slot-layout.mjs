import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {serializeSketch} from '../index.mjs';
import {createSelectedEdgeRoundSlotLayout,addSelectedEdgeRoundSlotLayout,
  dragSelectedEdgeRoundSlotLayoutHandle,serializeSelectedEdgeRoundSlotLayout,
  parseSelectedEdgeRoundSlotLayout,inspectSelectedEdgeRoundSlotLayout}
  from '../selected-edge-round-slot-layout.mjs';
const source=createDimensionedLPlateSketch();
const selected=discoverPlateProfiles(source).candidates.find(c=>c.lineIds.includes('L:edge0'));
if(!selected)throw new Error('selected contour missing');
const selection={candidateId:selected.id,sourceSignature:serializeSketch(source)};
const created=createSelectedEdgeRoundSlotLayout(source,selection,{
  kind:'create-selected-edge-round-slot-layout',version:1,
  sourceSignature:serializeSketch(source),
  slots:[{id:'slotA',edgeId:'L:edge0',fromMm:35,toMm:55,straightDepthMm:5}]
});
if(created.kind!=='accepted')throw new Error(JSON.stringify(created));
const added=addSelectedEdgeRoundSlotLayout(created.authoring,{
  kind:'add-selected-edge-round-slot-layout',version:1,
  sourceSignature:created.authoringSignature,
  slot:{id:'slotB',edgeId:'L:edge0',fromMm:65,toMm:80,straightDepthMm:4}
});
if(added.kind!=='accepted')throw new Error(JSON.stringify(added));
const reopened=inspectSelectedEdgeRoundSlotLayout(
  parseSelectedEdgeRoundSlotLayout(serializeSelectedEdgeRoundSlotLayout(added.authoring)));
if(reopened.kind!=='selected_edge_round_slot_layout')throw new Error(JSON.stringify(reopened));
const handle=reopened.handles.find(h=>h.id==='slotB:handle-slide');
const moved=dragSelectedEdgeRoundSlotLayoutHandle(reopened.authoring,{
  version:1,sourceSignature:reopened.authoringSignature,handleId:handle.id,
  target:{x:handle.position.x+2,y:handle.position.y+3}
});
if(moved.kind!=='accepted')throw new Error(JSON.stringify(moved));
console.log(JSON.stringify({kind:moved.kind,slots:moved.slots,
  arcs:moved.arcSketch.arcs.length,materialAreaMm2:moved.profile.materialAreaMm2,
  solverStatus:moved.solution.status,degreeOfFreedom:moved.solution.degreesOfFreedom,
  projectedDeviationMm:moved.gesture.projectionDeviationMm,
  originalConstraintCount:moved.authoring.source.constraints.length,
  nativeExact:moved.nativeExact}));
