/** Real isolated OCP 7.9.3.1 for INTUIT3D RUNTIME-admitted linear profiles only. */
import type {RuntimeReport} from '@intuit3d/workflow-runtime';
import type {ArcExtrudeRequest,ArcExtrudeResult} from './local-arc-profile-provider.mjs';
export declare const RUNTIME_PROFILE_PROVIDER_VERSION:1;
export type MappedRuntimeProfileRequest=ArcExtrudeRequest&{readonly semanticBodyId:string};
export declare function requestFromRuntimeProfile(report:RuntimeReport,
  extrudeFeatureId:string,opts:{requestId:string;exportStep?:boolean}):MappedRuntimeProfileRequest;
export declare function runExperimentalRuntimeProfile(report:RuntimeReport,
  extrudeFeatureId:string,opts:{requestId:string;readCurrentRevision:()=>number;
    stepOutput?:string;pythonExecutable?:string;workerScript?:string;
    timeoutMs?:number;signal?:AbortSignal}):Promise<ArcExtrudeResult&{
      semanticBodyId:string;runtimeProfileProviderVersion:1;experimentalOnly:true;
      exactAuthority:false;independentInteroperability:false}>;
