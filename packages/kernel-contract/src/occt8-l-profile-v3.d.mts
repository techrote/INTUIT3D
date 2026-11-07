import type {Occt8MixedCut} from './occt8-mixed-cut-v2.mjs';
export declare const OCCT8_L_PROFILE_PROTOCOL:'intuit3d/kernel/l-profile-cut-chain-v3';
export type Occt8LProfileRequest=Readonly<{
  protocol:typeof OCCT8_L_PROFILE_PROTOCOL;
  requestId:string;featureId:string;revision:number;units:'mm';exportStep:boolean;
  profile:Readonly<{profileId:string;width:number;depth:number;thickness:number;
    legWidth:number;footHeight:number}>;
  cuts:readonly Occt8MixedCut[];
}>;
export type Occt8LProfileAssessment=
  | Readonly<{kind:'experimental_report';requestId:string;featureId:string;
      profileId:string;cutFeatureIds:readonly string[];revision:number;
      backend:'OCCT-cxx-8.0.1';occtVersion:'8.0.1';
      expectedMetrics:Readonly<{volumeMm3:number;surfaceAreaMm2:number}>;
      exactAuthority:false;independentInteroperability:false;
      artifactSha256:string|null;step:'same_engine_readback_reported'|'not_requested'}>
  | Readonly<{kind:'unresolved';code:string;requestId:string;featureId:string;revision:number}>;
export declare function parseOcct8LProfileRequest(value:unknown):Occt8LProfileRequest;
export declare function expectedOcct8LProfileMetrics(value:Occt8LProfileRequest):
  Readonly<{volumeMm3:number;surfaceAreaMm2:number}>;
export declare function assessOcct8LProfileResponse(
  value:unknown,report:unknown,options:Readonly<{currentRevision:number}>
):Occt8LProfileAssessment;
