import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {FeatureOpsServices} from './index.mjs';

export declare const CUT_REASSIGN_FORMAT: 'intuit3d.feature-ops.cut-reassignment';
export declare const CUT_REASSIGN_VERSION: 1;

/** Explicit former identity and target; neither body nor sketch is inferred. */
export type CutEndpoint = Readonly<{
  extrudeFeatureId:string;
  bodyId:string;
  sourceSketchId:string;
}>;
export type ReplacementCutEndpoint = CutEndpoint & Readonly<{
  /** Selected canonical SKETCH cycle ID, re-admitted at this revision. */
  profileCandidateId:string;
}>;
export type CutReassignmentRequest = Readonly<{
  format:typeof CUT_REASSIGN_FORMAT;
  version:typeof CUT_REASSIGN_VERSION;
  eventId:string;
  expectedRevision:number;
  units:'mm';
  frame:'local_xy';
  cutFeatureId:string;
  from:CutEndpoint;
  to:ReplacementCutEndpoint;
}>;

/**
 * Atomically retarget an existing generalized profile cut, optionally changing
 * its selected sketch, with source and revision fencing. Preserves the cut's
 * semantic identity and is entirely recoverable by RUNTIME undo/archive.
 * A pending cut is not a qualified native Boolean.
 */
export declare function reassignProfileCut(
  history:UndoHistory,
  request:CutReassignmentRequest,
  services:FeatureOpsServices
):Readonly<{
  kind:'committed';
  history:UndoHistory;
  report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  cutFeatureId:string;
  previousBodyId:string;
  targetBodyId:string;
  selectedProfileId:string;
  sourceSketchId:string;
  dependsOn:readonly string[];
  status:'pending_exact_provider';
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';
    cutFeatureId:string;
    bodyId:string;
    sourceRevision:number;
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;
    independentInteroperability:false;
  }>;
  exactAuthority:false;
  independentInteroperability:false;
}>;
