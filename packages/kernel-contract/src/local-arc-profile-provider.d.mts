/** Experimental OCP-only analytic line/arc extrusion; not pinned OCCT8 or external STEP. */
export interface ArcExtrudeRequest {
  protocol:'intuit3d/kernel/arc-extrude-v1';requestId:string;featureId:string;
  revision:number;units:'mm';thicknessMm:number;exportStep:boolean;
  profile:{format:'intuit3d.analytic-arc-profile';version:1;id:string;units:'mm';
    status:'analytic_2d_validated_pending_native';sourceSignature:string;
    providerSubmissionReady:true;nativeProfileAdmissible:false;stepQualified:false;
    globalSelfIntersectionChecked:true;holeContainmentChecked:true;
    signedBoundaryAreaMm2:number;materialAreaMm2:number;
    boundary:Array<{kind:'line'|'arc';id:string;start:{x:number;y:number};end:{x:number;y:number};
      center?:{x:number;y:number};radiusMm?:number;startAngleRad?:number;sweepRad?:number}>;
    holes:Array<{id:string;centerId:string;x:number;y:number;radiusMm:number}>;
    [key:string]:unknown;};
}
export type ArcExtrudeResult =
  | {kind:'unresolved';code:string;reason?:string;requestId:string;featureId:string;
     revision:number;artifact:null}
  | {kind:'experimental_profile_brep';protocol:string;status:'experimental_brep';
     requestId:string;featureId:string;revision:number;profileId:string;sourceSignature:string;
     backend:'OCP-python-prototype';occtVersion:'7.9.3.1';exactAuthority:false;
     independentInteroperability:false;units:'mm';
     source:{valid:true;solidCount:1;shellCount:1;faceCount:number;volumeMm3:number;
       cylindricalFaceCount:number};stepReadback:object|null;
     artifact:null|{path:string;bytes:number;sha256:string;verification:'same_engine_only'};
  };
export declare class ArcProviderError extends Error {}
export declare function validateArcExtrudeRequest(request:ArcExtrudeRequest):ArcExtrudeRequest;
export declare function runExperimentalArcExtrude(request:ArcExtrudeRequest, options:{
  readCurrentRevision:()=>number;stepOutput?:string;pythonExecutable?:string;
  workerScript?:string;timeoutMs?:number;signal?:AbortSignal;
}):Promise<ArcExtrudeResult>;
