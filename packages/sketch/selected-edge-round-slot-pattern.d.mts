import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection} from './selected-profile.mjs';
import type {ArcSketchDocument,ArcSketchSolution} from './arc-constraints.mjs';
import type {AnalyticArcProfile} from './arc-profile.mjs';
import type {EdgeRoundSlotSpec} from './selected-edge-round-slot.mjs';
import type {RoundSlotLayoutHandle} from './selected-edge-round-slot-layout.mjs';

export const SELECTED_EDGE_ROUND_SLOT_PATTERN_FORMAT:'intuit3d.selected-edge-round-slot-pattern';
export const SELECTED_EDGE_ROUND_SLOT_PATTERN_VERSION:1;
export const MAX_SELECTED_EDGE_ROUND_SLOT_PATTERN_COUNT:8;
export type SlotPatternSpec={id:string;edgeId:string;count:number;
  firstCenterMm:number;pitchMm:number;widthMm:number;straightDepthMm:number};
export type SlotPatternAuthoring={
  format:'intuit3d.selected-edge-round-slot-pattern';version:1;
  source:SketchDocument;selection:SelectedProfileSelection;pattern:SlotPatternSpec;
};
export type SlotPatternRefusal={
  kind:'refused';format:'intuit3d.selected-edge-round-slot-pattern';version:1;
  sourceSignature:string|null;reason:string;detail:string|null;
  sourceStatus:SketchSolution['status']|ArcSketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics']|ArcSketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;
};
export type SlotPatternHandle={
  id:string;kind:'origin'|'pitch'|'width'|'depth';
  position:{x:number;y:number};sourceHandleId:string;
};
export type SlotPatternInspection={
  kind:'selected_edge_round_slot_pattern';
  format:'intuit3d.selected-edge-round-slot-pattern';version:1;
  sourceSignature:string;authoringSignature:string;
  authoring:SlotPatternAuthoring;pattern:SlotPatternSpec;
  slots:EdgeRoundSlotSpec[];
  originalProfileId:string;
  bindings:Array<{slotId:string;edgeId:string;startPointId:string;
    endPointId:string;profileId:string;lengthMm:number}>;
  handles:SlotPatternHandle[];boundaryIds:string[];holeIds:string[];
  arcSketch:ArcSketchDocument;arcSourceSignature:string;
  solution:ArcSketchSolution;profile:AnalyticArcProfile;
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type SlotPatternAccepted=Omit<SlotPatternInspection,'kind'|'sourceSignature'>&{
  kind:'accepted';sourceSignature:string;nextSourceSignature:string;
  gesture?:{handleId:string;requested:{x:number;y:number};
    applied:{x:number;y:number};projectionDeviationMm:number};
};
export type SlotPatternCreateCommand={
  kind:'create-selected-edge-round-slot-pattern';version:1;
  sourceSignature:string;pattern:SlotPatternSpec;
};
export type SlotPatternEditCommand={
  kind:'edit-selected-edge-round-slot-pattern';version:1;sourceSignature:string;
  count:number;firstCenterMm:number;pitchMm:number;widthMm:number;straightDepthMm:number;
};
export type SlotPatternRelocateCommand={
  kind:'relocate-selected-edge-round-slot-pattern';version:1;sourceSignature:string;
  edgeId:string;firstCenterMm:number;pitchMm:number;widthMm:number;straightDepthMm:number;
};
export type SlotPatternGesture={
  version:1;sourceSignature:string;handleId:string;target:{x:number;y:number};
};
export type SlotPatternRebaseCommand={
  kind:'rebase-selected-edge-round-slot-pattern';version:1;sourceSignature:string;
};
export function serializeSelectedEdgeRoundSlotPattern(value:SlotPatternAuthoring):string;
export function parseSelectedEdgeRoundSlotPattern(json:string):SlotPatternAuthoring;
export function inspectSelectedEdgeRoundSlotPattern(value:SlotPatternAuthoring):
  SlotPatternInspection|SlotPatternRefusal;
export function createSelectedEdgeRoundSlotPattern(source:SketchDocument,
  selection:SelectedProfileSelection,command:SlotPatternCreateCommand):
  SlotPatternAccepted|SlotPatternRefusal;
export function editSelectedEdgeRoundSlotPattern(authoring:SlotPatternAuthoring,
  command:SlotPatternEditCommand):SlotPatternAccepted|SlotPatternRefusal;
export function relocateSelectedEdgeRoundSlotPattern(authoring:SlotPatternAuthoring,
  command:SlotPatternRelocateCommand):SlotPatternAccepted|SlotPatternRefusal;
export function dragSelectedEdgeRoundSlotPatternHandle(authoring:SlotPatternAuthoring,
  gesture:SlotPatternGesture):SlotPatternAccepted|SlotPatternRefusal;
export function rebaseSelectedEdgeRoundSlotPattern(authoring:SlotPatternAuthoring,
  source:SketchDocument,selection:SelectedProfileSelection,
  command:SlotPatternRebaseCommand):SlotPatternAccepted|SlotPatternRefusal;
