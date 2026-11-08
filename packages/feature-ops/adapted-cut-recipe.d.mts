import type {UndoHistory} from '@intuit3d/model/transactions';
import type {RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {CutRecipeCopySelection,CutRecipeCopyServices,CutRecipeSourceSelection,CutRecipeExtent}
  from './cut-recipe-copy.d.mts';
export declare const ADAPTED_RECIPE_FORMAT:'intuit3d.feature-ops.adapted-cut-recipe';
export declare const ADAPTED_RECIPE_VERSION:1;
export type AdaptedRecipeSelection=Omit<CutRecipeCopySelection,'format'|'version'> & Readonly<{
  format:typeof ADAPTED_RECIPE_FORMAT;version:1;
}>;
export type AdaptedTargetCut=Readonly<{
  sourceCutFeatureId:string;sourceSketchId:string;profileCandidateId:string;
  extent:CutRecipeExtent;
}>;
export type AdaptedRecipeRequest=AdaptedRecipeSelection&Readonly<{
  expectedSourceCuts:readonly CutRecipeSourceSelection[];
  targetCuts:readonly AdaptedTargetCut[];
  newCutFeatureIds:readonly string[];eventIds:readonly string[];
}>;
export type AdaptedRecipeInspection=Readonly<{
  format:typeof ADAPTED_RECIPE_FORMAT;version:1;kind:'adaptation_inspection';
  projectId:string;revision:number;documentFence:string;units:'mm';frame:'local_xy';
  sourceBodyId:string;targetBodyId:string;
  sourceCuts:readonly CutRecipeSourceSelection[];
  sourceWriterOrder:readonly string[];targetWriterOrder:readonly string[];
  targetAfterBodyWriterId:string;targetCutsMustBeExplicit:true;
  providerStatus:'pending_exact_provider';
  exactAuthority:false;independentInteroperability:false;
}>;
export type AdaptedRecipeResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;sourceBodyId:string;targetBodyId:string;
  copiedCuts:readonly (AdaptedTargetCut&Readonly<{
    cutFeatureId:string;targetBodyId:string;
    status:'pending_exact_provider'|'blocked_dependency';
  }>)[];
  sourceWriterOrder:readonly string[];
  targetWriterOrderBefore:readonly string[];
  targetWriterOrderAfter:readonly string[];
  eventIds:readonly string[];oneUndoFrame:true;
  sourceSketchSemantics:'explicit_per_cut_source_selection';
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';bodyId:string;sourceRevision:number;
    orderedCutFeatureIds:readonly string[];
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  }>;
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function inspectAdaptableCutRecipe(history:UndoHistory,
  request:AdaptedRecipeSelection,services:CutRecipeCopyServices):AdaptedRecipeInspection;
export declare function applyAdaptedCutRecipe(history:UndoHistory,
  request:AdaptedRecipeRequest,services:CutRecipeCopyServices):AdaptedRecipeResult;
