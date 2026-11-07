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


// Node-only, versioned external reader consumer; the browser never imports it.
import {parseNonOcctPlateTranscript,runNonOcctPlateProbe} from '../nonocct-step-probe.mjs';
export async function nonOcctBridgeConsumer(step:{bytes:Uint8Array;sha256:string;
  verification:'occt8_part21_plate_subset'}, source:{projectId:string;
  revision:number;archiveSha256:string}) {
  const plate={width:120,depth:80,thickness:8,holes:[
    {x:-30,y:0,radius:6},{x:30,y:0,radius:6},
  ]};
  const transcript:(typeof parseNonOcctPlateTranscript)=parseNonOcctPlateTranscript;
  void transcript;
  const evidence=await runNonOcctPlateProbe({probeExecutable:'/trusted/anvil_probe',
    expectedProbeSha256:'0'.repeat(64),step,source,plate});
  const noExact:false=evidence.exactAuthority;
  const noInteroperability:false=evidence.independentInteroperability;
  return {noExact,noInteroperability,evidence};
}

import {verifyCurrentLivePlateStep} from '../nonocct-step-probe.mjs';
import type {LivePlateSession} from '../live-plate-session.mjs';
declare const liveSession:LivePlateSession;
export async function livePinnedExternalConsumer(
  evaluation:Parameters<typeof verifyCurrentLivePlateStep>[0]['evaluation'],
) {
  const evidence=await verifyCurrentLivePlateStep({
    session:liveSession,evaluation,
    probeExecutable:'/trusted/anvil_step_probe',
    expectedProbeSha256:'a'.repeat(64),
  });
  const rev:number=evidence.source.revision;
  const experimental:false=evidence.exactAuthority;
  const unqualified:false=evidence.independentInteroperability;
  return {rev,experimental,unqualified};
}
