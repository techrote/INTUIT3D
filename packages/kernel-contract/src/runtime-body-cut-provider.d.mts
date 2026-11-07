/** Node-only RUNTIME journal -> experimental OCP physical body cut. */
import type {ProjectDocument,Feature} from '@intuit3d/model';
import type {UndoHistory} from '@intuit3d/model/transactions';
import type {RuntimeReport} from '@intuit3d/workflow-runtime';
import type {ProfileBodyCutRequest,EdgeNotchBodyCutRequest,BodyCutResult} from './local-body-cut-provider.mjs';

export declare const RUNTIME_BODY_CUT_VERSION:1;
export interface RuntimeBodyCutServices {
  runtime:{inspect(history:UndoHistory):RuntimeReport};
  model:{featuresOf(document:ProjectDocument):readonly Feature[]};
}
export declare function requestFromRuntimeBodyCut(
  history:UndoHistory,cutFeatureId:string,
  options:RuntimeBodyCutServices&{requestId:string;exportStep?:boolean}
):ProfileBodyCutRequest;
export declare function runExperimentalRuntimeBodyCut(
  history:UndoHistory,cutFeatureId:string,
  options:RuntimeBodyCutServices&{
    requestId:string;readCurrentRevision:()=>number;
    stepOutput?:string;pythonExecutable?:string;workerScript?:string;
    timeoutMs?:number;signal?:AbortSignal;
  }
):Promise<BodyCutResult&{
  runtimeBodyCutVersion:1;experimentalOnly:true;
  exactAuthority:false;independentInteroperability:false;
}>;

/** Through-all rectangular edge notch from an already committed feature. */
export declare function requestFromRuntimePerimeterNotch(
  history:UndoHistory,cutFeatureId:string,
  options:RuntimeBodyCutServices&{requestId:string;exportStep?:boolean}
):EdgeNotchBodyCutRequest;
export declare function runExperimentalRuntimePerimeterNotch(
  history:UndoHistory,cutFeatureId:string,
  options:RuntimeBodyCutServices&{
    requestId:string;readCurrentRevision:()=>number;
    stepOutput?:string;pythonExecutable?:string;workerScript?:string;
    timeoutMs?:number;signal?:AbortSignal;
  }
):Promise<BodyCutResult&{
  runtimePerimeterNotchVersion:1;experimentalOnly:true;
  exactAuthority:false;independentInteroperability:false;
}>;
