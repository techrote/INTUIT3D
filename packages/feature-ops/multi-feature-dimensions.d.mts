import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument,PlateProfile} from '@intuit3d/sketch';

export declare const MULTI_FEATURE_DIMENSIONS_FORMAT: 'intuit3d.feature-ops.multi-feature-dimensions';
export declare const MULTI_FEATURE_DIMENSIONS_VERSION: 1;

export type FeatureDimensionExtent = Readonly<
  {kind:'through_all'} | {kind:'blind';depthMm:number}>;
export type ExtrusionDimensionEdit = Readonly<{
  kind:'extrusion_depth';
  eventId:string;
  extrudeFeatureId:string;
  targetBodyId:string;
  sourceSketchId:string;
  /** Canonical selected SKETCH cycle identity, re-admitted at the source revision. */
  profileCandidateId:string;
  fromDepthMm:number;
  toDepthMm:number;
}>;
export type OrderedCutDimensionEdit = Readonly<{
  kind:'cut_extent';
  eventId:string;
  cutFeatureId:string;
  targetBodyId:string;
  afterBodyWriterId:string;
  sourceSketchId:string;
  profileCandidateId:string;
  fromExtent:FeatureDimensionExtent;
  toExtent:FeatureDimensionExtent;
}>;
export type MultiFeatureDimensionsRequest = Readonly<{
  format:typeof MULTI_FEATURE_DIMENSIONS_FORMAT;
  version:typeof MULTI_FEATURE_DIMENSIONS_VERSION;
  expectedProjectId:string;
  expectedRevision:number;
  units:'mm';
  frame:'local_xy';
  /** 2-16 distinct named feature targets; all preflighted before one commit. */
  edits:readonly (ExtrusionDimensionEdit|OrderedCutDimensionEdit)[];
}>;
export type MultiFeatureDimensionsServices = Readonly<{
  runtime:Pick<WorkflowRuntime,'commit'|'inspect'|'diff'>;
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];
    writeTargets:readonly string[];payload:Record<string,unknown>
  }[]};
  sketch:{validateSketch(source:unknown):SketchDocument};
  discovery:{
    discoverPlateProfiles(source:SketchDocument):{
      status:string;candidates?:readonly {id:string}[]};
    admitDiscoveredPlateProfile(source:SketchDocument,proposal:unknown,candidateId:string):PlateProfile
  };
  cutChain:{
    inspectBodyCutChain(document:UndoHistory['document'],bodyId:string):{
      status:string;projectId:string;revision:number;bodyWriterIds:readonly string[]};
    inspectBodyCutExtent(document:UndoHistory['document'],cutId:string,bodyId:string):{
      semanticStatus:string;projectId:string;revision:number;extent:FeatureDimensionExtent};
    previewBodyCutExtentEdit(document:UndoHistory['document'],request:unknown):{
      semanticStatus:string;event:unknown}
  };
}>;
export declare function editMultipleBodyDimensions(
  history:UndoHistory,
  request:MultiFeatureDimensionsRequest,
  services:MultiFeatureDimensionsServices
):Readonly<{
  kind:'committed';
  history:UndoHistory;
  report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  statuses:readonly {featureId:string;bodyId:string;status:string}[];
  editedFeatureIds:readonly string[];
  undoFramesAdded:1;
  nativeHandoffs:readonly {
    kind:'runtime_evaluation_required';
    cutFeatureId:string;bodyId:string;sourceRevision:number;
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false
  }[];
  exactAuthority:false;independentInteroperability:false
}>;


/** Read-only authoritative source selection for a multi-row Dimensions inspector. */
export type FeatureDimensionSelectionRequest = Readonly<{
  expectedProjectId:string;expectedRevision:number;
  selections:readonly Readonly<{featureId:string;targetBodyId:string}>[];
}>;
export type FeatureDimensionSelectionRow = Readonly<{
  kind:'extrusion_depth';featureId:string;targetBodyId:string;
  sourceSketchId:string;profileCandidateId:string;
  currentDepthMm:number;status:'preview_only';
} | {
  kind:'cut_extent';featureId:string;targetBodyId:string;
  afterBodyWriterId:string;sourceSketchId:string;profileCandidateId:string;
  currentExtent:FeatureDimensionExtent;
  status:'pending_exact_provider'|'blocked_dependency';
}>;
export type FeatureDimensionSelectionSnapshot = Readonly<{
  kind:'editable_dimension_selection';
  format:typeof MULTI_FEATURE_DIMENSIONS_FORMAT;
  version:typeof MULTI_FEATURE_DIMENSIONS_VERSION;
  expectedProjectId:string;expectedRevision:number;
  units:'mm';frame:'local_xy';
  rows:readonly FeatureDimensionSelectionRow[];
  exactAuthority:false;independentInteroperability:false;
}>;
export type ProposedFeatureDimensionChange = Readonly<
  {featureId:string;eventId:string;toDepthMm:number} |
  {featureId:string;eventId:string;toExtent:FeatureDimensionExtent}
>;
/** Inspect only; returns one immutable-style value snapshot, not an authority token. */
export declare function inspectSelectedFeatureDimensions(
  history:UndoHistory,request:FeatureDimensionSelectionRequest,
  services:MultiFeatureDimensionsServices
):FeatureDimensionSelectionSnapshot;
/** Build full expected-value fences. editMultipleBodyDimensions re-admits the source. */
export declare function prepareSelectedFeatureDimensionEdits(
  snapshot:FeatureDimensionSelectionSnapshot,
  proposed:readonly ProposedFeatureDimensionChange[]
):MultiFeatureDimensionsRequest;
