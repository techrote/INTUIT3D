import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument,PlateProfile} from '@intuit3d/sketch';
import type {BodyCutChainInspection,BodyCutAppendPreview,BodyCutAppendRequest} from '@intuit3d/model/body-cut-chain';
export declare const ORDERED_CUT_FORMAT:'intuit3d.feature-ops.ordered-cut';
export declare const ORDERED_CUT_VERSION:1;
export type OrderedCutExtent=Readonly<{kind:'through_all'}>|Readonly<{kind:'blind';depthMm:number}>;
export type OrderedCutRequest=Readonly<{
  format:typeof ORDERED_CUT_FORMAT;version:typeof ORDERED_CUT_VERSION;
  expectedProjectId:string;expectedRevision:number;eventId:string;
  units:'mm';frame:'local_xy';sourceSketchId:string;profileCandidateId:string;
  afterBodyWriterId:string;targetBodyId:string;cutFeatureId:string;
  extent:OrderedCutExtent;
}>;
export type OrderedCutServices=Readonly<{
  runtime:Pick<WorkflowRuntime,'commit'|'inspect'|'diff'>;
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];writeTargets:readonly string[];
    payload:Record<string,unknown>}[]};
  sketch:{validateSketch(source:unknown):SketchDocument};
  discovery:{discoverPlateProfiles(source:SketchDocument):{
    status:string;candidates?:readonly {id:string}[]};
    admitDiscoveredPlateProfile(source:SketchDocument,proposal:unknown,candidateId:string):PlateProfile};
  cutChain:{inspectBodyCutChain(document:UndoHistory['document'],bodyId:string):BodyCutChainInspection;
    previewBodyCutAppend(document:UndoHistory['document'],request:BodyCutAppendRequest):BodyCutAppendPreview};
}>;
export type OrderedCutResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;invalidation:WorkflowInvalidation;
  semanticIds:{sketchId:string;afterId:string;cutId:string;bodyId:string};
  selectedProfileId:string;semanticStatus:'ready';
  status:'pending_exact_provider'|'blocked_dependency';
  nativeHandoff:{kind:'runtime_evaluation_required';cutFeatureId:string;bodyId:string;
    sourceRevision:number;compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false};
  exactAuthority:false;independentInteroperability:false;
}>;
/** A single undoable, explicitly ordered cut; native evaluation remains pending. */
export declare function appendOrderedProfileCut(
  history:UndoHistory,request:OrderedCutRequest,services:OrderedCutServices
):OrderedCutResult;
