import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument,PlateProfile} from '@intuit3d/sketch';
import type {CutProfileSourceBatchRequest,CutProfileSourceBatchPreview}
  from '@intuit3d/model/cut-profile-source';
import type {
  BodyCutChainInspection,BodyCutExtentInspection,
  BodyCutExtentEditRequest,BodyCutExtentEditPreview
} from '@intuit3d/model/body-cut-chain';
import type {OrderedCutExtent} from './ordered-cut.d.mts';
import type {TransactionPreview} from '@intuit3d/model/transactions';
import type {JournalEvent} from '@intuit3d/model';

export declare const COMPOUND_POCKET_FORMAT:
  'intuit3d.feature-ops.compound-pocket-reconfigure';
export declare const COMPOUND_POCKET_VERSION:1;

export type CompoundPocketEdit=Readonly<{
  sourceEventId:string;extentEventId:string;
  cutFeatureId:string;targetBodyId:string;afterBodyWriterId:string;
  expectedSourceSketchId:string;expectedProfileCandidateId:string;
  sourceSketchId:string;profileCandidateId:string;
  releasePreviousSketchDependency:boolean;
  fromExtent:OrderedCutExtent;toExtent:OrderedCutExtent;
}>;
export type CompoundPocketRequest=Readonly<{
  format:typeof COMPOUND_POCKET_FORMAT;
  version:typeof COMPOUND_POCKET_VERSION;
  expectedProjectId:string;expectedRevision:number;
  units:'mm';frame:'local_xy';
  edits:readonly CompoundPocketEdit[];
  retireSketch?:Readonly<{eventId:string;featureId:string}>;
}>;
export type CompoundPocketServices=Readonly<{
  runtime:Pick<WorkflowRuntime,'commit'|'inspect'|'diff'>;
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];
    writeTargets:readonly string[];payload:Record<string,unknown>;
  }[]};
  sketch:{validateSketch(source:unknown):SketchDocument};
  discovery:{
    discoverPlateProfiles(source:SketchDocument):{
      status:string;candidates?:readonly {id:string}[];
    };
    admitDiscoveredPlateProfile(
      source:SketchDocument,proposal:unknown,candidateId:string
    ):PlateProfile;
  };
  cutSource:{previewCutProfileSourceBatch(
    document:UndoHistory['document'],request:CutProfileSourceBatchRequest
  ):CutProfileSourceBatchPreview};
  cutChain:{
    inspectBodyCutChain(document:UndoHistory['document'],bodyId:string):
      BodyCutChainInspection;
    inspectBodyCutExtent(document:UndoHistory['document'],
      cutFeatureId:string,targetBodyId:string):BodyCutExtentInspection;
    previewBodyCutExtentEdit(document:UndoHistory['document'],
      request:BodyCutExtentEditRequest):BodyCutExtentEditPreview;
  };
  transactions:{previewTransaction(
    document:UndoHistory['document'],events:readonly JournalEvent[],
    expectedRevision:number):TransactionPreview};
}>;
export type CompoundPocketResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  editedCutIds:readonly string[];retiredSketchId:string|null;
  undoFramesAdded:1;semanticStatus:'ready';
  cuts:readonly Readonly<{
    cutFeatureId:string;targetBodyId:string;sourceSketchId:string;
    profileCandidateId:string;extent:OrderedCutExtent;
    status:'pending_exact_provider'|'blocked_dependency';
    nativeHandoff:Readonly<{
      kind:'runtime_evaluation_required';cutFeatureId:string;
      bodyId:string;sourceRevision:number;
      compatibility:'not_claimed_ask_RUNTIME_provider';
      exactAuthority:false;independentInteroperability:false;
    }>;
  }>[];
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function reconfigureCompoundPockets(
  history:UndoHistory,request:CompoundPocketRequest,
  services:CompoundPocketServices
):CompoundPocketResult;
