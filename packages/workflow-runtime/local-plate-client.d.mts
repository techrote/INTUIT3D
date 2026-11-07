import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime} from './index.mjs';
import type {ExperimentalPlateWorkflowResult} from './experimental-plate.mjs';

export declare const LOCAL_PLATE_CLIENT_FORMAT:'intuit3d.local-plate-bridge';
export declare const LOCAL_PLATE_CLIENT_VERSION:1;
export interface VerifiedLocalStep {
  filename:'plate.step';
  bytes:Uint8Array;
  sha256:string;
  verification:'same_engine_step_readback';
}
export type LocalPlateClientResult =
  | Readonly<{kind:'unresolved';code:string;reason:string;artifact:null;
      exactAuthority:false;independentInteroperability:false}>
  | Readonly<{kind:'experimental_plate_evaluated';
      source:{projectId:string;revision:number;archiveSha256:string};
      result:Extract<ExperimentalPlateWorkflowResult,{kind:'experimental_plate_evaluated'}>;
      step:VerifiedLocalStep|null;
      exactAuthority:false;independentInteroperability:false;note:string}>;
export declare function decodeVerifiedLocalStep(step:unknown):Promise<VerifiedLocalStep>;
/**
 * Browser-safe live-revision-fenced experimental plate evaluation.
 * The UI must check the current revision again immediately before saving STEP.
 */
export declare function evaluateLocalPlate(options:Readonly<{
  url:string;
  token:string;
  runtime:Pick<WorkflowRuntime,'save'|'inspect'>;
  readCurrentHistory:()=>UndoHistory;
  cutFeatureId:string;
  requestId:string;
  exportStep?:boolean;
  signal?:AbortSignal;
  fetchImpl?:typeof fetch;
}>):Promise<LocalPlateClientResult>;
