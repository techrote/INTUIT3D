#!/usr/bin/env node
/**
 * Integration-owned local launcher for the existing trusted pinned-OCCT8
 * RUNTIME bridge. The Web app stays unchanged and unprivileged.
 *
 * An installed pinned worker must be supplied explicitly; there is no OCP
 * fallback. Checking the caller's expected digest is a local custody guard,
 * NOT proof of C++ compilation, independent STEP interoperability or exact
 * product authority. Use the PLATFORM verified offline installer first.
 */
import {createHash} from 'node:crypto';
import {readFile,realpath,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {runPinnedOcct8Plate} from '@intuit3d/kernel-contract/local-occt8-provider';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {startLocalPinnedOcct8Bridge} from '@intuit3d/workflow-runtime/local-plate-bridge';

async function sourceMatchedExecutable(){
  if(process.platform!=='linux')
    throw new Error('pinned local OCCT8 delivery requires Linux; Windows-native remains unqualified');
  const path=process.env.INTUIT3D_OCCT8_WORKER;
  const expected=process.env.INTUIT3D_OCCT8_WORKER_SHA256;
  if(!path||!isAbsolute(path)||!expected||!/^[a-f0-9]{64}$/.test(expected))
    throw new Error('set absolute INTUIT3D_OCCT8_WORKER and lower-case 64-hex INTUIT3D_OCCT8_WORKER_SHA256 from a verified offline installation');
  const resolved=await realpath(path);
  if(resolved!==path)
    throw new Error('pinned worker path must be canonical (no symlink or relative indirection)');
  const info=await stat(resolved);
  if(!info.isFile()||(info.mode&0o111)===0)
    throw new Error('pinned worker must be a regular executable file');
  const bytes=await readFile(resolved);
  const actual=createHash('sha256').update(bytes).digest('hex');
  if(actual!==expected)throw new Error('pinned worker SHA-256 mismatch');
  return {path:resolved,sha256:actual};
}

async function main(){
  const worker=await sourceMatchedExecutable();
  const runtime=createWorkflowRuntime({
    model,transactions,bindings,dimensions,archive,sketch,discovery
  });
  const host=await startLocalPinnedOcct8Bridge({
    runtime,model,plateContract,
    workerExecutable:worker.path,runPinnedOcct8Plate,
    origin:process.env.INTUIT3D_WEB_ORIGIN||'http://127.0.0.1:5173',
    port:0,timeoutMs:45000,
  });
  console.log('INTUIT3D local source-digest-matched pinned OCCT 8.0.1 C++ host configured.');
  console.log('LOCAL_WORKER_SHA256='+worker.sha256);
  console.log('LOCAL_PROVIDER_URL='+host.url);
  console.log('LOCAL_PAIRING_TOKEN='+host.token);
  console.log('No exactness or independent STEP acceptance from configuration alone.');
  let stopping=false;
  async function stop(){
    if(stopping)return;
    stopping=true;
    await host.close();
    process.exitCode=0;
  }
  process.once('SIGINT',()=>void stop());
  process.once('SIGTERM',()=>void stop());
}
main().catch(error=>{
  console.error('LOCAL_PINNED_NATIVE_HOST_FAILED',error instanceof Error?error.message:String(error));
  process.exitCode=2;
});
