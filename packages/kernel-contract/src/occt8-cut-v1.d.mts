export declare const OCCT8_CUT_PROTOCOL: 'intuit3d/kernel/plate-cut-chain-v1';
export type Occt8RectCut = Readonly<{
  featureId: string; x: number; y: number;
  width: number; depth: number; cutDepthMm: number;
}>;
export type Occt8CutRequest = Readonly<{
  protocol: typeof OCCT8_CUT_PROTOCOL;
  requestId: string; featureId: string; revision: number;
  units: 'mm'; exportStep: boolean;
  plate: Readonly<{
    width: number; depth: number; thickness: number;
    holes: readonly Readonly<{x:number;y:number;radius:number}>[];
  }>;
  cuts: readonly Occt8RectCut[];
}>;
export type Occt8CutAssessment =
  | Readonly<{
      kind: 'experimental_report'; requestId: string; featureId: string; revision: number;
      backend:'OCCT-cxx-8.0.1'; occtVersion:'8.0.1';
      expectedMetrics:Readonly<{volumeMm3:number;surfaceAreaMm2:number}>;
      exactAuthority:false; independentInteroperability:false;
      artifactSha256:string|null; step:'same_engine_readback_reported'|'not_requested';
    }>
  | Readonly<{
      kind:'unresolved'; code:string; requestId:string; featureId:string; revision:number;
    }>;
export declare function parseOcct8CutRequest(request:unknown): Occt8CutRequest;
export declare function expectedOcct8CutMetrics(request:Occt8CutRequest):
  Readonly<{volumeMm3:number;surfaceAreaMm2:number}>;
export declare function assessOcct8CutResponse(
  request:unknown, report:unknown, options:Readonly<{currentRevision:number}>
): Occt8CutAssessment;
