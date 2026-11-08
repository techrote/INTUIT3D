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
import {evaluateLocalPlate,decodeVerifiedLocalStep,inspectLocalPlateBridge} from '../local-plate-client.mjs';

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

test('authenticated provider pairing refuses experimental fallback before starting native work',async()=>{
  const before=nativeCalls;
  const current=plateProject();
  await runHost(fakeProvider,async host=>{
    const identity=await inspectLocalPlateBridge({url:host.url,token:host.token});
    assert.equal(identity.kind,'paired',JSON.stringify(identity));
    assert.equal(identity.backend,'OCP-python-prototype');
    assert.equal(identity.occtVersion,'7.9.3.1');
    assert.equal(identity.stepVerification,'same_engine_step_readback');
    assert.equal(identity.exactAuthority,false);
    assert.equal(identity.independentInteroperability,false);
    const rejected=await evaluateLocalPlate({
      url:host.url,token:host.token,runtime,readCurrentHistory:()=>current,
      cutFeatureId:'cut',requestId:'must.be.pinned',exportStep:true,
      requiredBackend:'OCCT-cxx-8.0.1',
    });
    assert.equal(rejected.kind,'unresolved');
    assert.equal(rejected.code,'provider_mismatch');
    assert.equal(nativeCalls,before,'wrong provider must never execute a native job');
    const noToken=await fetch(host.url+'/v1/plate/capabilities');
    assert.equal(noToken.status,403,'native provider identity requires host pairing');
    const wrongOrigin=await fetch(host.url+'/v1/plate/capabilities',{
      headers:{'x-intuit3d-token':host.token,origin:'https://outside.example'},
    });
    assert.equal(wrongOrigin.status,403);
    const allowed=await fetch(host.url+'/v1/plate/capabilities',{
      method:'OPTIONS',headers:{origin:'http://127.0.0.1:5173'},
    });
    assert.equal(allowed.status,204);
    assert.match(allowed.headers.get('access-control-allow-methods'),/GET/);
    const original=await evaluateLocalPlate({
      url:host.url,token:host.token,runtime,readCurrentHistory:()=>current,
      cutFeatureId:'cut',requestId:'explicit.ocp',exportStep:true,
      requiredBackend:'OCP-python-prototype',
    });
    assert.equal(original.kind,'experimental_plate_evaluated',JSON.stringify(original));
    assert.equal(original.exactAuthority,false);
    assert.equal(nativeCalls,before+1);
  });
});


test('trusted native host deadline releases a hung provider without publishing a late STEP',async()=>{
  // This is a deliberately non-cooperative native TEST DOUBLE. It models a
  // child that ignores cancellation; it does not qualify pinned OCCT geometry.
  const current=plateProject();
  let release,started,firstSignal,calls=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});
  const provider=async(request,options)=>{
    calls++;
    if(calls===1) {
      firstSignal=options.signal;
      started();
      await gate;
      return {kind:'unresolved',code:'late_ignored_cancellation'};
    }
    return fakeProvider(request,options);
  };
  const host=await startLocalPlateBridge({
    runtime,model,plateContract,runExperimentalPlate:provider,timeoutMs:100,
  });
  const evaluate=id=>evaluateLocalPlate({
    url:host.url,token:host.token,runtime,
    readCurrentHistory:()=>current,cutFeatureId:'cut',requestId:id,
    exportStep:true,
  });
  const bounded=(promise)=>Promise.race([promise,new Promise((_,reject)=>
    setTimeout(()=>reject(Error('local native host failed to recover')),1800))]);
  try {
    const pending=evaluate('host.hung.old');
    await entered;
    const timedOut=await bounded(pending);
    assert.equal(timedOut.kind,'unresolved');
    assert.equal(timedOut.code,'timeout',JSON.stringify(timedOut));
    assert.equal(firstSignal.aborted,true,
      'the host watchdog must signal the original native provider');
    const recovered=await bounded(evaluate('host.recovered.new'));
    assert.equal(recovered.kind,'experimental_plate_evaluated',JSON.stringify(recovered));
    assert.deepEqual(Buffer.from(recovered.step.bytes),STEP);
    assert.equal(calls,2,'second evaluation must not be blocked by the hung first provider');
    release();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(Buffer.from(recovered.step.bytes),STEP,
      'late abandoned worker must not replace the recovered STEP');
  } finally {
    release();
    await host.close();
  }
});

test('disconnected browser cannot permanently occupy trusted native slot',async()=>{
  const current=plateProject();
  let started,release,calls=0,abandonedSignal;
  const entered=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const provider=async(request,options)=>{
    calls++;
    if(calls===1){
      abandonedSignal=options.signal;
      started();
      await gate; // Ignores aborted signal until explicitly released.
      return {kind:'unresolved',code:'late_disconnected'};
    }
    return fakeProvider(request,options);
  };
  const host=await startLocalPlateBridge({
    runtime,model,plateContract,runExperimentalPlate:provider,timeoutMs:5000,
  });
  const opts=(id,signal)=>({
    url:host.url,token:host.token,runtime,readCurrentHistory:()=>current,
    cutFeatureId:'cut',requestId:id,exportStep:true,...(signal?{signal}:{}),
  });
  try {
    const controller=new AbortController();
    const pending=evaluateLocalPlate(opts('host.disconnected.old',controller.signal));
    await entered;
    controller.abort();
    const cancelled=await pending;
    assert.equal(cancelled.kind,'unresolved');
    assert.equal(cancelled.code,'cancelled');
    let recovered;
    // Socket-close admission can race the replacement connection; the
    // consumer's bounded busy retry accommodates that legitimate handoff.
    for(let i=0;i<12;i++) {
      recovered=await Promise.race([
        evaluateLocalPlate(opts('host.disconnected.recover.'+i)),
        new Promise((_,reject)=>setTimeout(()=>
          reject(Error('disconnected native slot remained blocked')),1500)),
      ]);
      if(recovered.code!=='busy') break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(abandonedSignal.aborted,true);
    assert.equal(recovered.kind,'experimental_plate_evaluated',JSON.stringify(recovered));
    assert.equal(calls,2);
    assert.deepEqual(Buffer.from(recovered.step.bytes),STEP);
  } finally {
    release();
    await host.close();
  }
});
