import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection,SelectedAnalyticProfile} from './selected-profile.mjs';
export const SELECTED_EDGE_NOTCH_VERSION:1;
export type EdgeNotchRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];previewOnly:true;nativeExact:false;
};
export type EdgeNotchHandle={
  id:string;kind:'from'|'to'|'depth';position:{x:number;y:number};
};
export type EdgeNotchInspection={
  kind:'selected_edge_notch';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;semanticProfileId:string;notchId:string;
  originalEdgeId:string;originalStartPointId:string;originalEndPointId:string;
  originalLengthMm:number;fromMm:number;toMm:number;depthMm:number;
  axis:{x:number;y:number};inward:{x:number;y:number};
  handles:EdgeNotchHandle[];profile:SelectedAnalyticProfile;
  previewOnly:true;nativeExact:false;
};
export type CreateEdgeNotchCommand={
  kind:'create-edge-notch';version:1;sourceSignature:string;notchId:string;
  edgeId:string;fromMm:number;toMm:number;depthMm:number;
};
export type EditEdgeNotchCommand={
  kind:'edit-edge-notch';version:1;sourceSignature:string;notchId:string;
  fromMm:number;toMm:number;depthMm:number;
};
export type DragEdgeNotchGesture={
  version:1;sourceSignature:string;notchId:string;
  handleId:string;target:{x:number;y:number};
};
export type EdgeNotchAccepted={
  kind:'accepted';version:1;sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;selection:SelectedProfileSelection;
  profile:SelectedAnalyticProfile;previousCandidateId:string;
  nextCandidateId:string;notchId:string;originalEdgeId:string;
  createdEntityIds:string[];changedConstraintIds:string[];
  handles:EdgeNotchHandle[];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type EdgeNotchDragged=EdgeNotchAccepted&{
  gesture:{handleId:string;requested:{x:number;y:number};
    applied:{x:number;y:number};projectionDeviationMm:number};
};
export function createSelectedEdgeNotch(source:SketchDocument,
  selection:SelectedProfileSelection,command:CreateEdgeNotchCommand):
  EdgeNotchAccepted|EdgeNotchRefusal;
export function inspectSelectedEdgeNotch(source:SketchDocument,
  selection:SelectedProfileSelection,notchId:string):
  EdgeNotchInspection|EdgeNotchRefusal;
export function editSelectedEdgeNotch(source:SketchDocument,
  selection:SelectedProfileSelection,command:EditEdgeNotchCommand):
  EdgeNotchAccepted|EdgeNotchRefusal;
export function dragSelectedEdgeNotchHandle(source:SketchDocument,
  selection:SelectedProfileSelection,gesture:DragEdgeNotchGesture):
  EdgeNotchDragged|EdgeNotchAccepted|EdgeNotchRefusal;
