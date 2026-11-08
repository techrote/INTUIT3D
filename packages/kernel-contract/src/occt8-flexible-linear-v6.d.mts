import type {Occt8OrthogonalAssessment} from './occt8-orthogonal-profile-v4.mjs';
export declare const OCCT8_FLEXIBLE_LINEAR_PROTOCOL:'intuit3d/kernel/flexible-linear-profile-v6';
export type Occt8FlexibleLinearRequest=Readonly<{
  protocol:typeof OCCT8_FLEXIBLE_LINEAR_PROTOCOL;
  requestId:string;featureId:string;revision:number;units:'mm';exportStep:boolean;
  profile:Readonly<{profileId:string;thickness:number;vertices:readonly Readonly<{x:number;y:number}>[]}>;
  cuts:readonly import('./occt8-mixed-cut-v2.mjs').Occt8MixedCut[];
}>;
export declare function parseOcct8FlexibleLinearRequest(value:unknown):Occt8FlexibleLinearRequest;
export declare function expectedOcct8FlexibleLinearMetrics(value:Occt8FlexibleLinearRequest):Readonly<{volumeMm3:number;surfaceAreaMm2:number}>;
export declare function assessOcct8FlexibleLinearResponse(value:unknown,report:unknown,options:Readonly<{currentRevision:number}>):Occt8OrthogonalAssessment;
