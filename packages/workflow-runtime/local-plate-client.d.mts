import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime} from './index.mjs';
import type {ExperimentalPlateWorkflowResult} from './experimental-plate.mjs';

export declare const LOCAL_PLATE_CLIENT_FORMAT:'intuit3d.local-plate-bridge';
export declare const LOCAL_PLATE_CLIENT_VERSION:1;
export declare const LOCAL_PLATE_CAPABILITY_FORMAT:'intuit3d.local-plate-bridge-capability';
export declare const LOCAL_PLATE_CAPABILITY_VERSION:1;
export type PinnedPlateBackend='OCCT-cxx-8.0.1'|'OCP-python-prototype';
export type LocalPlateBridgeIdentity=
  | Readonly<{kind:'paired';backend:PinnedPlateBackend;
      occtVersion:'8.0.1'|'7.9.3.1';
      stepVerification:'occt8_part21_plate_subset'|'same_engine_step_readback';
      exactAuthority:false;independentInteroperability:false}>
  | Extract<LocalPlateClientResult,{kind:'unresolved'}>;
/** Authenticated backend selection, NOT a binary readiness or exactness test. */
export declare function inspectLocalPlateBridge(options:Readonly<{
  url:string;token:string;signal?:AbortSignal;fetchImpl?:typeof fetch;
}>):Promise<LocalPlateBridgeIdentity>;
export interface VerifiedLocalStep {
  filename:'plate.step';
  bytes:Uint8Array;
  sha256:string;
  verification:'same_engine_step_readback'|'occt8_part21_plate_subset';
}
export type LocalPlateClientResult =
  | Readonly<{kind:'unresolved';code:string;reason:string;artifact:null;
      /** Features omitted by a plate-v1 one-body request; no STEP was made. */
      unsupportedFeatureIds?:readonly string[];
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
  /** Refuse to dispatch to a different backend; preflight is authenticated. */
  requiredBackend?:PinnedPlateBackend;
  signal?:AbortSignal;
  fetchImpl?:typeof fetch;
}>):Promise<LocalPlateClientResult>;
