import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument,PlateProfile} from '@intuit3d/sketch';
import type {CutProfileSourceBatchPreview,CutProfileSourceBatchRequest}
  from '@intuit3d/model/cut-profile-source';
export declare const SHARED_CUT_SOURCE_FORMAT:
  'intuit3d.feature-ops.shared-cut-source-retrofit';
export declare const SHARED_CUT_SOURCE_VERSION:1;
export type SharedCutSourceEdit=Readonly<{
  eventId:string;cutFeatureId:string;targetBodyId:string;
  expectedSourceSketchId:string;expectedProfileCandidateId:string;
  sourceSketchId:string;profileCandidateId:string;
  releasePreviousSketchDependency:boolean;
}>;
export type SharedCutSourceRequest=Readonly<{
  format:typeof SHARED_CUT_SOURCE_FORMAT;version:typeof SHARED_CUT_SOURCE_VERSION;
  expectedProjectId:string;expectedRevision:number;units:'mm';frame:'local_xy';
  edits:readonly SharedCutSourceEdit[];
  retireSketch?:Readonly<{eventId:string;featureId:string}>;
}>;
export type SharedCutSourceServices=Readonly<{
  runtime:Pick<WorkflowRuntime,'commit'|'inspect'|'diff'>;
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];
    writeTargets:readonly string[];payload:Record<string,unknown>}[]};
  sketch:{validateSketch(source:unknown):SketchDocument};
  discovery:{discoverPlateProfiles(source:SketchDocument):{
    status:string;candidates?:readonly {id:string}[]};
    admitDiscoveredPlateProfile(source:SketchDocument,proposal:unknown,candidateId:string):PlateProfile};
  cutSource:{previewCutProfileSourceBatch(
    document:UndoHistory['document'],request:CutProfileSourceBatchRequest
  ):CutProfileSourceBatchPreview};
}>;
export declare function replaceSharedCutProfiles(
  history:UndoHistory,request:SharedCutSourceRequest,services:SharedCutSourceServices
):Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;editedCutIds:readonly string[];
  retiredSketchId:string|null;semanticStatus:'ready';
  cuts:readonly Readonly<{
    cutFeatureId:string;targetBodyId:string;sourceSketchId:string;
    profileCandidateId:string;status:'pending_exact_provider'|'blocked_dependency';
    nativeHandoff:{kind:'runtime_evaluation_required';cutFeatureId:string;
      bodyId:string;sourceRevision:number;compatibility:'not_claimed_ask_RUNTIME_provider';
      exactAuthority:false;independentInteroperability:false};
  }>[];
  exactAuthority:false;independentInteroperability:false;
}>;
