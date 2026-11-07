import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,WorkflowInvalidation,RuntimeReport,SketchConstraintBatchResult} from './index.mjs';
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
  lastResultKind:LocalPlateClientResult['kind']|null;
  exactAuthority:false;
}
export type SessionEdit = UndoHistory | SketchConstraintBatchResult;
export type SessionEditResult =
  | Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;
      invalidation:WorkflowInvalidation}>
  | Readonly<{kind:'refused';reason:string;notCommitted?:boolean;
      [key:string]:unknown}>;
export type SessionReopenResult =
  | Readonly<{kind:'opened';history:UndoHistory;report:RuntimeReport;
      exactReuseAllowed:false}>
  | Readonly<{kind:'refused';reason:string;notCommitted:true}>;
export type SessionEditAndEvaluateResult =
  | Readonly<{kind:'refused';edit:Extract<SessionEditResult,{kind:'refused'}>;evaluation:null}>
  | Readonly<{kind:'submitted';edit:Extract<SessionEditResult,{kind:'committed'}>;
      /** Always check this for unresolved/stale/provider failure; not proof of exactness. */
      evaluation:LocalPlateClientResult}>;
export interface LivePlateEvaluationOptions {
  url?:string;
  token?:string;
  requestId?:string;
  exportStep?:boolean;
  signal?:AbortSignal;
  fetchImpl?:typeof fetch;
}
export interface LivePlateSession {
  refresh():LivePlateSessionState;
  /** Genuine synchronous INTENT/ SKETCH transaction; never a private journal. */
  applyEdit(edit:(history:UndoHistory)=>SessionEdit):SessionEditResult;
  /** Restore an identical archive, or explicitly confirm replacing current state. */
  reopen(serialized:string,options?:Readonly<{confirmReplacement?:boolean}>):SessionReopenResult;
  save():string;
  cancel():void;
  /** Revalidate live archive immediately before using already-verified STEP. */
  currentStep():VerifiedLocalStep|null;
  evaluate(options?:Readonly<LivePlateEvaluationOptions>):Promise<LocalPlateClientResult>;
  /** One consumer operation: model edit, then latest-revision experimental evaluation. */
  applyEditAndEvaluate(
    edit:(history:UndoHistory)=>SessionEdit,
    options?:Readonly<LivePlateEvaluationOptions>,
  ):Promise<SessionEditAndEvaluateResult>;
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
