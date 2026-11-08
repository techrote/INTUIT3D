import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {serializeSketch} from '../index.mjs';
import {createSelectedEdgeRoundSlotLayout,addSelectedEdgeRoundSlotLayout,
  editSelectedEdgeRoundSlotLayout,dragSelectedEdgeRoundSlotLayoutHandle,
  inspectSelectedEdgeRoundSlotLayout,rebaseSelectedEdgeRoundSlotLayout,
  serializeSelectedEdgeRoundSlotLayout,parseSelectedEdgeRoundSlotLayout}
  from '../selected-edge-round-slot-layout.mjs';
import type {RoundSlotLayoutCreateCommand,RoundSlotLayoutAuthoring,
  RoundSlotLayoutEditCommand,RoundSlotLayoutDragGesture}
  from '../selected-edge-round-slot-layout.mjs';
const source=createDimensionedLPlateSketch(),signature=serializeSketch(source);
const selection={candidateId:'chosen',sourceSignature:signature};
const command:RoundSlotLayoutCreateCommand={
  kind:'create-selected-edge-round-slot-layout',version:1,sourceSignature:signature,
  slots:[{id:'a',edgeId:'L:edge0',fromMm:35,toMm:55,straightDepthMm:5}]
};
const a:RoundSlotLayoutAuthoring={
  format:'intuit3d.selected-edge-round-slot-layout',version:1,
  source,selection,slots:command.slots
};
const edit:RoundSlotLayoutEditCommand={
  kind:'edit-selected-edge-round-slot-layout',version:1,
  sourceSignature:serializeSelectedEdgeRoundSlotLayout(a),
  slotId:'a',fromMm:36,toMm:56,straightDepthMm:5};
const gesture:RoundSlotLayoutDragGesture={
  version:1,sourceSignature:edit.sourceSignature,
  handleId:'a:handle-slide',target:{x:45,y:7}};
const result=createSelectedEdgeRoundSlotLayout(source,selection,command);
if(result.kind==='accepted'){
  void result.profile.materialAreaMm2;
  void result.bindings[0].edgeId;
}
const reopened=parseSelectedEdgeRoundSlotLayout(serializeSelectedEdgeRoundSlotLayout(a));
const inspected=inspectSelectedEdgeRoundSlotLayout(reopened);
if(inspected.kind==='selected_edge_round_slot_layout'){
  void inspected.handles[0].slotId;
}
void [addSelectedEdgeRoundSlotLayout(a,{
  kind:'add-selected-edge-round-slot-layout',version:1,
  sourceSignature:edit.sourceSignature,
  slot:{id:'b',edgeId:'L:edge0',fromMm:65,toMm:80,straightDepthMm:4}
}),editSelectedEdgeRoundSlotLayout(a,edit),
dragSelectedEdgeRoundSlotLayoutHandle(a,gesture),
rebaseSelectedEdgeRoundSlotLayout(a,source,selection,{
  kind:'rebase-selected-edge-round-slot-layout',version:1,
  sourceSignature:edit.sourceSignature})];
