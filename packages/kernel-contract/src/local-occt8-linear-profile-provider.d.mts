import type {Occt8LinearProfileRequest} from './occt8-linear-profile-v5.mjs';
import type {LocalOcct8OrthogonalResult} from './local-occt8-orthogonal-profile-provider.mjs';
export type LocalOcct8LinearResult=LocalOcct8OrthogonalResult;
export declare function runPinnedOcct8LinearProfileChain(
  request:Occt8LinearProfileRequest,options:Readonly<{
    workerExecutable:string;readCurrentRevision:()=>number;stepOutput?:string;
    pythonExecutable?:string;nativeSupervisor?:string;timeoutMs?:number;
    signal?:AbortSignal;
  }>):Promise<LocalOcct8LinearResult>;
