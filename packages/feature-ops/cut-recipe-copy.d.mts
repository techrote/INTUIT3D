import type {UndoHistory} from '@intuit3d/model/transactions';
import type {ProjectDocument} from '@intuit3d/model';
import type {RuntimeReport,WorkflowRuntime,WorkflowInvalidation}
  from '@intuit3d/workflow-runtime';
import type {SketchDocument,PlateProfile} from '@intuit3d/sketch';
import type {BodyCutChainInspection,BodyCutAppendPreview,BodyCutAppendRequest}
  from '@intuit3d/model/body-cut-chain';
export declare const CUT_RECIPE_COPY_FORMAT:'intuit3d.feature-ops.cut-recipe-copy';
export declare const CUT_RECIPE_COPY_VERSION:1;
export type CutRecipeExtent=Readonly<{kind:'through_all'}|{kind:'blind';depthMm:number}>;
export type CutRecipeSourceSelection=Readonly<{
  sourceCutFeatureId:string;sourceSketchId:string;profileCandidateId:string;
  extent:CutRecipeExtent;
}>;
export type CutRecipeCopySelection=Readonly<{
  format:typeof CUT_RECIPE_COPY_FORMAT;version:1;
  expectedProjectId:string;expectedRevision:number;expectedDocumentFence:string;
  units:'mm';frame:'local_xy';sourceBodyId:string;targetBodyId:string;
  sourceCutFeatureIds:readonly string[];targetAfterBodyWriterId:string;
}>;
export type CutRecipeCopyRequest=CutRecipeCopySelection&Readonly<{
  expectedSourceCuts:readonly CutRecipeSourceSelection[];
  newCutFeatureIds:readonly string[];eventIds:readonly string[];
}>;
export type CutRecipeCopyServices=Readonly<{
  model:{
    featuresOf(doc:ProjectDocument):readonly {id:string;kind:string;
      dependsOn:readonly string[];writeTargets:readonly string[];
      payload:Record<string,any>}[];
    serializeProject(doc:ProjectDocument):string;
  };
  runtime:Pick<WorkflowRuntime,'inspect'|'commit'|'diff'>;
  sketch:{validateSketch(source:unknown):SketchDocument};
  discovery:{
    discoverPlateProfiles(source:SketchDocument):{
      status:string;candidates?:readonly {id:string}[]};
    admitDiscoveredPlateProfile(source:SketchDocument,proposal:unknown,candidateId:string):PlateProfile;
  };
  cutChain:{
    inspectBodyCutChain(doc:ProjectDocument,bodyId:string):BodyCutChainInspection;
    previewBodyCutAppend(doc:ProjectDocument,request:BodyCutAppendRequest):BodyCutAppendPreview;
  };
}>;
export type CutRecipeCopyInspection=Readonly<{
  format:typeof CUT_RECIPE_COPY_FORMAT;version:1;kind:'copy_inspection';
  projectId:string;revision:number;documentFence:string;units:'mm';frame:'local_xy';
  sourceBodyId:string;targetBodyId:string;
  sourceWriterOrder:readonly string[];targetWriterOrder:readonly string[];
  targetAfterBodyWriterId:string;sourceCuts:readonly CutRecipeSourceSelection[];
  copySemantics:'shared_authoritative_sketch_sources';
  providerStatus:'pending_exact_provider';
  exactAuthority:false;independentInteroperability:false;
}>;
export type CutRecipeCopyResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  copiedCuts:readonly {
    sourceCutFeatureId:string;cutFeatureId:string;targetBodyId:string;
    status:'pending_exact_provider'|'blocked_dependency';extent:CutRecipeExtent;
  }[];
  sourceBodyId:string;targetBodyId:string;
  targetWriterOrderBefore:readonly string[];
  targetWriterOrderAfter:readonly string[];eventIds:readonly string[];
  oneUndoFrame:true;
  copySemantics:'shared_authoritative_sketch_sources';
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';bodyId:string;sourceRevision:number;
    orderedCutFeatureIds:readonly string[];
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  }>;
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function inspectCutRecipeCopy(history:UndoHistory,
  request:CutRecipeCopySelection,services:CutRecipeCopyServices):CutRecipeCopyInspection;
export declare function copyCutRecipeToBody(history:UndoHistory,
  request:CutRecipeCopyRequest,services:CutRecipeCopyServices):CutRecipeCopyResult;