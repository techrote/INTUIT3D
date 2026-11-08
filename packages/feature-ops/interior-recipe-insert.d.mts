import type {UndoHistory} from '@intuit3d/model/transactions';
import type {RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {CutRecipeSourceSelection,CutRecipeCopyServices}
  from './cut-recipe-copy.d.mts';
import type {CutBlockPlacementServices,CutBlockPlacementInventory}
  from './cut-block-placement.d.mts';

export declare const INTERIOR_RECIPE_INSERT_FORMAT:
  'intuit3d.feature-ops.interior-recipe-insert';
export declare const INTERIOR_RECIPE_INSERT_VERSION:1;

/** IDs for the disposable copied block are allocated before inspection. */
export type InteriorRecipeInsertSelection=Readonly<{
  format:typeof INTERIOR_RECIPE_INSERT_FORMAT;version:1;
  expectedProjectId:string;expectedRevision:number;expectedDocumentFence:string;
  units:'mm';frame:'local_xy';
  sourceBodyId:string;sourceCutFeatureIds:readonly string[];
  targetBodyId:string;targetAfterBodyWriterId:string;
  newCutFeatureIds:readonly string[];copyEventIds:readonly string[];
}>;
export type InteriorRecipeInsertRequest=InteriorRecipeInsertSelection&Readonly<{
  expectedSourceCuts:readonly CutRecipeSourceSelection[];
  expectedTargetWriterOrder:readonly string[];
  insertAfterBodyWriterId:string;
  /** Exact requiredEventIds count from an available insertion destination. */
  moveEventIds:readonly string[];
}>;
export type InteriorRecipeInsertServices=
  CutRecipeCopyServices&CutBlockPlacementServices;
export type InteriorRecipeInsertInspection=Readonly<{
  kind:'interior_recipe_insertion_inspection';
  format:typeof INTERIOR_RECIPE_INSERT_FORMAT;version:1;
  projectId:string;revision:number;documentFence:string;
  sourceBodyId:string;targetBodyId:string;units:'mm';frame:'local_xy';
  sourceCuts:readonly CutRecipeSourceSelection[];
  sourceWriterOrder:readonly string[];targetWriterOrder:readonly string[];
  insertionDestinations:CutBlockPlacementInventory['destinations'];
  newCutFeatureIds:readonly string[];
  providerStatus:'pending_exact_provider';
  exactAuthority:false;independentInteroperability:false;
}>;
export type InteriorRecipeInsertResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  sourceBodyId:string;targetBodyId:string;
  insertedCuts:readonly Readonly<{
    sourceCutFeatureId:string;cutFeatureId:string;sourceSketchId:string;
    status:'pending_exact_provider'|'blocked_dependency';
  }>[];
  writerOrderBefore:readonly string[];writerOrderAfter:readonly string[];
  rewiredWriterIds:readonly string[];invalidatedBodyIds:readonly string[];
  eventIds:readonly string[];oneUndoFrame:true;
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';bodyId:string;sourceRevision:number;
    orderedWriterIds:readonly string[];
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  }>;
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function inspectInteriorRecipeInsertion(
  history:UndoHistory,request:InteriorRecipeInsertSelection,
  services:InteriorRecipeInsertServices):InteriorRecipeInsertInspection;
export declare function applyInteriorRecipeInsertion(
  history:UndoHistory,request:InteriorRecipeInsertRequest,
  services:InteriorRecipeInsertServices):InteriorRecipeInsertResult;
