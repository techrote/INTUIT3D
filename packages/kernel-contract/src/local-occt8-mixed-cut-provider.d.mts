import type {Occt8MixedCutRequest,Occt8MixedCutAssessment} from './occt8-mixed-cut-v2.mjs';
import type {ObservedPlateMetrics} from './local-plate-provider.mjs';
export type LocalOcct8MixedCutResult=
  | (Extract<Occt8MixedCutAssessment,{kind:'experimental_report'}> & Readonly<{
      observed:Readonly<{source:ObservedPlateMetrics;stepReadback:ObservedPlateMetrics|null}>;
      artifact:null|Readonly<{path:string;bytes:number;sha256:string;
        verification:'occt8_same_engine_step_readback'}>;
    }>)
  | (Extract<Occt8MixedCutAssessment,{kind:'unresolved'}> & Readonly<{
      artifact:null;reason?:string}>)
  | Readonly<{kind:'unresolved';code:'cancelled';artifact:null;
      requestId:string;featureId:string;revision:number}>;
export declare function runPinnedOcct8MixedCutChain(
  request:Occt8MixedCutRequest,
  options:Readonly<{
    workerExecutable:string;readCurrentRevision:()=>number;stepOutput?:string;
    pythonExecutable?:string;nativeSupervisor?:string;timeoutMs?:number;
    signal?:AbortSignal;
  }>
):Promise<LocalOcct8MixedCutResult>;
