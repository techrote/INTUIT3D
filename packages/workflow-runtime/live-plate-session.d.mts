import type {UndoHistory} from '@intuit3d/model/transactions';
import type {JournalEvent} from '@intuit3d/model';
import type {DimensionBatchEditRequest} from '@intuit3d/model/dimension-batch-edit';
import type {WorkflowRuntime,WorkflowInvalidation,RuntimeReport,SketchConstraintBatchResult,
  SketchConstraintBatchRequest,PlateHoleBatchRequest,RectangularHoleArrayRequest,
  CircularHolePatternRequest,RigidHoleTransformRequest,HoleLayoutResizeRequest} from './index.mjs';
import type {LocalPlateClientResult,VerifiedLocalStep} from './local-plate-client.mjs';

export declare const LIVE_PLATE_SESSION_FORMAT:'intuit3d.live-plate-session';
export declare const LIVE_PLATE_SESSION_VERSION:1;
export interface LivePlateSessionState {
  format:typeof LIVE_PLATE_SESSION_FORMAT;
  version:typeof LIVE_PLATE_SESSION_VERSION;
  projectId:string;
  revision:number;
  inFlight:boolean;
  hasVerifiedStep:boolean;
  /** A solver-backed pointer pose is pending commit/cancellation. */
  hasActivePreview:boolean;
  lastResultKind:LocalPlateClientResult['kind']|null;
  exactAuthority:false;
}
/**
 * Serializable, model-backed consumer edits. No JS callback has to cross the
 * WORKBENCH boundary; the runtime calls the accepted INTENT/SKETCH services.
 * expectedRevision + projectId fence the whole command, including undo/redo.
 * request.expectedRevision is injected from the outer command; never supply it.
 */
export type LiveCadCommand = Readonly<{projectId:string;expectedRevision:number}> & (
  | Readonly<{kind:'model.events';events:readonly JournalEvent[]}>
  | Readonly<{kind:'model.undo'|'model.redo';eventIds:readonly string[]}>
  | Readonly<{kind:'dimensions.batch';request:Omit<DimensionBatchEditRequest,'expectedRevision'>}>
  | Readonly<{kind:'sketch.constraints';request:Omit<SketchConstraintBatchRequest,'expectedRevision'>}>
  | Readonly<{kind:'sketch.holes';request:Omit<PlateHoleBatchRequest,'expectedRevision'>}>
  | Readonly<{kind:'sketch.holes.rectangular';request:Omit<RectangularHoleArrayRequest,'expectedRevision'>}>
  | Readonly<{kind:'sketch.holes.circular';request:Omit<CircularHolePatternRequest,'expectedRevision'>}>
  | Readonly<{kind:'sketch.holes.transform';request:Omit<RigidHoleTransformRequest,'expectedRevision'>}>
  | Readonly<{kind:'sketch.holes.resize';request:Omit<HoleLayoutResizeRequest,'expectedRevision'>}>
);
export type SessionEdit = UndoHistory | SketchConstraintBatchResult;
export type SessionEditResult =
  | Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;
      invalidation:WorkflowInvalidation}>
  | Readonly<{kind:'refused';reason:string;notCommitted?:boolean;
      [key:string]:unknown}>;
/** Authored SKETCH/INTENT candidate; not a committed revision or native solid.
 * The actual candidate document stays privately owned by the session, and
 * this opaque token is accepted only once against its exact source archive.
 */
export type SessionEditPreview = Readonly<{
  kind:'preview';
  projectId:string;
  sourceRevision:number;
  candidateRevision:number;
  report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  exactAuthority:false;
  nativeEvaluation:null;
}>;
export type SessionEditPreviewResult =
  | SessionEditPreview
  | Extract<SessionEditResult,{kind:'refused'}>;
export type SessionReopenResult =
  | Readonly<{kind:'opened';history:UndoHistory;report:RuntimeReport;
      exactReuseAllowed:false}>
  | Readonly<{kind:'refused';reason:string;notCommitted:true}>;
export type SessionEditAndEvaluateResult =
  | Readonly<{kind:'refused';edit:Extract<SessionEditResult,{kind:'refused'}>;evaluation:null}>
  | Readonly<{kind:'submitted';edit:Extract<SessionEditResult,{kind:'committed'}>;
      /** Always check this for unresolved/stale/provider failure; not proof of exactness. */
      evaluation:LocalPlateClientResult}>;
