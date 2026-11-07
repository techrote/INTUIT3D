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
  services:FeatureOpsServices
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
  status:'preview_only';
  nativeHandoff:null;
  exactAuthority:false;
  independentInteroperability:false;
}>;
