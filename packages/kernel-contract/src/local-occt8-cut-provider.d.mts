import type {Occt8CutRequest, Occt8CutAssessment} from './occt8-cut-v1.mjs';
import type {ObservedPlateMetrics} from './local-plate-provider.mjs';
export type LocalOcct8CutResult = (
  | (Extract<Occt8CutAssessment,{kind:'experimental_report'}> & Readonly<{
      observed:Readonly<{source:ObservedPlateMetrics;stepReadback:ObservedPlateMetrics|null}>;
      artifact:null|Readonly<{
        path:string;bytes:number;sha256:string;
        verification:'occt8_same_engine_step_readback';
      }>;
    }>)
  | (Extract<Occt8CutAssessment,{kind:'unresolved'}> & Readonly<{
      artifact:null;reason?:string;
    }>)
  | Readonly<{kind:'unresolved';code:'cancelled';artifact:null;
    requestId:string;featureId:string;revision:number}>
);
export declare function runPinnedOcct8CutChain(
  request:Occt8CutRequest,
  options:Readonly<{
    workerExecutable:string;
    readCurrentRevision:()=>number;
    pythonExecutable?:string;
    nativeSupervisor?:string;
    stepOutput?:string;
    timeoutMs?:number;
    signal?:AbortSignal;
  }>
):Promise<LocalOcct8CutResult>;
