import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument,PlateProfile} from '@intuit3d/sketch';
import type {
  BodyCutChainInspection,BodyCutExtentInspection,BodyCutExtentEditPreview,
  BodyCutExtentEditRequest
} from '@intuit3d/model/body-cut-chain';
import type {OrderedCutExtent} from './ordered-cut.d.mts';

export declare const ORDERED_CUT_EXTENT_EDIT_FORMAT:
  'intuit3d.feature-ops.ordered-cut-extent-edit';
export declare const ORDERED_CUT_EXTENT_EDIT_VERSION:1;

/** Expected-value inspector fence; no implicit body or profile re-selection. */
export type OrderedCutExtentEditRequest=Readonly<{
  format:typeof ORDERED_CUT_EXTENT_EDIT_FORMAT;
  version:typeof ORDERED_CUT_EXTENT_EDIT_VERSION;
  expectedProjectId:string;
  expectedRevision:number;
  eventId:string;
  units:'mm';
  frame:'local_xy';
  cutFeatureId:string;
  targetBodyId:string;
  from:Readonly<{
    afterBodyWriterId:string;
    sourceSketchId:string;
    profileCandidateId:string;
    extent:OrderedCutExtent;
  }>;
  toExtent:OrderedCutExtent;
}>;

export type OrderedCutExtentEditServices=Readonly<{
  runtime:Pick<WorkflowRuntime,'commit'|'inspect'|'diff'>;
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];writeTargets:readonly string[];
    payload:Record<string,unknown>;
  }[]};
  sketch:{validateSketch(source:unknown):SketchDocument};
  discovery:{
    discoverPlateProfiles(source:SketchDocument):{
      status:string;candidates?:readonly {id:string}[]
    };
    admitDiscoveredPlateProfile(
      source:SketchDocument,proposal:unknown,candidateId:string
    ):PlateProfile;
  };
  cutChain:{
    inspectBodyCutChain(
      document:UndoHistory['document'],bodyId:string
    ):BodyCutChainInspection;
    inspectBodyCutExtent(
      document:UndoHistory['document'],cutId:string,bodyId:string
    ):BodyCutExtentInspection;
    previewBodyCutExtentEdit(
      document:UndoHistory['document'],request:BodyCutExtentEditRequest
    ):BodyCutExtentEditPreview;
  };
}>;

export type OrderedCutExtentEditResult=Readonly<{
  kind:'committed';
  history:UndoHistory;
  report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  semanticIds:Readonly<{
    cutId:string;bodyId:string;sketchId:string;predecessorId:string;
  }>;
  previousExtent:OrderedCutExtent;
  nextExtent:OrderedCutExtent;
  semanticStatus:'ready';
  status:'pending_exact_provider'|'blocked_dependency';
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';
    cutFeatureId:string;bodyId:string;sourceRevision:number;
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  }>;
  exactAuthority:false;
  independentInteroperability:false;
}>;

export declare function reconfigureOrderedCutExtent(
  history:UndoHistory,
  request:OrderedCutExtentEditRequest,
  services:OrderedCutExtentEditServices
):OrderedCutExtentEditResult;
