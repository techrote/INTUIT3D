import type {Occt8LProfileRequest,Occt8LProfileAssessment}
  from './occt8-l-profile-v3.mjs';
import type {ObservedPlateMetrics} from './local-plate-provider.mjs';
export type LocalOcct8LProfileResult=
  | (Extract<Occt8LProfileAssessment,{kind:'experimental_report'}> & Readonly<{
      observed:Readonly<{source:ObservedPlateMetrics;stepReadback:ObservedPlateMetrics|null}>;
      artifact:null|Readonly<{path:string;bytes:number;sha256:string;
        verification:'occt8_same_engine_step_readback'}>;
    }>)
  | (Extract<Occt8LProfileAssessment,{kind:'unresolved'}> & Readonly<{
      artifact:null;reason?:string}>)
  | Readonly<{kind:'unresolved';code:'cancelled';artifact:null;
      requestId:string;featureId:string;revision:number}>;
export declare function runPinnedOcct8LProfileChain(
  request:Occt8LProfileRequest,
  options:Readonly<{
    workerExecutable:string;readCurrentRevision:()=>number;stepOutput?:string;
    pythonExecutable?:string;nativeSupervisor?:string;timeoutMs?:number;
    signal?:AbortSignal;
  }>
):Promise<LocalOcct8LProfileResult>;
