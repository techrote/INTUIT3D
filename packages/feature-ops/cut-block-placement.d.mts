import type {UndoHistory} from '@intuit3d/model/transactions';
import type {ProjectDocument} from '@intuit3d/model';
import type {BodyCutBlockRelocatePreview,BodyCutBlockDestinationsInventory,
  BodyCutBlockRelocateRequest,BodyCutBlockDestinationsRequest}
  from '@intuit3d/model/body-cut-block-relocate';
import type {RuntimeReport,WorkflowRuntime,WorkflowInvalidation}
  from '@intuit3d/workflow-runtime';

export declare const CUT_BLOCK_PLACEMENT_FORMAT:'intuit3d.feature-ops.cut-block-placement';
export declare const CUT_BLOCK_PLACEMENT_VERSION:1;
export type CutBlockPlacementSelection=Readonly<{
  format:typeof CUT_BLOCK_PLACEMENT_FORMAT;version:1;
  expectedProjectId:string;expectedRevision:number;expectedDocumentFence:string;
  units:'mm';frame:'local_xy';targetBodyId:string;cutFeatureIds:readonly string[];
}>;
export type CutBlockPlacementInspectRequest=CutBlockPlacementSelection&Readonly<{
  offset:number;limit:number;
}>;
export type CutBlockSelection=Readonly<{
  cutFeatureId:string;sourceSketchId:string;profileCandidateId:string;
  extent:Readonly<{kind:'through_all'}|{kind:'blind';depthMm:number}>;
}>;
export type CutBlockPlacementMoveRequest=CutBlockPlacementSelection&Readonly<{
  afterBodyWriterId:string;expectedWriterOrder:readonly string[];
  expectedCutSelections:readonly CutBlockSelection[];eventIds:readonly string[];
}>;
export type CutBlockPlacementServices=Readonly<{
  model:{
    featuresOf(doc:ProjectDocument):readonly {id:string;kind:string;
      writeTargets:readonly string[];payload:Record<string,any>}[];
    serializeProject(doc:ProjectDocument):string;
  };
  runtime:Pick<WorkflowRuntime,'inspect'|'diff'>;
  block:{
    inspectBodyCutBlockDestinations(doc:ProjectDocument,req:BodyCutBlockDestinationsRequest):
      BodyCutBlockDestinationsInventory;
    previewBodyCutBlockRelocate(doc:ProjectDocument,req:BodyCutBlockRelocateRequest):
      BodyCutBlockRelocatePreview;
    commitUndoableBodyCutBlockRelocate(history:UndoHistory,req:BodyCutBlockRelocateRequest):UndoHistory;
  };
}>;
export type CutBlockPlacementInventory=Readonly<{
  format:typeof CUT_BLOCK_PLACEMENT_FORMAT;version:1;kind:'placement_inventory';
  projectId:string;revision:number;documentFence:string;
  units:'mm';frame:'local_xy';targetBodyId:string;
  cutFeatureIds:readonly string[];cutSelections:readonly CutBlockSelection[];
  writerOrder:readonly string[];
  destinations:BodyCutBlockDestinationsInventory['destinations'];
  totalDestinations:number;offset:number;limit:number;nextOffset:number|null;
  exactAuthority:false;independentInteroperability:false;
}>;
export type CutBlockPlacementResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;invalidation:WorkflowInvalidation;
  writerOrderBefore:readonly string[];writerOrderAfter:readonly string[];
  movedCutIds:readonly string[];rewiredWriterIds:readonly string[];
  invalidatedBodyIds:readonly string[];eventIds:readonly string[];
  statuses:readonly {cutFeatureId:string;status:string}[];
  authoredTimelineChanged:false;
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';bodyId:string;sourceRevision:number;
    orderedWriterIds:readonly string[];compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  }>;
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function inspectCutBlockPlacement(
  history:UndoHistory,request:CutBlockPlacementInspectRequest,
  services:CutBlockPlacementServices
):CutBlockPlacementInventory;
export declare function moveCutBlock(
  history:UndoHistory,request:CutBlockPlacementMoveRequest,
  services:CutBlockPlacementServices
):CutBlockPlacementResult;
