import type {Occt8FlexibleLinearRequest} from './occt8-flexible-linear-v6.mjs';
import type {Occt8OrthogonalAssessment} from './occt8-orthogonal-profile-v4.mjs';
export declare function runPinnedOcct8FlexibleLinear(request:Occt8FlexibleLinearRequest,options:Readonly<{
workerExecutable:string;readCurrentRevision:()=>number;stepOutput?:string;
pythonExecutable?:string;nativeSupervisor?:string;timeoutMs?:number;signal?:AbortSignal;
}>):Promise<Occt8OrthogonalAssessment>;