export type SessionReopenAndEvaluateResult =
  | Readonly<{kind:'refused';reopen:Extract<SessionReopenResult,{kind:'refused'}>;evaluation:null}>
  | Readonly<{kind:'submitted';reopen:Extract<SessionReopenResult,{kind:'opened'}>;
      /** A new provider attempt; never implies production exactness. */
      evaluation:LocalPlateClientResult}>;
export interface LivePlateEvaluationOptions {
  url?:string;
  token?:string;
  requestId?:string;
  exportStep?:boolean;
  /** Require one configured native backend; do not silently fall back to OCP. */
  requiredBackend?:import('./local-plate-client.mjs').PinnedPlateBackend;
  signal?:AbortSignal;
  fetchImpl?:typeof fetch;
  /** Inclusive deadline across native attempts and busy retries (25–120000 ms; default 30000). */
  deadlineMs?:number;
}
export interface LivePlateSession {
  refresh():LivePlateSessionState;
  /** Genuine synchronous INTENT/ SKETCH transaction; never a private journal. */
  applyEdit(edit:(history:UndoHistory)=>SessionEdit):SessionEditResult;
  /** Execute a versioned, project/revision-fenced semantic CAD command. */
  applyCommand(command:LiveCadCommand):SessionEditResult;
  /** Commit only an admitted command, then evaluate through the trusted native host. */
  applyCommandAndEvaluate(
    command:LiveCadCommand,
    options?:Readonly<LivePlateEvaluationOptions>,
  ):Promise<SessionEditAndEvaluateResult>;
  /** Compute real solver/profile admission without publishing history or requesting native work. */
  previewEdit(edit:(history:UndoHistory)=>SessionEdit):SessionEditPreviewResult;
  /** Discard only the matching current gesture, without editing or native work. */
  cancelPreview(proposal:SessionEditPreview):
    | Readonly<{kind:'discarded';notCommitted:true;exactAuthority:false}>
    | Extract<SessionEditResult,{kind:'refused'}>;
  /** Commit only the most recent unconsumed proposal.
   * Replaced, rejected, and pointer-cancelled poses cannot commit.
   * This still requires the entire originating archive to remain current.
   * Returns a refused result for stale/reused/foreign session previews.
   */
  commitPreview(proposal:SessionEditPreview):SessionEditResult;
  /** One call: commit an admitted preview, then evaluate the committed revision. */
  commitPreviewAndEvaluate(
    proposal:SessionEditPreview,
    options?:Readonly<LivePlateEvaluationOptions>,
  ):Promise<SessionEditAndEvaluateResult>;
  /** Restore an identical archive, or explicitly confirm replacing current state. */
  reopen(serialized:string,options?:Readonly<{confirmReplacement?:boolean}>):SessionReopenResult;
  save():string;
  cancel():void;
  /** Revalidate live archive immediately before using already-verified STEP.
   * A same-revision failed refresh/cancel retains prior verified bytes, but
   * edits, undo, replacement archives and external mutation revoke them.
   */
  currentStep():VerifiedLocalStep|null;
  evaluate(options?:Readonly<LivePlateEvaluationOptions>):Promise<LocalPlateClientResult>;
  /** One consumer operation: model edit, then latest-revision experimental evaluation. */
  applyEditAndEvaluate(
    edit:(history:UndoHistory)=>SessionEdit,
    options?:Readonly<LivePlateEvaluationOptions>,
  ):Promise<SessionEditAndEvaluateResult>;
  /** Reopen an archive and rebuild through the trusted native host in one call.
   * A different archive requires confirmReplacement. Refusal never dispatches.
   */
  reopenAndEvaluate(
    serialized:string,
    options?:Readonly<LivePlateEvaluationOptions & {confirmReplacement?:boolean}>,
  ):Promise<SessionReopenAndEvaluateResult>;
}
export declare function createLivePlateSession(options:Readonly<{
  runtime:Pick<WorkflowRuntime,'save'|'reopen'|'inspect'|'diff'>;
  /** Same synchronous source of truth used by the actual browser/editor. */
  readCurrentHistory:()=>UndoHistory;
  /** Must immediately update the state returned by readCurrentHistory. */
  publishHistory:(history:UndoHistory)=>void;
  cutFeatureId?:string;
  /** Native double permitted for deterministic tests; production uses real client. */
  evaluateImpl?:typeof import('./local-plate-client.mjs').evaluateLocalPlate;
  busyRetries?:number;
}>):LivePlateSession;
