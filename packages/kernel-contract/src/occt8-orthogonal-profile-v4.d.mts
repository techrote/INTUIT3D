import type {Occt8MixedCut} from './occt8-mixed-cut-v2.mjs';
export declare const OCCT8_ORTHOGONAL_PROFILE_PROTOCOL:
  'intuit3d/kernel/orthogonal-profile-cut-chain-v4';
export type Occt8OrthogonalProfileRequest=Readonly<{
  protocol:typeof OCCT8_ORTHOGONAL_PROFILE_PROTOCOL;
  requestId:string;featureId:string;revision:number;units:'mm';exportStep:boolean;
  profile:Readonly<{profileId:string;thickness:number;
    vertices:readonly Readonly<{x:number;y:number}>[]}>;
  cuts:readonly Occt8MixedCut[];
}>;
export type Occt8OrthogonalAssessment=
  | Readonly<{kind:'experimental_report';requestId:string;featureId:string;
      profileId:string;cutFeatureIds:readonly string[];revision:number;
      backend:'OCCT-cxx-8.0.1';occtVersion:'8.0.1';
      expectedMetrics:Readonly<{volumeMm3:number;surfaceAreaMm2:number}>;
      exactAuthority:false;independentInteroperability:false;
      artifactSha256:string|null;step:'same_engine_readback_reported'|'not_requested'}>
  | Readonly<{kind:'unresolved';code:string;requestId:string;featureId:string;revision:number}>;
export declare function parseOcct8OrthogonalProfileRequest(value:unknown):Occt8OrthogonalProfileRequest;
export declare function expectedOcct8OrthogonalMetrics(value:Occt8OrthogonalProfileRequest):
  Readonly<{volumeMm3:number;surfaceAreaMm2:number}>;
export declare function assessOcct8OrthogonalResponse(
  value:unknown,report:unknown,options:Readonly<{currentRevision:number}>
):Occt8OrthogonalAssessment;
