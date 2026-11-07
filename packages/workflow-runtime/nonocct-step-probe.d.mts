/** Node-only independent CAD sample runner; binary/source provenance is externally qualified. */
export type NonOcctPlate = Readonly<{width:number;depth:number;thickness:number;
  holes:ReadonlyArray<Readonly<{x:number;y:number;radius:number}>>}>;
export type NonOcctPlateSample = Readonly<{
  measuredVolumeMm3:number;analyticVolumeMm3:number;relativeVolumeError:number;
  triangles:number;sourceUnit:string;importedExactBrep:true;
  rays:ReadonlyArray<Readonly<{name:string;xMm:number;yMm:number;hits:number;
    entryZMm:number|null;exitZMm:number|null}>>;
}>;
export declare const NONOCCT_STEP_PROBE_FORMAT:'intuit3d.nonocct-step-sample';
export declare const NONOCCT_STEP_PROBE_VERSION:1;
export declare function parseNonOcctPlateTranscript(stdout:string,plate:NonOcctPlate):NonOcctPlateSample;
export declare function runNonOcctPlateProbe(options:Readonly<{
  probeExecutable:string;expectedProbeSha256:string;
  step:Readonly<{bytes:Uint8Array;sha256:string;verification:'occt8_part21_plate_subset'}>;
  plate:NonOcctPlate;
  source:Readonly<{projectId:string;revision:number;archiveSha256:string}>;
  timeoutMs?:number;
}>):Promise<Readonly<{
  format:'intuit3d.nonocct-step-sample';version:1;kind:'executed_nonocct_plate_sample';
  source:Readonly<{projectId:string;revision:number;archiveSha256:string}>;
  stepSha256:string;probeSha256:string;transcriptSha256:string;
  sample:NonOcctPlateSample;exactAuthority:false;independentInteroperability:false;note:string;
}>>;
