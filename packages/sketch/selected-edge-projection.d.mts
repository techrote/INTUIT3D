import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection,SelectedAnalyticProfile} from './selected-profile.mjs';
export const SELECTED_EDGE_PROJECTION_VERSION:1;
export type EdgeProjectionRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;detail:string|null;
  sourceStatus:SketchSolution['status']|null;diagnostics:SketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;
};
export type EdgeProjectionHandle={
  id:string;kind:'projected_offset';sourcePointId:string;targetPointId:string;
  position:{x:number;y:number};
};
export type EdgeProjectionAssociation={
  targetPointId:string;sourcePointId:string;sourceIndex:number;
  position:{x:number;y:number};
};
export type EdgeProjectionInspection={
  kind:'selected_edge_projection';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;projectionId:string;sourceSplitId:string;
  targetEdgeId:string;targetStartPointId:string;targetEndPointId:string;
  targetStart:{x:number;y:number};targetEnd:{x:number;y:number};
  targetTangent:{x:number;y:number};lengthMm:number;
  sourceOffsetsMm:number[];targetOffsetsMm:number[];
  associations:EdgeProjectionAssociation[];handles:EdgeProjectionHandle[];
  profile:SelectedAnalyticProfile;previewOnly:true;nativeExact:false;
};
export type CreateEdgeProjectionCommand={
  kind:'create-edge-projection';version:1;sourceSignature:string;
  projectionId:string;sourceSplitId:string;targetEdgeId:string;
};
export type EditEdgeProjectionCommand={
  kind:'edit-edge-projection';version:1;sourceSignature:string;
  projectionId:string;sourceSplitId:string;sourceOffsetsMm:number[];
};
export type RemoveEdgeProjectionCommand={
  kind:'remove-edge-projection';version:1;sourceSignature:string;
  projectionId:string;sourceSplitId:string;
};
export type DragEdgeProjectionGesture={
  version:1;sourceSignature:string;projectionId:string;sourceSplitId:string;
  handleId:string;target:{x:number;y:number};
};
export type EdgeProjectionAccepted={
  kind:'accepted';version:1;sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;selection:SelectedProfileSelection;
  profile:SelectedAnalyticProfile;
  previousCandidateId:string;nextCandidateId:string;
  projectionId:string;sourceSplitId:string;targetEdgeId:string;
  createdEntityIds:string[];changedConstraintIds:string[];
  handles:EdgeProjectionHandle[];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type EdgeProjectionDragged=EdgeProjectionAccepted&{
  gesture:{handleId:string;requested:{x:number;y:number};
    applied:{x:number;y:number};projectionDeviationMm:number};
};
export function createSelectedEdgeProjection(source:SketchDocument,
  selection:SelectedProfileSelection,command:CreateEdgeProjectionCommand):
  EdgeProjectionAccepted|EdgeProjectionRefusal;
export function inspectSelectedEdgeProjection(source:SketchDocument,
  selection:SelectedProfileSelection,projectionId:string,sourceSplitId:string):
  EdgeProjectionInspection|EdgeProjectionRefusal;
export function editSelectedEdgeProjection(source:SketchDocument,
  selection:SelectedProfileSelection,command:EditEdgeProjectionCommand):
  EdgeProjectionAccepted|EdgeProjectionRefusal;
export function dragSelectedEdgeProjection(source:SketchDocument,
  selection:SelectedProfileSelection,gesture:DragEdgeProjectionGesture):
  EdgeProjectionDragged|EdgeProjectionAccepted|EdgeProjectionRefusal;
export function removeSelectedEdgeProjection(source:SketchDocument,
  selection:SelectedProfileSelection,command:RemoveEdgeProjectionCommand):
  EdgeProjectionAccepted|EdgeProjectionRefusal;
