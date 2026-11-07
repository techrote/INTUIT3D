import type {ArcExtrudeRequest} from './local-arc-profile-provider.mjs';
/** Experimental Boolean cut of two already admitted planar SKETCH profiles. */
export interface ThroughProfileBodyCutRequest {
  protocol:'intuit3d/kernel/profile-body-cut-v1';requestId:string;
  cutFeatureId:string;targetBodyId:string;revision:number;units:'mm';
  baseExtrude:ArcExtrudeRequest;cutTool:ArcExtrudeRequest;exportStep:boolean;
}
/** Explicit top-down pocket depth. v1 through-cut requests remain unchanged. */
export interface PocketBodyCutRequest extends Omit<ThroughProfileBodyCutRequest,'protocol'> {
  protocol:'intuit3d/kernel/profile-body-cut-v2';cutDepthMm:number;
}
export type ProfileBodyCutRequest=ThroughProfileBodyCutRequest|PocketBodyCutRequest;
export type BodyCutResult = {
  kind:'unresolved';code:string;reason?:string;requestId:string;
  cutFeatureId:string;targetBodyId:string;revision:number;artifact:null;
} | {
  kind:'experimental_body_cut_brep';protocol:string;status:'experimental_body_cut_brep';
  requestId:string;cutFeatureId:string;targetBodyId:string;revision:number;
  baseFeatureId:string;cutToolFeatureId:string;units:'mm';
  backend:'OCP-python-prototype';occtVersion:'7.9.3.1';
  exactAuthority:false;independentInteroperability:false;
  baseVolumeMm3:number;removedVolumeMm3:number;analyticResultVolumeMm3:number;
  cutDepthMm?:number;cutKind?:'blind_pocket'|'through';
  source:{valid:true;solidCount:1;shellCount:1;faceCount:number;volumeMm3:number};
  stepReadback:null|{valid:true;solidCount:1;shellCount:1;faceCount:number;volumeMm3:number};
  artifact:null|{path:string;bytes:number;sha256:string;verification:'same_engine_only'};
};
export declare function validateBodyCutRequest(request:ProfileBodyCutRequest):ProfileBodyCutRequest;
export declare function runExperimentalBodyCut(request:ProfileBodyCutRequest,options:{
  readCurrentRevision:()=>number;stepOutput?:string;pythonExecutable?:string;
  workerScript?:string;timeoutMs?:number;signal?:AbortSignal;
}):Promise<BodyCutResult>;
