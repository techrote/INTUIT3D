import type {Occt8OrthogonalProfileRequest} from './occt8-orthogonal-profile-v4.mjs';
import type {LocalOcct8OrthogonalResult} from './local-occt8-orthogonal-profile-provider.mjs';
export declare const RUNTIME_OCCT8_ORTHOGONAL_VERSION:1;
export declare function requestFromRuntimeOcct8Orthogonal(
  history:unknown,targetBodyId:string,
  options:Readonly<{runtime:unknown;model:unknown;requestId:string;exportStep?:boolean}>
):Occt8OrthogonalProfileRequest;
export declare function runPinnedRuntimeOcct8Orthogonal(
  history:unknown,targetBodyId:string,
  options:Readonly<{runtime:unknown;model:unknown;requestId:string;
    workerExecutable:string;readCurrentRevision:()=>number;stepOutput?:string;
    pythonExecutable?:string;nativeSupervisor?:string;timeoutMs?:number;
    signal?:AbortSignal}>
):Promise<LocalOcct8OrthogonalResult&Readonly<{
  semanticBodyId:string;runtimeOcct8OrthogonalVersion:1;
  exactAuthority:false;independentInteroperability:false;
}>>;
