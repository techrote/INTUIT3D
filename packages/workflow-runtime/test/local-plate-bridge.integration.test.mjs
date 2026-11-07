/**
 * Actual accepted INTENT+SKETCH history through a loopback HTTP boundary.
 * Native provider below is explicitly a TEST DOUBLE; no OCP is executed here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {createWorkflowRuntime} from '../index.mjs';
import {startLocalPlateBridge} from '../local-plate-bridge.mjs';
import {evaluateLocalPlate,decodeVerifiedLocalStep} from '../local-plate-client.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const created=(eventId,feature)=>({eventId,type:'feature.create',feature});
function plateProject() {
  let history=transactions.startUndoHistory(model.newProject('runtime.local_bridge'));
  history=runtime.commit(history,[
    created('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    created('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    created('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
  return history;
}
const STEP=Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
let nativeCalls=0;
function fakeProvider(request,options) {
  nativeCalls++;
  assert.equal(options.readCurrentRevision(),request.revision);
  assert.deepEqual(request,plateContract.parsePlateRequest(request));
  return (async()=>{
    if (request.exportStep) await writeFile(options.stepOutput,STEP,{flag:'wx'});
    const artifact=request.exportStep?{
      path:options.stepOutput,bytes:STEP.length,
      sha256:createHash('sha256').update(STEP).digest('hex'),
      verification:'same_engine_step_readback',
    }:null;
    return {kind:'experimental_report',requestId:request.requestId,
      featureId:request.featureId,revision:request.revision,
      backend:plateContract.EXPERIMENTAL_BACKEND,
      occtVersion:plateContract.EXPERIMENTAL_OCCT_VERSION,
      exactAuthority:false,independentInteroperability:false,
      observed:{source:{valid:true}},artifact};
  })();
}
async function runHost(provider,fn) {
  const host=await startLocalPlateBridge({runtime,model,plateContract,
    runExperimentalPlate:provider});
  try { await fn(host); } finally {await host.close();}
}
test('real model/sketch -> local bridge -> synthetic native stub -> verified STEP bytes and editable replay',async()=>{
  let current=plateProject();const startCalls=nativeCalls;
  await runHost(fakeProvider,async host=>{
    const opts=(requestId,exportStep=true)=>({
      url:host.url,token:host.token,runtime,
      readCurrentHistory:()=>current,cutFeatureId:'cut',requestId,exportStep,
    });
    const first=await evaluateLocalPlate(opts('bridge.first'));
    assert.equal(first.kind,'experimental_plate_evaluated',JSON.stringify(first));
    assert.equal(first.exactAuthority,false);
    assert.equal(first.independentInteroperability,false);
    assert.equal(first.result.intendedPlate.width,120);
    assert.equal(first.result.intendedPlate.thickness,8);
    assert.deepEqual(first.result.intendedPlate.holes,
      [{x:-25,y:0,radius:6},{x:25,y:0,radius:6}]);
    assert.deepEqual(Buffer.from(first.step.bytes),STEP);
    assert.equal(first.step.verification,'same_engine_step_readback');
    assert.equal(Object.hasOwn(first.result.artifact,'path'),false);
    const noExport=await evaluateLocalPlate(opts('bridge.no.step',false));
    assert.equal(noExport.kind,'experimental_plate_evaluated',JSON.stringify(noExport));
    assert.equal(noExport.step,null);
    assert.equal(noExport.result.artifact,null);
    current=runtime.commit(current,[created('create.parameter',{
      id:'parameter.t',kind:'parameter',dependsOn:[],writeTargets:[],
      payload:{parameter:{name:'thickness',unit:'mm',
        expression:{op:'literal',value:12,unit:'mm'}}},
    })]);
    current=runtime.editDimensions(current,{
      format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,
      version:dimensions.DIMENSION_BATCH_EDIT_VERSION,
      expectedRevision:current.document.revision,
      admission:'require_admissible',
      edits:[{eventId:'bind.thickness',featureId:'plate',field:'thicknessMm',
        binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.t'}}}],
    });
    current=runtime.reopen(runtime.save(current));
    const second=await evaluateLocalPlate(opts('bridge.second'));
    assert.equal(second.kind,'experimental_plate_evaluated',JSON.stringify(second));
    assert.equal(second.result.intendedPlate.thickness,12);
    assert.equal(second.source.revision,current.document.revision);
    assert.equal(nativeCalls-startCalls,3);
  });
});
test('token, Origin, HTTP method, path and browser-provided stepOutput are refused',async()=>{
  let current=plateProject();const startCalls=nativeCalls;
  await runHost(fakeProvider,async host=>{
    const env={archive:runtime.save(current),cutFeatureId:'cut',requestId:'bridge.guard',exportStep:true};
    const post=(body,headers={})=>fetch(host.url+'/v1/plate/evaluate',{
      method:'POST',headers:{'content-type':'application/json',...headers},
      body:JSON.stringify(body),
    });
    assert.equal((await post(env)).status,403);
    assert.equal((await post(env,{'x-intuit3d-token':host.token,origin:'https://evil.example'})).status,403);
    assert.equal((await post({...env,stepOutput:'/tmp/untrusted.step'},
      {'x-intuit3d-token':host.token})).status,400);
    assert.equal((await fetch(host.url+'/v1/plate/evaluate',{method:'GET'})).status,404);
    const preflight=await fetch(host.url+'/v1/plate/evaluate',{
      method:'OPTIONS',headers:{origin:'http://127.0.0.1:5173'}});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-origin'),'http://127.0.0.1:5173');
    assert.equal(nativeCalls,startCalls);
  });
});
test('browser revisions changed while provider runs cannot publish old results',async()=>{
  let current=plateProject();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const provider=async(request,options)=>{
    await gate;
    return fakeProvider(request,options);
  };
  await runHost(provider,async host=>{
    const pending=evaluateLocalPlate({url:host.url,token:host.token,
      runtime,readCurrentHistory:()=>current,
      cutFeatureId:'cut',requestId:'bridge.revision',exportStep:true});
    // Wait until host has had an opportunity to begin dispatch, then make
    // a genuine new authoritative model revision before native resolution.
    await new Promise(resolve=>setTimeout(resolve,40));
    current=runtime.commit(current,[created('new.parameter',{
      id:'param.new',kind:'parameter',dependsOn:[],writeTargets:[],
      payload:{parameter:{name:'another',unit:'mm',
        expression:{op:'literal',value:20,unit:'mm'}}},
    })]);
    release();
    const response=await pending;
    assert.equal(response.kind,'unresolved');
    assert.equal(response.code,'stale_revision');
    assert.equal(response.artifact,null);
  });
});
test('aborting the browser HTTP request cancels the in-flight trusted provider',async()=>{
  let current=plateProject();
  let started,aborted;
  const didStart=new Promise(resolve=>{started=resolve;});
  const didAbort=new Promise(resolve=>{aborted=resolve;});
  const provider=async(request,options)=>{
    started();
    if (options.signal.aborted) {
      aborted();
      return {kind:'unresolved',code:'cancelled'};
    }
    await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));
    aborted();
    return {kind:'unresolved',code:'cancelled'};
  };
  await runHost(provider,async host=>{
    const controller=new AbortController();
    const pending=evaluateLocalPlate({url:host.url,token:host.token,runtime,
      readCurrentHistory:()=>current,cutFeatureId:'cut',
      requestId:'bridge.abort',exportStep:true,signal:controller.signal});
    await didStart;
    controller.abort();
    const result=await pending;
    assert.equal(result.kind,'unresolved');
    assert.equal(result.code,'cancelled');
    await Promise.race([
      didAbort,
      new Promise((_,reject)=>setTimeout(()=>reject(Error('native cancellation was not forwarded')),1500)),
    ]);
  });
});
test('STEP client rejects corrupted bytes and remote URL before network',async()=>{
  await assert.rejects(()=>decodeVerifiedLocalStep({
    filename:'plate.step',bytes:4,sha256:'0'.repeat(64),
    verification:'same_engine_step_readback',base64:'dGVzdA==',
  }),/SHA-256/);
  await assert.rejects(()=>evaluateLocalPlate({url:'https://elsewhere.example',
    token:'0'.repeat(64),runtime,readCurrentHistory:plateProject,
    cutFeatureId:'cut',requestId:'bad.url'}),/loopback/);
});
