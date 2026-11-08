import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection} from './selected-profile.mjs';
import type {ArcSketchDocument,ArcSketchSolution} from './arc-constraints.mjs';
import type {AnalyticArcProfile} from './arc-profile.mjs';
import type {EdgeRoundSlotSpec} from './selected-edge-round-slot.mjs';
export const SELECTED_EDGE_ROUND_SLOT_LAYOUT_VERSION:1;
export const SELECTED_EDGE_ROUND_SLOT_LAYOUT_FORMAT:'intuit3d.selected-edge-round-slot-layout';
export const MAX_SELECTED_EDGE_ROUND_SLOTS:8;
export type RoundSlotLayoutAuthoring={
  format:'intuit3d.selected-edge-round-slot-layout';version:1;
  source:SketchDocument;selection:SelectedProfileSelection;slots:EdgeRoundSlotSpec[];
};
export type RoundSlotLayoutHandle={
  id:string;slotId:string;kind:'from'|'to'|'cap-tip'|'slide';
  position:{x:number;y:number};
};
export type RoundSlotLayoutRefusal={
  kind:'refused';format:'intuit3d.selected-edge-round-slot-layout';version:1;
  sourceSignature:string|null;reason:string;slotId:string|null;
  detail:string|null;
  sourceStatus:SketchSolution['status']|ArcSketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics']|ArcSketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;
};
export type RoundSlotLayoutInspection={
  kind:'selected_edge_round_slot_layout';format:'intuit3d.selected-edge-round-slot-layout';
  version:1;sourceSignature:string;authoringSignature:string;
  authoring:RoundSlotLayoutAuthoring;slots:EdgeRoundSlotSpec[];
  originalProfileId:string;
  bindings:Array<{slotId:string;edgeId:string;startPointId:string;
    endPointId:string;profileId:string;lengthMm:number}>;
  handles:RoundSlotLayoutHandle[];boundaryIds:string[];holeIds:string[];
  arcSketch:ArcSketchDocument;arcSourceSignature:string;
  solution:ArcSketchSolution;profile:AnalyticArcProfile;
  previewOnly:true;nativeExact:false;
  exactBrepAvailable:false;independentStepQualified:false;
};
export type RoundSlotLayoutAccepted=Omit<RoundSlotLayoutInspection,'kind'|'sourceSignature'>&{
  kind:'accepted';sourceSignature:string;nextSourceSignature:string;
  gesture?:{handleId:string;requested:{x:number;y:number};
    applied:{x:number;y:number};projectionDeviationMm:number};
};
export type RoundSlotLayoutCreateCommand={
  kind:'create-selected-edge-round-slot-layout';version:1;
  sourceSignature:string;slots:EdgeRoundSlotSpec[];
};
export type RoundSlotLayoutAddCommand={
  kind:'add-selected-edge-round-slot-layout';version:1;
  sourceSignature:string;slot:EdgeRoundSlotSpec;
};
export type RoundSlotLayoutEditCommand={
  kind:'edit-selected-edge-round-slot-layout';version:1;sourceSignature:string;
  slotId:string;fromMm:number;toMm:number;straightDepthMm:number;
};
export type RoundSlotLayoutRelocateCommand={
  kind:'relocate-selected-edge-round-slot-layout';version:1;sourceSignature:string;
  slotId:string;edgeId:string;fromMm:number;toMm:number;straightDepthMm:number;
};
export type RoundSlotLayoutRemoveCommand={
  kind:'remove-selected-edge-round-slot-layout';version:1;
  sourceSignature:string;slotId:string;
};
export type RoundSlotLayoutDragGesture={
  version:1;sourceSignature:string;handleId:string;target:{x:number;y:number};
};
export type RoundSlotLayoutRebaseCommand={
  kind:'rebase-selected-edge-round-slot-layout';version:1;sourceSignature:string;
};
export function serializeSelectedEdgeRoundSlotLayout(a:RoundSlotLayoutAuthoring):string;
export function parseSelectedEdgeRoundSlotLayout(json:string):RoundSlotLayoutAuthoring;
export function inspectSelectedEdgeRoundSlotLayout(a:RoundSlotLayoutAuthoring):
  RoundSlotLayoutInspection|RoundSlotLayoutRefusal;
export function createSelectedEdgeRoundSlotLayout(source:SketchDocument,
  selection:SelectedProfileSelection,command:RoundSlotLayoutCreateCommand):
  RoundSlotLayoutAccepted|RoundSlotLayoutRefusal;
export function addSelectedEdgeRoundSlotLayout(a:RoundSlotLayoutAuthoring,
  command:RoundSlotLayoutAddCommand):RoundSlotLayoutAccepted|RoundSlotLayoutRefusal;
export function editSelectedEdgeRoundSlotLayout(a:RoundSlotLayoutAuthoring,
  command:RoundSlotLayoutEditCommand):RoundSlotLayoutAccepted|RoundSlotLayoutRefusal;
export function relocateSelectedEdgeRoundSlotLayout(a:RoundSlotLayoutAuthoring,
  command:RoundSlotLayoutRelocateCommand):RoundSlotLayoutAccepted|RoundSlotLayoutRefusal;
export function removeSelectedEdgeRoundSlotLayout(a:RoundSlotLayoutAuthoring,
  command:RoundSlotLayoutRemoveCommand):RoundSlotLayoutAccepted|RoundSlotLayoutRefusal;
export function dragSelectedEdgeRoundSlotLayoutHandle(a:RoundSlotLayoutAuthoring,
  gesture:RoundSlotLayoutDragGesture):RoundSlotLayoutAccepted|RoundSlotLayoutRefusal;
export function rebaseSelectedEdgeRoundSlotLayout(a:RoundSlotLayoutAuthoring,
  source:SketchDocument,selection:SelectedProfileSelection,
  command:RoundSlotLayoutRebaseCommand):RoundSlotLayoutAccepted|RoundSlotLayoutRefusal;
