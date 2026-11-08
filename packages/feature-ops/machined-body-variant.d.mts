import type {UndoHistory} from '@intuit3d/model/transactions';
import type {RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {CutRecipeCopyServices,CutRecipeSourceSelection,CutRecipeExtent}
  from './cut-recipe-copy.d.mts';

export declare const MACHINED_VARIANT_FORMAT:'intuit3d.feature-ops.machined-body-variant';
export declare const MACHINED_VARIANT_VERSION:1;

export type MachinedBodyVariantSelection=Readonly<{
  format:typeof MACHINED_VARIANT_FORMAT;version:1;
  expectedProjectId:string;expectedRevision:number;expectedDocumentFence:string;
  units:'mm';frame:'local_xy';
  sourceBodyId:string;sourceCutFeatureIds:readonly string[];
  baseSketchId:string;baseProfileCandidateId:string;depthMm:number;
  newExtrudeFeatureId:string;newBodyId:string;newExtrudeEventId:string;
}>;
export type VariantTargetCut=Readonly<{
  sourceCutFeatureId:string;sourceSketchId:string;profileCandidateId:string;
  extent:CutRecipeExtent;
}>;
export type MachinedBodyVariantRequest=MachinedBodyVariantSelection&Readonly<{
  expectedSourceCuts:readonly CutRecipeSourceSelection[];
  targetCuts:readonly VariantTargetCut[];
  newCutFeatureIds:readonly string[];cutEventIds:readonly string[];
}>;
export type MachinedBodyVariantInspection=Readonly<{
  format:typeof MACHINED_VARIANT_FORMAT;version:1;kind:'variant_inspection';
  projectId:string;revision:number;documentFence:string;
  units:'mm';frame:'local_xy';sourceBodyId:string;newBodyId:string;
  baseSketchId:string;selectedBaseProfileId:string;depthMm:number;
  sourceWriterOrder:readonly string[];sourceCuts:readonly CutRecipeSourceSelection[];
  targetCutsMustBeExplicit:true;atomicBodyAndRecipe:true;
  providerStatus:'pending_exact_provider';
  exactAuthority:false;independentInteroperability:false;
}>;
export type MachinedBodyVariantResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  sourceBodyId:string;newBodyId:string;newExtrudeFeatureId:string;
  baseSketchId:string;depthMm:number;
  copiedCuts:readonly Readonly<{
    sourceCutFeatureId:string;cutFeatureId:string;sourceSketchId:string;
    extent:CutRecipeExtent;targetBodyId:string;
    status:'pending_exact_provider'|'blocked_dependency';
  }>[];
  sourceWriterOrder:readonly string[];newBodyWriterOrder:readonly string[];
  sourceSketchSemantics:'shared_source_profiles'|'explicit_per_cut_source_selection';
  eventIds:readonly string[];oneUndoFrame:true;
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';bodyId:string;sourceRevision:number;
    orderedCutFeatureIds:readonly string[];
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  }>;
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function inspectMachinedBodyVariant(
  history:UndoHistory,request:MachinedBodyVariantSelection,
  services:CutRecipeCopyServices
):MachinedBodyVariantInspection;
export declare function createMachinedBodyVariant(
  history:UndoHistory,request:MachinedBodyVariantRequest,
  services:CutRecipeCopyServices
):MachinedBodyVariantResult;
