import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {BodyCutChainInspection} from '@intuit3d/model/body-cut-chain';
import type {BodyCutSwapRequest,BodyCutSwapPreview} from '@intuit3d/model/body-cut-order';
import type {SketchDocument,PlateProfile} from '@intuit3d/sketch';
import type {OrderedCutExtent} from './ordered-cut.d.mts';

export declare const ORDERED_CUT_SWAP_FORMAT:'intuit3d.feature-ops.ordered-cut-swap';
export declare const ORDERED_CUT_SWAP_VERSION:1;
export type CutSwapSelection=Readonly<{
  cutFeatureId:string;sourceSketchId:string;profileCandidateId:string;
  extent:OrderedCutExtent;
}>;
export type OrderedCutSwapRequest=Readonly<{
  format:typeof ORDERED_CUT_SWAP_FORMAT;version:typeof ORDERED_CUT_SWAP_VERSION;
  expectedProjectId:string;expectedRevision:number;
  units:'mm';frame:'local_xy';targetBodyId:string;
  firstCutFeatureId:string;secondCutFeatureId:string;
  /** Current DEPENDENCY order, not journal chronology. */
  expectedWriterOrder:readonly string[];
  cutSelections:readonly [CutSwapSelection,CutSwapSelection];
  /** Two fresh event IDs for a terminal swap; three for a nonterminal swap. */
  eventIds:readonly string[];
}>;
export type OrderedCutSwapServices=Readonly<{
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];
    writeTargets:readonly string[];payload:Record<string,unknown>;
  }[]};
  runtime:Pick<WorkflowRuntime,'inspect'|'diff'>;
  sketch:{validateSketch(source:unknown):SketchDocument};
  discovery:{
    discoverPlateProfiles(source:SketchDocument):{
      status:string;candidates?:readonly {id:string}[];
    };
    admitDiscoveredPlateProfile(
      source:SketchDocument,proposal:unknown,candidateId:string
    ):PlateProfile;
  };
  cutChain:{inspectBodyCutChain(document:UndoHistory['document'],bodyId:string):BodyCutChainInspection};
  cutOrder:{
    previewBodyCutSwap(document:UndoHistory['document'],request:BodyCutSwapRequest):BodyCutSwapPreview;
    commitUndoableBodyCutSwap(history:UndoHistory,request:BodyCutSwapRequest):UndoHistory;
  };
}>;
export type OrderedCutSwapResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  writerOrderBefore:readonly string[];writerOrderAfter:readonly string[];
  structuralInvalidation:BodyCutSwapPreview['invalidation'];
  authoredTimelineChanged:false;
  semanticIds:Readonly<{bodyId:string;firstCutId:string;secondCutId:string}>;
  statuses:readonly Readonly<{
    cutFeatureId:string;status:'pending_exact_provider'|'blocked_dependency';
  }>[];
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';bodyId:string;
    fromRevision:number;sourceRevision:number;orderedWriterIds:readonly string[];
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  }>;
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function swapOrderedBodyCuts(
  history:UndoHistory,request:OrderedCutSwapRequest,services:OrderedCutSwapServices
):OrderedCutSwapResult;