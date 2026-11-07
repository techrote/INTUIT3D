/** Node-only journal-to-real-experimental-OCP sequential body-cut bridge. */
import type {ProjectDocument,Feature} from '@intuit3d/model';
import type {UndoHistory} from '@intuit3d/model/transactions';
import type {RuntimeReport} from '@intuit3d/workflow-runtime';
import type {BodyCutChainRequest,BodyCutResult} from './local-body-cut-provider.mjs';
export declare const RUNTIME_BODY_CUT_CHAIN_VERSION:1;
export interface RuntimeBodyCutChainServices {
  runtime:{inspect(history:UndoHistory):RuntimeReport};
  model:{featuresOf(document:ProjectDocument):readonly Feature[]};
}
export declare function requestFromRuntimeBodyCutChain(
  history:UndoHistory,targetBodyId:string,
  options:RuntimeBodyCutChainServices&{requestId:string;exportStep?:boolean}
):BodyCutChainRequest;
export declare function runExperimentalRuntimeBodyCutChain(
  history:UndoHistory,targetBodyId:string,
  options:RuntimeBodyCutChainServices&{
    requestId:string;readCurrentRevision:()=>number;
    stepOutput?:string;pythonExecutable?:string;workerScript?:string;
    timeoutMs?:number;signal?:AbortSignal;
  }
):Promise<BodyCutResult&{
  runtimeBodyCutChainVersion:1;experimentalOnly:true;
  exactAuthority:false;independentInteroperability:false;
}>;
