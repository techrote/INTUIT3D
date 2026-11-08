import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection} from './selected-profile.mjs';
import type {ArcSketchDocument,ArcSketchSolution} from './arc-constraints.mjs';
import type {AnalyticArcProfile} from './arc-profile.mjs';
export const SELECTED_EDGE_ROUND_SLOT_VERSION:1;
export const SELECTED_EDGE_ROUND_SLOT_FORMAT:'intuit3d.selected-edge-round-slot';
export type EdgeRoundSlotSpec={
  id:string;edgeId:string;fromMm:number;toMm:number;straightDepthMm:number;
};
export type EdgeRoundSlotAuthoring={
  format:'intuit3d.selected-edge-round-slot';version:1;
  source:SketchDocument;selection:SelectedProfileSelection;slot:EdgeRoundSlotSpec;
};
export type EdgeRoundSlotHandle={
  id:string;kind:'from'|'to'|'cap-tip';position:{x:number;y:number};
};
export type EdgeRoundSlotRefusal={
  kind:'refused';format:'intuit3d.selected-edge-round-slot';version:1;
  sourceSignature:string|null;reason:string;detail:string|null;
  sourceStatus:SketchSolution['status']|ArcSketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics']|ArcSketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;
};
export type EdgeRoundSlotInspection={
  kind:'selected_edge_round_slot';
  format:'intuit3d.selected-edge-round-slot';version:1;
  slot:EdgeRoundSlotSpec;sourceSignature:string;arcSourceSignature:string;
  originalCandidateId:string;originalProfileId:string;
  sourceSelection:SelectedProfileSelection;
  originalEdgeId:string;originalStartPointId:string;originalEndPointId:string;
  originalLengthMm:number;
  axis:{x:number;y:number};inward:{x:number;y:number};
  boundaryIds:string[];holeIds:string[];handles:EdgeRoundSlotHandle[];
  arcSketch:ArcSketchDocument;solution:ArcSketchSolution;
  profile:AnalyticArcProfile;
  authoring:EdgeRoundSlotAuthoring;authoringSignature:string;
  previewOnly:true;nativeExact:false;
  exactBrepAvailable:false;independentStepQualified:false;
};
export type EdgeRoundSlotAccepted=Omit<EdgeRoundSlotInspection,'kind'>&{
  kind:'accepted';nextSourceSignature?:string;
  gesture?:{handleId:string;requested:{x:number;y:number};
    applied:{x:number;y:number};projectionDeviationMm:number};
};
export type CreateEdgeRoundSlotCommand=EdgeRoundSlotSpec&{
  kind:'create-selected-edge-round-slot';version:1;sourceSignature:string;
};
export type EditEdgeRoundSlotCommand={
  kind:'edit-selected-edge-round-slot';version:1;sourceSignature:string;
  fromMm:number;toMm:number;straightDepthMm:number;
};
export type RebaseEdgeRoundSlotCommand={
  kind:'rebase-selected-edge-round-slot';version:1;sourceSignature:string;
};
export type DragEdgeRoundSlotGesture={
  version:1;sourceSignature:string;handleId:string;
  target:{x:number;y:number};
};
export function serializeSelectedEdgeRoundSlot(value:EdgeRoundSlotAuthoring):string;
export function parseSelectedEdgeRoundSlot(json:string):EdgeRoundSlotAuthoring;
export function createSelectedEdgeRoundSlot(source:SketchDocument,
  selection:SelectedProfileSelection,command:CreateEdgeRoundSlotCommand):
  EdgeRoundSlotAccepted|EdgeRoundSlotRefusal;
export function inspectSelectedEdgeRoundSlot(authoring:EdgeRoundSlotAuthoring):
  EdgeRoundSlotInspection|EdgeRoundSlotRefusal;
export function editSelectedEdgeRoundSlot(authoring:EdgeRoundSlotAuthoring,
  command:EditEdgeRoundSlotCommand):EdgeRoundSlotAccepted|EdgeRoundSlotRefusal;
export function dragSelectedEdgeRoundSlotHandle(authoring:EdgeRoundSlotAuthoring,
  gesture:DragEdgeRoundSlotGesture):EdgeRoundSlotAccepted|EdgeRoundSlotRefusal;
export function rebaseSelectedEdgeRoundSlot(authoring:EdgeRoundSlotAuthoring,
  source:SketchDocument,selection:SelectedProfileSelection,
  command:RebaseEdgeRoundSlotCommand):EdgeRoundSlotAccepted|EdgeRoundSlotRefusal;
