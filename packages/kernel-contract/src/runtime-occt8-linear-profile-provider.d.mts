import type {Occt8LinearProfileRequest} from './occt8-linear-profile-v5.mjs';
import type {LocalOcct8LinearResult} from './local-occt8-linear-profile-provider.mjs';
export declare const RUNTIME_OCCT8_LINEAR_VERSION:1;
export declare function requestFromRuntimeOcct8Linear(
  history:unknown,targetBodyId:string,
  options:Readonly<{runtime:unknown;model:unknown;requestId:string;exportStep?:boolean}>
):Occt8LinearProfileRequest;
export declare function runPinnedRuntimeOcct8Linear(
  history:unknown,targetBodyId:string,
  options:Readonly<{runtime:unknown;model:unknown;requestId:string;
    workerExecutable:string;readCurrentRevision:()=>number;stepOutput?:string;
    pythonExecutable?:string;nativeSupervisor?:string;timeoutMs?:number;
    signal?:AbortSignal}>
):Promise<LocalOcct8LinearResult&Readonly<{
  semanticBodyId:string;runtimeOcct8LinearVersion:1;
  exactAuthority:false;independentInteroperability:false;
}>>;
