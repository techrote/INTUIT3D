import type {PlateRequest, PlateAssessment} from './plate-v1.mjs';
import type {Occt8Assessment} from './occt8-v1.mjs';
import type {ObservedPlateMetrics} from './local-plate-provider.mjs';

type Report = Extract<Occt8Assessment, {kind:'experimental_report'}>;
type Unresolved = Extract<PlateAssessment, {kind:'unresolved'}>;

export type LocalOcct8Result =
  | (Report & Readonly<{
      observed: Readonly<{
        source: ObservedPlateMetrics;
        stepReadback: ObservedPlateMetrics | null;
      }>;
      artifact: null | Readonly<{
        path:string; bytes:number; sha256:string;
        verification:'occt8_part21_plate_subset' | 'occt8_same_engine_step_readback';
      }>;
    }>)
  | (Unresolved & Readonly<{artifact:null; reason?:string}>)
  | Readonly<{
      kind:'unresolved'; code:'cancelled'; artifact:null;
      requestId:string; featureId:string; revision:number;
    }>;

/** Native OCCT 8.0.1 worker path must refer to a *separately provisioned* binary.
 * A passing assessment remains experimental, NOT full STEP interoperability.
 * nativeSupervisor override is for trusted developer/test harnesses only.
 */
export declare function runPinnedOcct8Plate(
  request: PlateRequest,
  options: Readonly<{
    workerExecutable:string;
    readCurrentRevision: () => number;
    pythonExecutable?: string;
    nativeSupervisor?: string;
    part21StepAudit?: boolean;
    crossVersionStepAudit?: boolean;
    stepOutput?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }>,
): Promise<LocalOcct8Result>;
