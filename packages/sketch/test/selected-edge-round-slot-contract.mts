import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {serializeSketch} from '../index.mjs';
import {SELECTED_EDGE_ROUND_SLOT_VERSION,createSelectedEdgeRoundSlot,
  inspectSelectedEdgeRoundSlot,editSelectedEdgeRoundSlot,
  dragSelectedEdgeRoundSlotHandle,rebaseSelectedEdgeRoundSlot,
  serializeSelectedEdgeRoundSlot,parseSelectedEdgeRoundSlot}
  from '../selected-edge-round-slot.mjs';
import type {EdgeRoundSlotAuthoring,EdgeRoundSlotAccepted,
  CreateEdgeRoundSlotCommand,EditEdgeRoundSlotCommand,
  DragEdgeRoundSlotGesture,RebaseEdgeRoundSlotCommand}
  from '../selected-edge-round-slot.mjs';
const doc=createDimensionedLPlateSketch(),stamp=serializeSketch(doc);
const selection={candidateId:'example',sourceSignature:stamp};
const command:CreateEdgeRoundSlotCommand={
  kind:'create-selected-edge-round-slot',version:1,sourceSignature:stamp,
  id:'uSlot',edgeId:'L:edge0',fromMm:45,toMm:65,straightDepthMm:8};
const created=createSelectedEdgeRoundSlot(doc,selection,command);
const authoring:EdgeRoundSlotAuthoring={
  format:'intuit3d.selected-edge-round-slot',version:1,
  source:doc,selection,slot:{
    id:'uSlot',edgeId:'L:edge0',fromMm:45,toMm:65,straightDepthMm:8}};
const edit:EditEdgeRoundSlotCommand={
  kind:'edit-selected-edge-round-slot',version:1,
  sourceSignature:serializeSelectedEdgeRoundSlot(authoring),
  fromMm:45,toMm:65,straightDepthMm:12};
const drag:DragEdgeRoundSlotGesture={version:1,
  sourceSignature:serializeSelectedEdgeRoundSlot(authoring),
  handleId:'uSlot:handle-cap-tip',target:{x:55,y:20}};
const rebase:RebaseEdgeRoundSlotCommand={
  kind:'rebase-selected-edge-round-slot',version:1,
  sourceSignature:serializeSelectedEdgeRoundSlot(authoring)};
if(created.kind==='accepted'){
  const result:EdgeRoundSlotAccepted=created;
  void result.profile.materialAreaMm2;
}
const parsed=parseSelectedEdgeRoundSlot(serializeSelectedEdgeRoundSlot(authoring));
const inspected=inspectSelectedEdgeRoundSlot(parsed);
if(inspected.kind==='selected_edge_round_slot'){
  void inspected.arcSketch.arcs;
}
void [SELECTED_EDGE_ROUND_SLOT_VERSION,
  editSelectedEdgeRoundSlot(authoring,edit),
  dragSelectedEdgeRoundSlotHandle(authoring,drag),
  rebaseSelectedEdgeRoundSlot(authoring,doc,selection,rebase)];
