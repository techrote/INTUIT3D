/** Strict consumer TypeScript contract, never executed as a test runtime. */
import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime} from '../index.mjs';
import {startLocalPlateBridge,startLocalPinnedOcct8Bridge} from '../local-plate-bridge.mjs';
import type {LocalPlateBridge} from '../local-plate-bridge.mjs';
import {evaluateLocalPlate,decodeVerifiedLocalStep} from '../local-plate-client.mjs';
import type {LocalPlateClientResult,VerifiedLocalStep} from '../local-plate-client.mjs';
import {runPinnedOcct8Plate} from '@intuit3d/kernel-contract/local-occt8-provider';
import * as model from '@intuit3d/model';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';

declare const runtime:WorkflowRuntime;
declare const current:UndoHistory;
declare const host:LocalPlateBridge;

export async function browserConsumer():Promise<LocalPlateClientResult> {
  const outcome=await evaluateLocalPlate({
    url:host.url,token:host.token,runtime,
    readCurrentHistory:()=>current,
    cutFeatureId:'cut',requestId:'bridge.test',exportStep:true,
  });
  if(outcome.kind==='experimental_plate_evaluated' && outcome.step) {
    const bytes:Uint8Array=outcome.step.bytes;
    const hash:string=outcome.step.sha256;
    void [bytes,hash];
  }
  const observedFalse:false=outcome.exactAuthority;
  void observedFalse;
  return outcome;
}
export async function trustedServer() {
  const factory:typeof startLocalPlateBridge=startLocalPlateBridge;
  void factory;
  const verified:VerifiedLocalStep=await decodeVerifiedLocalStep({
    filename:'plate.step',bytes:3,sha256:'0'.repeat(64),
    base64:'YWJj',verification:'same_engine_step_readback',
  });
  return verified;
}

export async function pinnedNativeHostConsumer(){
  const pinned=await startLocalPinnedOcct8Bridge({
    runtime,model,plateContract,runPinnedOcct8Plate,
    workerExecutable:'/trusted/native/intuit3d_occt8_plate',
    crossVersionStepAudit:false,
  });
  const result=await evaluateLocalPlate({
    url:pinned.url,token:pinned.token,runtime,readCurrentHistory:()=>current,
    cutFeatureId:'cut',requestId:'pinned.consumer',exportStep:true,
  });
  if(result.kind==='experimental_plate_evaluated'&&result.step){
    const evidence:VerifiedLocalStep['verification']=result.step.verification;
    if(evidence==='occt8_part21_plate_subset'){
      const stillExperimental:false=result.exactAuthority;
      const stillNotGeneralInteroperability:false=result.independentInteroperability;
      void [stillExperimental,stillNotGeneralInteroperability];
    }
  }
  await pinned.close();
}
