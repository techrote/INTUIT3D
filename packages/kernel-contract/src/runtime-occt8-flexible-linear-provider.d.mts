import type {Occt8FlexibleLinearRequest} from './occt8-flexible-linear-v6.mjs';
import type {Occt8OrthogonalAssessment} from './occt8-orthogonal-profile-v4.mjs';
export declare const RUNTIME_OCCT8_FLEXIBLE_VERSION:1;
export declare function requestFromRuntimeOcct8Flexible(
  history:unknown,targetBodyId:string,options:Readonly<{
    runtime:unknown;model:unknown;requestId:string;exportStep?:boolean;
  }>
):Occt8FlexibleLinearRequest;
export declare function runPinnedRuntimeOcct8Flexible(
  history:unknown,targetBodyId:string,options:Readonly<{
    runtime:unknown;model:unknown;requestId:string;workerExecutable:string;
    readCurrentRevision:()=>number;stepOutput?:string;pythonExecutable?:string;
    timeoutMs?:number;signal?:AbortSignal;nativeSupervisor?:string;
  }>
):Promise<Occt8OrthogonalAssessment>;
