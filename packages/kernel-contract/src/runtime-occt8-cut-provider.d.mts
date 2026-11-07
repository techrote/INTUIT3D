import type {UndoHistory} from '@intuit3d/model/transactions';
import type {RuntimeBodyCutChainServices} from './runtime-body-cut-chain-provider.mjs';
import type {Occt8CutRequest} from './occt8-cut-v1.mjs';
import type {LocalOcct8CutResult} from './local-occt8-cut-provider.mjs';
export declare const RUNTIME_OCCT8_RECT_CUT_VERSION:1;
export declare function requestFromRuntimeOcct8RectCuts(
  history:UndoHistory,targetBodyId:string,
  options:RuntimeBodyCutChainServices & {
    requestId:string;exportStep?:boolean;
  }
):Occt8CutRequest;
export declare function runPinnedRuntimeOcct8RectCuts(
  history:UndoHistory,targetBodyId:string,
  options:RuntimeBodyCutChainServices & {
    requestId:string;workerExecutable:string;
    readCurrentRevision:()=>number;stepOutput?:string;
    pythonExecutable?:string;timeoutMs?:number;
    signal?:AbortSignal;nativeSupervisor?:string;
  }
):Promise<LocalOcct8CutResult & Readonly<{
  semanticBodyId:string;runtimeOcct8RectCutVersion:1;
  exactAuthority:false;independentInteroperability:false;
}>>;
