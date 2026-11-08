import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {BodyCutChainInspection} from '@intuit3d/model/body-cut-chain';
import type {BodyCutSwapRequest,BodyCutSwapPreview} from '@intuit3d/model/body-cut-order';
import type {SketchDocument,PlateProfile} from '@intuit3d/sketch';
import type {OrderedCutExtent} from './ordered-cut.d.mts';

export declare const ORDERED_CUT_MOVE_FORMAT:'intuit3d.feature-ops.ordered-cut-move';
export declare const ORDERED_CUT_MOVE_VERSION:1;
export type CutMoveSelection=Readonly<{
  cutFeatureId:string;sourceSketchId:string;profileCandidateId:string;
  extent:OrderedCutExtent;
}>;
export type CutMoveInspectorRequest=Readonly<{
  format:typeof ORDERED_CUT_MOVE_FORMAT;version:typeof ORDERED_CUT_MOVE_VERSION;
  expectedProjectId:string;expectedRevision:number;units:'mm';frame:'local_xy';
  targetBodyId:string;
}>;
export type OrderedBodyCutMoveInspection=Readonly<{
  format:typeof ORDERED_CUT_MOVE_FORMAT;version:1;kind:'selection';
  projectId:string;revision:number;bodyId:string;
  writerOrder:readonly string[];cutSelections:readonly CutMoveSelection[];
  dropAfterWriterIds:readonly string[];
  exactAuthority:false;independentInteroperability:false;
}>;
export type CutMoveRequest=CutMoveInspectorRequest&Readonly<{
  cutFeatureId:string;dropAfterWriterId:string;
  expectedWriterOrder:readonly string[];
  cutSelections:readonly CutMoveSelection[];
  eventIdPrefix:string;
}>;
export type CutMoveServices=Readonly<{
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];
    writeTargets:readonly string[];payload:Record<string,unknown>;
  }[]};
  runtime:Pick<WorkflowRuntime,'inspect'|'diff'|'commit'>;
  sketch:{validateSketch(source:unknown):SketchDocument};
  discovery:{
    discoverPlateProfiles(source:SketchDocument):{
      status:string;candidates?:readonly {id:string}[];
    };
    admitDiscoveredPlateProfile(source:SketchDocument,proposal:unknown,candidateId:string):PlateProfile;
  };
  cutChain:{
    inspectBodyCutChain(document:UndoHistory['document'],bodyId:string):BodyCutChainInspection;
  };
  cutOrder:{
    previewBodyCutSwap(document:UndoHistory['document'],request:BodyCutSwapRequest):BodyCutSwapPreview;
  };
}>;
export type CutMoveResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  writerOrderBefore:readonly string[];writerOrderAfter:readonly string[];
  movedCutFeatureId:string;dropAfterWriterId:string;
  swapSteps:readonly Readonly<{
    firstCutFeatureId:string;secondCutFeatureId:string;eventIds:readonly string[];
  }>[];
  eventIds:readonly string[];
  statuses:readonly Readonly<{cutFeatureId:string;
    status:'pending_exact_provider'|'blocked_dependency'}>[];
  authoredTimelineChanged:false;
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';bodyId:string;sourceRevision:number;
    orderedWriterIds:readonly string[];compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  }>;
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function inspectOrderedBodyCutMove(
  history:UndoHistory,request:CutMoveInspectorRequest,services:CutMoveServices
):OrderedBodyCutMoveInspection;
export declare function moveOrderedBodyCut(
  history:UndoHistory,request:CutMoveRequest,services:CutMoveServices
):CutMoveResult;
