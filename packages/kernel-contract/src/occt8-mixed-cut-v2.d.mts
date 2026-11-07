export declare const OCCT8_MIXED_CUT_PROTOCOL:'intuit3d/kernel/plate-mixed-cut-chain-v2';
export type Occt8MixedCut = Readonly<
  | {featureId:string;kind:'rectangle';x:number;y:number;width:number;depth:number;cutDepthMm:number}
  | {featureId:string;kind:'circle';x:number;y:number;radius:number;cutDepthMm:number}
>;
export type Occt8MixedCutRequest=Readonly<{
  protocol:typeof OCCT8_MIXED_CUT_PROTOCOL;
  requestId:string;featureId:string;revision:number;units:'mm';exportStep:boolean;
  plate:Readonly<{width:number;depth:number;thickness:number;
    holes:readonly Readonly<{x:number;y:number;radius:number}>[]}>;
  cuts:readonly Occt8MixedCut[];
}>;
export type Occt8MixedCutAssessment=
  | Readonly<{kind:'experimental_report';requestId:string;featureId:string;revision:number;
      backend:'OCCT-cxx-8.0.1';occtVersion:'8.0.1';
      expectedMetrics:Readonly<{volumeMm3:number;surfaceAreaMm2:number}>;
      exactAuthority:false;independentInteroperability:false;
      artifactSha256:string|null;step:'same_engine_readback_reported'|'not_requested'}>
  | Readonly<{kind:'unresolved';code:string;requestId:string;featureId:string;revision:number}>;
export declare function parseOcct8MixedCutRequest(value:unknown):Occt8MixedCutRequest;
export declare function expectedOcct8MixedCutMetrics(value:Occt8MixedCutRequest):
  Readonly<{volumeMm3:number;surfaceAreaMm2:number}>;
export declare function assessOcct8MixedCutResponse(
  value:unknown,report:unknown,options:Readonly<{currentRevision:number}>
):Occt8MixedCutAssessment;
