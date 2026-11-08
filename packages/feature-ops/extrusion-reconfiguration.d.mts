import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {FeatureOpsServices} from './index.mjs';

export declare const EXTRUSION_RECONFIG_FORMAT:
  'intuit3d.feature-ops.extrusion-reconfiguration';
export declare const EXTRUSION_RECONFIG_VERSION:1;

export type ExtrusionRevisionFence=Readonly<{
  sourceSketchId:string;depthMm:number;
}>;
export type ExtrusionReplacement=ExtrusionRevisionFence & Readonly<{
  /** Canonical SKETCH cycle selected and re-admitted at the current revision. */
  profileCandidateId:string;
}>;
export type ExtrusionReconfigurationRequest=Readonly<{
  format:typeof EXTRUSION_RECONFIG_FORMAT;
  version:typeof EXTRUSION_RECONFIG_VERSION;
  eventId:string;
  expectedRevision:number;
  units:'mm';
  frame:'local_xy';
  extrudeFeatureId:string;
  outputBodyId:string;
  from:ExtrusionRevisionFence;
  to:ExtrusionReplacement;
}>;

export declare function reconfigureProfileExtrusion(
  history:UndoHistory,
  request:ExtrusionReconfigurationRequest,
  services:FeatureOpsServices & Readonly<{
    /** Mandatory when the selected body has two or more ordered cuts. */
    cutChain?:{inspectBodyCutChain(document:UndoHistory['document'],bodyId:string):{
      status:string;projectId:string;revision:number;bodyWriterIds:readonly string[];
      eligibleAfterWriterId:string|null;
    }}
  }>
):Readonly<{
  kind:'committed';
  history:UndoHistory;
  report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  extrusionFeatureId:string;
  outputBodyId:string;
  previousSourceSketchId:string;
  sourceSketchId:string;
  previousDepthMm:number;
  depthMm:number;
  selectedProfileId:string;
  /** Cut retained its own source sketch; dependency rewired if needed. */
  reboundCutId:string|null;
  cutDependencies:readonly string[]|null;
  /** Dependency execution order, distinct from journal creation chronology. */
  orderedCutFeatureIds:readonly string[];
  /** Every cut whose SKETCH dependency was rebound; zero for a depth-only edit. */
  reboundCutIds:readonly string[];
  cutDependencyChanges:readonly Readonly<{
    cutFeatureId:string;
    previousDependencies:readonly string[];
    nextDependencies:readonly string[];
  }>[];
  status:'preview_only';
  nativeHandoff:null;
  exactAuthority:false;
  independentInteroperability:false;
}>;
