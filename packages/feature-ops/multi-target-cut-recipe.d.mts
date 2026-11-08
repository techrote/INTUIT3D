import type {UndoHistory} from '@intuit3d/model/transactions';
import type {RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {CutRecipeCopyServices,CutRecipeSourceSelection,CutRecipeExtent}
  from './cut-recipe-copy.d.mts';

export declare const MULTI_TARGET_CUT_RECIPE_FORMAT:
  'intuit3d.feature-ops.multi-target-cut-recipe';
export declare const MULTI_TARGET_CUT_RECIPE_VERSION:1;
export type MultiTargetRecipeTarget=Readonly<{
  targetBodyId:string;targetAfterBodyWriterId:string;
}>;
export type MultiTargetRecipeSelection=Readonly<{
  format:typeof MULTI_TARGET_CUT_RECIPE_FORMAT;version:1;
  expectedProjectId:string;expectedRevision:number;expectedDocumentFence:string;
  units:'mm';frame:'local_xy';sourceBodyId:string;
  sourceCutFeatureIds:readonly string[];
  targets:readonly MultiTargetRecipeTarget[];
}>;
export type MultiTargetAdaptedCut=Readonly<{
  sourceCutFeatureId:string;sourceSketchId:string;profileCandidateId:string;
  extent:CutRecipeExtent;
}>;
export type MultiTargetRecipePlan=Readonly<{
  mode:'copy';targetBodyId:string;targetAfterBodyWriterId:string;
  newCutFeatureIds:readonly string[];eventIds:readonly string[];
}>|Readonly<{
  mode:'adapt';targetBodyId:string;targetAfterBodyWriterId:string;
  targetCuts:readonly MultiTargetAdaptedCut[];
  newCutFeatureIds:readonly string[];eventIds:readonly string[];
}>;
export type MultiTargetRecipeRequest=MultiTargetRecipeSelection&Readonly<{
  expectedSourceCuts:readonly CutRecipeSourceSelection[];
  targetPlans:readonly MultiTargetRecipePlan[];
}>;
export type MultiTargetRecipeInspection=Readonly<{
  kind:'multi_target_recipe_inspection';
  format:typeof MULTI_TARGET_CUT_RECIPE_FORMAT;version:1;
  projectId:string;revision:number;documentFence:string;
  units:'mm';frame:'local_xy';sourceBodyId:string;
  sourceWriterOrder:readonly string[];
  sourceCuts:readonly CutRecipeSourceSelection[];
  targets:readonly (MultiTargetRecipeTarget&Readonly<{
    targetWriterOrder:readonly string[];
  }>)[];
  totalNewCuts:number;
  providerStatus:'pending_exact_provider';
  exactAuthority:false;independentInteroperability:false;
}>;
export type MultiTargetRecipeResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;sourceBodyId:string;
  sourceWriterOrder:readonly string[];
  destinations:readonly Readonly<{
    mode:'copy'|'adapt';targetBodyId:string;
    targetWriterOrderBefore:readonly string[];
    targetWriterOrderAfter:readonly string[];
    copiedCuts:readonly Readonly<{
      sourceCutFeatureId:string;cutFeatureId:string;targetBodyId:string;
      status:'pending_exact_provider'|'blocked_dependency';
    }>[];
  }>[];
  allEventIds:readonly string[];oneUndoFrame:true;
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';sourceRevision:number;
    bodyIds:readonly string[];
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  }>;
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function inspectMultiTargetCutRecipe(
  history:UndoHistory,request:MultiTargetRecipeSelection,
  services:CutRecipeCopyServices):MultiTargetRecipeInspection;
export declare function applyMultiTargetCutRecipe(
  history:UndoHistory,request:MultiTargetRecipeRequest,
  services:CutRecipeCopyServices):MultiTargetRecipeResult;
