#!/usr/bin/env node
/**
 * Trusted local companion for the REAL INTUIT model-backed browser UI.
 * It must run outside Vite. Uses RUNTIME's Node-only host and KERNEL's pinned
 * experimental provider; does not ship Python/OCCT or secrets to the bundle.
 *
 * npm ci
 * python3 -m pip install -r native/requirements-prototype.txt
 * node apps/web/scripts/local-native-host.mjs
 * # In another terminal: npm run dev --workspace @intuit3d/web
 */
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {runExperimentalPlate} from '@intuit3d/kernel-contract/local-plate-provider';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {startLocalPlateBridge} from '@intuit3d/workflow-runtime/local-plate-bridge';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const host=await startLocalPlateBridge({
  runtime,model,plateContract,runExperimentalPlate,
  origin:process.env.INTUIT3D_WEB_ORIGIN||'http://127.0.0.1:5173',
  port:0,timeoutMs:45000,
});
console.log('INTUIT3D local experimental native host started (OCP research backend only).');
console.log('LOCAL_PROVIDER_URL='+host.url);
console.log('LOCAL_PAIRING_TOKEN='+host.token);
console.log('Copy URL and token into the model-backed editor. Keep the token private.');
console.log('No product exactness or independent STEP readback is established. Ctrl+C to stop.');
let stopping=false;
async function stop(){
  if(stopping)return;
  stopping=true;
  await host.close();
  process.exitCode=0;
}
process.once('SIGINT',()=>void stop());
process.once('SIGTERM',()=>void stop());
