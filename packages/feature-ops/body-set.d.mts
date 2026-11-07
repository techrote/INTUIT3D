import type {UndoHistory} from '@intuit3d/model/transactions';
import type {RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {FeatureOpsServices} from './index.mjs';

export declare const BODY_SET_FORMAT:'intuit3d.feature-ops.body-set';
export declare const BODY_SET_VERSION:1;
export type BodySetCut=Readonly<{
  sourceSketchId:string;profileCandidateId:string;
  cutFeatureId:string;eventId:string;
}>;
export type BodySetEntry=Readonly<{
  sourceSketchId:string;profileCandidateId:string;
  extrudeFeatureId:string;outputBodyId:string;
  depthMm:number;eventId:string;
  cut:BodySetCut|null;
}>;
export type BodySetRequest=Readonly<{
  format:typeof BODY_SET_FORMAT;version:typeof BODY_SET_VERSION;
  expectedRevision:number;units:'mm';frame:'local_xy';
  bodies:readonly BodySetEntry[];
}>;
export type BodySetResult=Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  bodies:readonly Readonly<{
    sketchId:string;selectedProfileId:string;
    extrudeFeatureId:string;bodyId:string;
    cut:Readonly<{sketchId:string;selectedProfileId:string;cutFeatureId:string}>|null;
    status:'preview_only'|'pending_exact_provider';
    nativeHandoff:Readonly<{
      kind:'runtime_evaluation_required';cutFeatureId:string;bodyId:string;
      sourceRevision:number;compatibility:'not_claimed_ask_RUNTIME_provider';
      exactAuthority:false;independentInteroperability:false;
    }>|null;
  }>[];
  exactAuthority:false;independentInteroperability:false;
}>;
/** One atomic journal frame; no implicit body targeting or native exactness. */
export declare function authorProfileBodySet(
  history:UndoHistory,request:BodySetRequest,services:FeatureOpsServices
):BodySetResult;
