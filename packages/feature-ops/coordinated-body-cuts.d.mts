import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument,PlateProfile} from '@intuit3d/sketch';
import type {
  BodyCutAppendRequest,BodyCutAppendPreview,BodyCutChainInspection,
  BodyCutExtentEditRequest,BodyCutExtentEditPreview,BodyCutExtentInspection
} from '@intuit3d/model/body-cut-chain';
import type {OrderedCutExtent} from './ordered-cut.d.mts';

export declare const COORDINATED_CUT_FORMAT:'intuit3d.feature-ops.coordinated-body-cuts';
export declare const COORDINATED_CUT_VERSION:1;

/** All target bodies use the same admitted SKETCH source in local_xy mm.
 * There is no inferred mating transform, native Boolean or STEP status. */
export type CoordinatedCutSelection=Readonly<{
  cutFeatureId:string;targetBodyId:string;afterBodyWriterId:string;
  eventId:string;extent:OrderedCutExtent;
}>;
export type CoordinatedCutEditSelection=Readonly<{
  cutFeatureId:string;targetBodyId:string;afterBodyWriterId:string;
  eventId:string;fromExtent:OrderedCutExtent;toExtent:OrderedCutExtent;
}>;
export type CoordinatedCutRequest=Readonly<{
  format:typeof COORDINATED_CUT_FORMAT;version:typeof COORDINATED_CUT_VERSION;
  expectedProjectId:string;expectedRevision:number;
  units:'mm';frame:'local_xy';sourceSketchId:string;profileCandidateId:string;
  cuts:readonly CoordinatedCutSelection[];
}>;
export type CoordinatedCutEditRequest=Omit<CoordinatedCutRequest,'cuts'>&Readonly<{
  cuts:readonly CoordinatedCutEditSelection[];
}>;
export type CoordinatedCutServices=Readonly<{
  runtime:Pick<WorkflowRuntime,'commit'|'inspect'|'diff'>;
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];writeTargets:readonly string[];
    payload:Record<string,unknown>
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
    inspectBodyCutChain(document:UndoHistory['document'],bodyId:string):BodyCutChainInspection;
    previewBodyCutAppend(document:UndoHistory['document'],
      request:BodyCutAppendRequest):BodyCutAppendPreview;
    inspectBodyCutExtent(document:UndoHistory['document'],
      cutFeatureId:string,targetBodyId:string):BodyCutExtentInspection;
    previewBodyCutExtentEdit(document:UndoHistory['document'],
      request:BodyCutExtentEditRequest):BodyCutExtentEditPreview;
  };
}>;
export type CoordinatedCutResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  sourceSketchId:string;selectedProfileId:string;semanticStatus:'ready';
  cuts:readonly Readonly<{
    cutFeatureId:string;targetBodyId:string;afterBodyWriterId:string;
    extent:OrderedCutExtent;status:'pending_exact_provider'|'blocked_dependency';
    nativeHandoff:Readonly<{
      kind:'runtime_evaluation_required';cutFeatureId:string;bodyId:string;
      sourceRevision:number;compatibility:'not_claimed_ask_RUNTIME_provider';
      exactAuthority:false;independentInteroperability:false
    }>
  }>[];
  exactAuthority:false;independentInteroperability:false;
}>;
export type CoordinatedCutEditResult=CoordinatedCutResult&Readonly<{
  previousExtents:readonly {cutFeatureId:string;extent:OrderedCutExtent}[];
}>;
/** One preview-validated RUNTIME transaction with 2–8 body-targeted cuts. */
export declare function authorCoordinatedBodyCuts(
  history:UndoHistory,request:CoordinatedCutRequest,services:CoordinatedCutServices
):CoordinatedCutResult;
/** Two or more retrospective extent edits, one undo frame, preserved body IDs. */
export declare function reconfigureCoordinatedBodyCutExtents(
  history:UndoHistory,request:CoordinatedCutEditRequest,services:CoordinatedCutServices
):CoordinatedCutEditResult;
