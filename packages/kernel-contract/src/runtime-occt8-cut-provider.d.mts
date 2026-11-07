import type {Occt8CutRequest} from './occt8-cut-v1.mjs';
import type {LocalOcct8CutResult} from './local-occt8-cut-provider.mjs';
type RuntimeService = Readonly<{inspect:(history:unknown)=>unknown}>;
type ModelService = Readonly<{featuresOf:(document:unknown)=>unknown}>;
export declare const RUNTIME_OCCT8_RECT_CUT_VERSION:1;
export declare function requestFromRuntimeOcct8RectCuts(
  history:unknown,targetBodyId:string,options:Readonly<{
    runtime:RuntimeService;model:ModelService;requestId:string;exportStep?:boolean;
  }>
):Occt8CutRequest;
export declare function runPinnedRuntimeOcct8RectCuts(
  history:unknown,targetBodyId:string,options:Readonly<{
    runtime:RuntimeService;model:ModelService;requestId:string;
    workerExecutable:string;readCurrentRevision:()=>number;
    stepOutput?:string;pythonExecutable?:string;timeoutMs?:number;
    signal?:AbortSignal;nativeSupervisor?:string;
  }>
):Promise<LocalOcct8CutResult & Readonly<{
  semanticBodyId:string;runtimeOcct8RectCutVersion:1;
  exactAuthority:false;independentInteroperability:false;
}>>;
