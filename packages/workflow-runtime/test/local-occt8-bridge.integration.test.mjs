/**
 * Real INTENT/SKETCH journal + real loopback HTTP + SYNTHETIC OCCT8 provider.
 * This qualifies the application contract and revision fences, NOT C++ geometry.
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
import {createLivePlateSession} from '../live-plate-session.mjs';
import {startLocalPinnedOcct8Bridge} from '../local-plate-bridge.mjs';
import {evaluateLocalPlate} from '../local-plate-client.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const created=(eventId,feature)=>({eventId,type:'feature.create',feature});
function plateProject(){
  let h=transactions.startUndoHistory(model.newProject('runtime.pinned.consumer'));
  return runtime.commit(h,[
    created('plate.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    created('plate.extrude',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    created('plate.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fakeStep=request=>Buffer.from('SYNTHETIC_NOT_REAL_STEP:'+JSON.stringify(request.plate));
function fakePinnedFactory(log,mutate=report=>report){
  return async(request,options)=>{
    log.push({request,options});
    assert.equal(options.workerExecutable,'/fixture/pinned-occt8');
    assert.equal(options.part21StepAudit,true);
    assert.equal(options.readCurrentRevision(),request.revision);
    const bytes=fakeStep(request);
    if(request.exportStep)await writeFile(options.stepOutput,bytes,{flag:'wx'});
    return mutate({
      kind:'experimental_report',requestId:request.requestId,
      featureId:request.featureId,revision:request.revision,
      backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
      exactAuthority:false,independentInteroperability:false,
      artifact:request.exportStep?{
        path:options.stepOutput,bytes:bytes.length,sha256:hash(bytes),
        verification:'occt8_part21_plate_subset',
      }:null,
      observed:{source:{valid:true,volumeMm3:request.plate.width*
        request.plate.depth*request.plate.thickness}},
    });
  };
}
async function withHost(provider,fn){
  const host=await startLocalPinnedOcct8Bridge({
    runtime,model,plateContract,runPinnedOcct8Plate:provider,
    workerExecutable:'/fixture/pinned-occt8',
  });
  try{await fn(host);}finally{await host.close();}
}
test('authoritative plate/hole edit -> pinned Part21 receipt -> undo/save/reopen/rebuild',async()=>{
  let current=plateProject(),calls=[];
  const session=createLivePlateSession({
    runtime,readCurrentHistory:()=>current,publishHistory:h=>{current=h;},
  });
  await withHost(fakePinnedFactory(calls),async host=>{
    const opts=id=>({url:host.url,token:host.token,requestId:id,exportStep:true});
    const before=await session.evaluate(opts('occt8.first'));
    assert.equal(before.kind,'experimental_plate_evaluated',JSON.stringify(before));
    assert.equal(before.result.backend,'OCCT-cxx-8.0.1');
    assert.equal(before.result.occtVersion,'8.0.1');
    assert.equal(before.step.verification,'occt8_part21_plate_subset');
    assert.equal(before.exactAuthority,false);
    assert.equal(before.independentInteroperability,false);
    assert.equal(session.currentStep()?.sha256,before.step.sha256);
    const save=session.save();
    const edited=await session.applyEditAndEvaluate(h=>runtime.editSketchConstraints(h,{
      sketchFeatureId:'sketch.plate',eventId:'pinned.change.bore',
      expectedRevision:h.document.revision,admission:'require_admissible',
      edits:[{constraintId:'holeA:diameter',patch:{value:5}}],
    }),opts('occt8.edited'));
    assert.equal(edited.kind,'submitted',JSON.stringify(edited));
    assert.equal(edited.evaluation.kind,'experimental_plate_evaluated');
    assert.notEqual(edited.evaluation.step.sha256,before.step.sha256);
    assert.deepEqual(edited.edit.invalidation.invalidatedFeatureIds,
      ['sketch.plate','plate','cut']);
    assert.equal(session.currentStep().verification,'occt8_part21_plate_subset');
    const bytes=session.currentStep().bytes;
    bytes.fill(0);
    assert.equal(hash(session.currentStep().bytes),edited.evaluation.step.sha256,
      'downloads must be independent buffers');
    const undone=await session.applyEditAndEvaluate(
      h=>runtime.undo(h,['occt8.undo.bore']),opts('occt8.undo'));
    assert.equal(undone.kind,'submitted');
    assert.equal(undone.evaluation.kind,'experimental_plate_evaluated');
    assert.equal(undone.evaluation.result.intendedPlate.holes[0].radius,6);
    const reopened=await session.reopenAndEvaluate(save,{
      ...opts('occt8.reopen'),confirmReplacement:true,
    });
    assert.equal(reopened.kind,'submitted');
    assert.equal(reopened.evaluation.kind,'experimental_plate_evaluated');
    assert.equal(session.save(),save);
    assert.equal(reopened.evaluation.step.sha256,before.step.sha256);
    assert.equal(calls.length,4,'one native dispatch per requested revision');
    assert.ok(calls.every(c=>c.options.part21StepAudit===true));
  });
});
test('backend impersonation, missing Part21 evidence and replaced STEP digests are refused',async()=>{
  for(const change of [
    r=>({...r,backend:'OCP-python-prototype'}),
    r=>({...r,artifact:{...r.artifact,verification:'occt8_same_engine_step_readback'}}),
    r=>({...r,artifact:{...r.artifact,sha256:'0'.repeat(64)}}),
  ]){
    const calls=[];
    await withHost(fakePinnedFactory(calls,change),async host=>{
      const h=plateProject();
      const out=await evaluateLocalPlate({url:host.url,token:host.token,runtime,
        readCurrentHistory:()=>h,cutFeatureId:'cut',
        requestId:'occt8.reject',exportStep:true});
      assert.equal(out.kind,'unresolved',JSON.stringify(out));
      assert.equal(out.exactAuthority,false);
      assert.equal(out.independentInteroperability,false);
      assert.equal(calls.length,1);
    });
  }
});
test('host source SHA mismatch is refused, despite identical project and revision',async()=>{
  const calls=[];
  await withHost(fakePinnedFactory(calls),async host=>{
    const h=plateProject();
    const result=await evaluateLocalPlate({url:host.url,token:host.token,runtime,
      readCurrentHistory:()=>h,cutFeatureId:'cut',
      requestId:'occt8.wrong.archive',exportStep:true,
      fetchImpl:async(url,opts)=>{
        const response=await fetch(url,opts);
        const envelope=await response.json();
        return {ok:response.ok,json:async()=>({...envelope,source:{
          ...envelope.source,archiveSha256:'0'.repeat(64),
        }})};
      },
    });
    assert.equal(result.kind,'unresolved');
    assert.equal(result.code,'invalid_host_reply');
    assert.equal(result.artifact,null);
    assert.equal(calls.length,1);
  });
});
test('trusted host must choose native worker and pinned audit, not browser',async()=>{
  await assert.rejects(()=>startLocalPinnedOcct8Bridge({
    runtime,model,plateContract,runPinnedOcct8Plate:async()=>({}),
    workerExecutable:'relative/worker',
  }),/absolute worker path/);
  await assert.rejects(()=>startLocalPinnedOcct8Bridge({
    runtime,model,plateContract,runPinnedOcct8Plate:async()=>({}),
    workerExecutable:'/fixture/pinned-occt8',providerKind:'ocp',
  }),/override provider identity/);
});
