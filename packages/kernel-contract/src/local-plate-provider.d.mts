import type {PlateRequest, PlateAssessment} from './plate-v1.mjs';

export type ObservedPlateMetrics = Readonly<{
  valid: true; solidCount: 1; volumeMm3: number; surfaceAreaMm2: number;
  cylindricalHoles: readonly Readonly<{x: number; y: number; radius: number; axisZ: number}>[];
}>;

export type LocalPlateResult =
  | (Extract<PlateAssessment, {kind:'experimental_report'}> & Readonly<{
      observed: Readonly<{source: ObservedPlateMetrics; stepReadback: ObservedPlateMetrics | null}>;
      artifact: null | Readonly<{
        path:string; bytes:number; sha256:string;
        verification:'same_engine_step_readback';
      }>;
    }>)
  | (Extract<PlateAssessment, {kind:'unresolved'}> & Readonly<{artifact:null; reason?:string}>)
  | Readonly<{
      kind:'unresolved'; code:'cancelled'; artifact:null;
      requestId:string; featureId:string; revision:number;
    }>;

/** Node-only experimental OCP process. Never authoritative exact geometry or independent STEP. */
export declare function runExperimentalPlate(
  request: PlateRequest,
  options: Readonly<{
    readCurrentRevision: () => number;
    pythonExecutable?: string;
    nativeSupervisor?: string;
    stepOutput?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }>,
): Promise<LocalPlateResult>;
