/** Strict consumer TypeScript contract, never executed as a test runtime. */
import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime} from '../index.mjs';
import {startLocalPlateBridge} from '../local-plate-bridge.mjs';
import type {LocalPlateBridge} from '../local-plate-bridge.mjs';
import {evaluateLocalPlate,decodeVerifiedLocalStep} from '../local-plate-client.mjs';
import type {LocalPlateClientResult,VerifiedLocalStep} from '../local-plate-client.mjs';

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
