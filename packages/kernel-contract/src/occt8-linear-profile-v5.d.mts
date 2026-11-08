import type {Occt8OrthogonalAssessment} from './occt8-orthogonal-profile-v4.mjs';
export declare const OCCT8_LINEAR_PROFILE_PROTOCOL:
  'intuit3d/kernel/linear-profile-cut-chain-v5';
export type Occt8LinearProfileRequest=Readonly<{
  protocol:typeof OCCT8_LINEAR_PROFILE_PROTOCOL;
  requestId:string;featureId:string;revision:number;units:'mm';exportStep:boolean;
  profile:Readonly<{profileId:string;thickness:number;
    vertices:readonly Readonly<{x:number;y:number}>[]}>;
  cuts:readonly import('./occt8-mixed-cut-v2.mjs').Occt8MixedCut[];
}>;
export type Occt8LinearAssessment=Occt8OrthogonalAssessment;
export declare function parseOcct8LinearProfileRequest(value:unknown):Occt8LinearProfileRequest;
export declare function expectedOcct8LinearMetrics(value:Occt8LinearProfileRequest):
  Readonly<{volumeMm3:number;surfaceAreaMm2:number}>;
export declare function assessOcct8LinearResponse(
  value:unknown,report:unknown,options:Readonly<{currentRevision:number}>
):Occt8LinearAssessment;
