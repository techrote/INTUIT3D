import type {UndoHistory} from '@intuit3d/model/transactions';
import type {RuntimeBodyCutChainServices} from './runtime-body-cut-chain-provider.mjs';
import type {Occt8LProfileRequest} from './occt8-l-profile-v3.mjs';
import type {LocalOcct8LProfileResult} from './local-occt8-l-profile-provider.mjs';

export declare const RUNTIME_OCCT8_L_PROFILE_VERSION:1;
export declare function requestFromRuntimeOcct8LProfile(
  history:UndoHistory,targetBodyId:string,
  options:RuntimeBodyCutChainServices & {
    requestId:string;exportStep?:boolean;
  }
):Occt8LProfileRequest;
export declare function runPinnedRuntimeOcct8LProfile(
  history:UndoHistory,targetBodyId:string,
  options:RuntimeBodyCutChainServices & {
    requestId:string;workerExecutable:string;
    readCurrentRevision:()=>number;stepOutput?:string;
    pythonExecutable?:string;timeoutMs?:number;
    signal?:AbortSignal;nativeSupervisor?:string;
  }
):Promise<LocalOcct8LProfileResult & Readonly<{
  semanticBodyId:string;runtimeOcct8LProfileVersion:1;
  exactAuthority:false;independentInteroperability:false;
}>>;
