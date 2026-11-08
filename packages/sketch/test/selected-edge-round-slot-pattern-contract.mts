import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {serializeSketch} from '../index.mjs';
import {createSelectedEdgeRoundSlotPattern,inspectSelectedEdgeRoundSlotPattern,
  editSelectedEdgeRoundSlotPattern,dragSelectedEdgeRoundSlotPatternHandle,
  rebaseSelectedEdgeRoundSlotPattern,parseSelectedEdgeRoundSlotPattern,
  serializeSelectedEdgeRoundSlotPattern}
  from '../selected-edge-round-slot-pattern.mjs';
import type {SlotPatternSpec,SlotPatternAuthoring,SlotPatternEditCommand,
  SlotPatternGesture} from '../selected-edge-round-slot-pattern.mjs';

const source=createDimensionedLPlateSketch(),signature=serializeSketch(source);
const pattern:SlotPatternSpec={id:'mount',edgeId:'L:edge0',count:3,
  firstCenterMm:20,pitchMm:23,widthMm:8,straightDepthMm:3};
const selection={candidateId:'candidate',sourceSignature:signature};
const document:SlotPatternAuthoring={
  format:'intuit3d.selected-edge-round-slot-pattern',version:1,
  source,selection,pattern};
const command:SlotPatternEditCommand={
  kind:'edit-selected-edge-round-slot-pattern',version:1,
  sourceSignature:serializeSelectedEdgeRoundSlotPattern(document),
  count:3,firstCenterMm:22,pitchMm:24,widthMm:9,straightDepthMm:3};
const gesture:SlotPatternGesture={
  version:1,sourceSignature:command.sourceSignature,
  handleId:'mount:handle-origin',target:{x:22,y:1}};
const result=createSelectedEdgeRoundSlotPattern(source,selection,{
  kind:'create-selected-edge-round-slot-pattern',version:1,
  sourceSignature:signature,pattern
});
if(result.kind==='accepted'){
  void result.profile.materialAreaMm2;
  void result.handles[0].position.x;
  void result.slots[0].edgeId;
}
const inspected=inspectSelectedEdgeRoundSlotPattern(
  parseSelectedEdgeRoundSlotPattern(serializeSelectedEdgeRoundSlotPattern(document)));
if(inspected.kind==='selected_edge_round_slot_pattern'){
  void inspected.arcSourceSignature;
}
void [editSelectedEdgeRoundSlotPattern(document,command),
  dragSelectedEdgeRoundSlotPatternHandle(document,gesture),
  rebaseSelectedEdgeRoundSlotPattern(document,source,selection,{
    kind:'rebase-selected-edge-round-slot-pattern',version:1,
    sourceSignature:command.sourceSignature})];
