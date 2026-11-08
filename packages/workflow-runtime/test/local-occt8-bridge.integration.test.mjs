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
import {evaluateLocalPlate,inspectLocalPlateBridge} from '../local-plate-client.mjs';

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
      part21Audit:request.exportStep?{
        kind:'part21-plate-structural-v1',sha256:hash(bytes),
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
    assert.deepEqual(before.result.part21Audit,{
      kind:'part21-plate-structural-v1',sha256:before.step.sha256,
    });
    assert.equal(before.exactAuthority,false);
    assert.equal(before.independentInteroperability,false);
    assert.equal(session.currentStep()?.sha256,before.step.sha256);
    const receipt=session.currentStepReceipt({requiredBackend:'OCCT-cxx-8.0.1'});
    assert.equal(receipt.format,'intuit3d.source-bound-step-receipt');
    assert.equal(receipt.version,1);
    assert.deepEqual(receipt.source,before.source);
    assert.equal(receipt.producer.requestId,'occt8.first');
    assert.equal(receipt.producer.cutFeatureId,'cut');
    assert.equal(receipt.producer.backend,'OCCT-cxx-8.0.1');
    assert.equal(receipt.producer.occtVersion,'8.0.1');
    assert.equal(receipt.step.sha256,before.step.sha256);
    assert.equal(hash(receipt.step.bytes),receipt.step.sha256);
    assert.equal(receipt.exactAuthority,false);
    assert.equal(receipt.independentInteroperability,false);
    assert.equal(session.currentStepReceipt({requiredBackend:'OCP-python-prototype'}),null);
    // Caller-owned response mutation must never change the retained proof.
    before.source.archiveSha256='0'.repeat(64);
    before.result.artifact.sha256='0'.repeat(64);
    before.step.bytes.fill(0);
    assert.deepEqual(session.currentStepReceipt().source,receipt.source);
    assert.equal(hash(session.currentStepReceipt().step.bytes),receipt.step.sha256);
    const save=session.save();
    const edited=await session.applyEditAndEvaluate(h=>runtime.editSketchConstraints(h,{
      sketchFeatureId:'sketch.plate',eventId:'pinned.change.bore',
      expectedRevision:h.document.revision,admission:'require_admissible',
      edits:[{constraintId:'holeA:diameter',patch:{value:5}}],
    }),opts('occt8.edited'));
    assert.equal(edited.kind,'submitted',JSON.stringify(edited));
    assert.equal(edited.evaluation.kind,'experimental_plate_evaluated');
    assert.notEqual(edited.evaluation.step.sha256,before.step.sha256);
    assert.equal(session.currentStepReceipt()?.source.revision,
      edited.edit.history.document.revision);
    assert.equal(session.currentStepReceipt()?.producer.requestId,'occt8.edited');
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
    assert.equal(session.currentStepReceipt()?.source.archiveSha256,
      hash(Buffer.from(save,'utf8')));
    assert.equal(session.currentStepReceipt()?.producer.requestId,'occt8.reopen');
    assert.equal(calls.length,4,'one native dispatch per requested revision');
    assert.ok(calls.every(c=>c.options.part21StepAudit===true));
  });
});
test('single-click archive/receipt/STEP custody survives undo but rejects stale or wrong backend',async()=>{
  let current=plateProject(),calls=[];
  const session=createLivePlateSession({
    runtime,readCurrentHistory:()=>current,publishHistory:h=>{current=h;},
  });
  const options=id=>({requestId:id,exportStep:true,requiredBackend:'OCCT-cxx-8.0.1'});
  await withHost(fakePinnedFactory(calls),async host=>{
    const evaluate=id=>session.evaluate({...options(id),url:host.url,token:host.token});
    assert.equal(session.captureCurrentStepEvidence(),null,'no native STEP yet');
    assert.equal((await evaluate('capture.initial')).kind,'experimental_plate_evaluated');
    const first=session.captureCurrentStepEvidence();
    assert.equal(first.format,'intuit3d.current-step-evidence-capture');
    assert.equal(first.archive,session.save());
    assert.equal(first.receipt.format,'intuit3d.source-bound-step-receipt');
    assert.equal(hash(Buffer.from(first.archive,'utf8')),first.receipt.source.archiveSha256);
    assert.equal(hash(first.stepBytes),first.receipt.step.sha256);
    assert.equal(first.receipt.producer.requestId,'capture.initial');
    assert.deepEqual(Object.keys(first.receipt.step).sort(),
      ['filename','sha256','verification']);
    assert.equal(JSON.stringify(first.receipt).includes('SYNTHETIC_NOT_REAL_STEP'),false);
    assert.equal(first.exactAuthority,false);
    assert.equal(first.independentInteroperability,false);
    assert.equal(session.captureCurrentStepEvidence({requiredBackend:'OCP-python-prototype'}),null);
    first.stepBytes.fill(0);
    assert.equal(hash(session.captureCurrentStepEvidence().stepBytes),
      first.receipt.step.sha256,'capture buffers must not mutate retained STEP');
    const oldArchive=first.archive,oldRevision=first.receipt.source.revision;
    const edit=session.applyEdit(h=>runtime.commit(h,[{
      eventId:'capture.thickness.12',type:'feature.edit',featureId:'plate',
      patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}},
    }]));
    assert.equal(edit.kind,'committed');
    assert.equal(session.captureCurrentStepEvidence(),null,'stale STEP must not export');
    assert.equal((await evaluate('capture.edited')).kind,'experimental_plate_evaluated');
    const updated=session.captureCurrentStepEvidence();
    assert.ok(updated.receipt.source.revision>oldRevision);
    assert.notEqual(updated.receipt.source.archiveSha256,first.receipt.source.archiveSha256);
    assert.notEqual(updated.receipt.step.sha256,first.receipt.step.sha256);
    assert.equal(hash(Buffer.from(updated.archive,'utf8')),
      updated.receipt.source.archiveSha256);
    assert.equal(hash(updated.stepBytes),updated.receipt.step.sha256);
    const undone=session.applyEdit(h=>runtime.undo(h,['capture.undo']));
    assert.equal(undone.kind,'committed');
    assert.equal(session.captureCurrentStepEvidence(),null,'undo revokes native receipt');
    assert.equal(session.reopen(oldArchive).kind,'refused');
    assert.equal(session.captureCurrentStepEvidence(),null);
    assert.equal(session.reopen(oldArchive,{confirmReplacement:true}).kind,'opened');
    assert.equal(session.captureCurrentStepEvidence(),null,'reopen requires native rebuild');
    assert.equal((await evaluate('capture.reopened')).kind,'experimental_plate_evaluated');
    const reopened=session.captureCurrentStepEvidence();
    assert.equal(reopened.archive,oldArchive);
    assert.equal(reopened.receipt.step.sha256,first.receipt.step.sha256);
    assert.equal(reopened.receipt.producer.requestId,'capture.reopened');
    assert.equal(calls.length,3,'exactly three explicit native dispatches');
  });
});
test('source-bound STEP revoked immediately after edit and archive replacement',async()=>{
  let current=plateProject();
  const session=createLivePlateSession({
    runtime,readCurrentHistory:()=>current,publishHistory:h=>{current=h;},
  });
  await withHost(fakePinnedFactory([]),async host=>{
    const opts=id=>({url:host.url,token:host.token,requestId:id,
      exportStep:true,requiredBackend:'OCCT-cxx-8.0.1'});
    const initial=await session.evaluate(opts('receipt.before'));
    assert.equal(initial.kind,'experimental_plate_evaluated');
    const saved=session.save();
    assert.ok(session.currentStepReceipt({requiredBackend:'OCCT-cxx-8.0.1'}));
    const changed=session.applyEdit(h=>runtime.commit(h,[{
      eventId:'receipt.thickness.change',type:'feature.edit',featureId:'plate',
      patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}},
    }]));
    assert.equal(changed.kind,'committed');
    assert.equal(session.currentStepReceipt(),null);
    assert.equal(session.currentStep(),null);
    const altered=await session.evaluate(opts('receipt.after'));
    assert.equal(altered.kind,'experimental_plate_evaluated');
    assert.notEqual(altered.step.sha256,initial.step.sha256);
    assert.equal(session.currentStepReceipt().producer.requestId,'receipt.after');
    assert.equal(session.currentStepReceipt().source.revision,current.document.revision);
    assert.equal(session.reopen(saved,{confirmReplacement:true}).kind,'opened');
    assert.equal(session.currentStepReceipt(),null,
      'reopening previous source cannot revive a discarded STEP');
    const rebuilt=await session.evaluate(opts('receipt.rebuilt'));
    assert.equal(rebuilt.kind,'experimental_plate_evaluated');
    assert.equal(session.currentStepReceipt().step.sha256,initial.step.sha256);
    assert.equal(session.currentStepReceipt().source.archiveSha256,
      hash(Buffer.from(saved,'utf8')));
  });
});
test('backend impersonation, missing Part21 evidence and replaced STEP digests are refused',async()=>{
  for(const change of [
    r=>({...r,backend:'OCP-python-prototype'}),
    r=>({...r,part21Audit:null}),
    r=>({...r,part21Audit:{...r.part21Audit,sha256:'0'.repeat(64)}}),
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


test('solved two-hole layout resize is one native revision, reversible and replayed from archive',async()=>{
  let current=plateProject();
  const calls=[];
  const session=createLivePlateSession({
    runtime,readCurrentHistory:()=>current,publishHistory:h=>{current=h;},
  });
  await withHost(fakePinnedFactory(calls),async host=>{
    const options=requestId=>({url:host.url,token:host.token,requestId,exportStep:true});
    const initialArchive=session.save();
    const initial=await session.evaluate(options('occt8.layout.original'));
    assert.equal(initial.kind,'experimental_plate_evaluated');
    assert.deepEqual(initial.result.intendedPlate.holes.map(h=>[h.x,h.y,h.radius]),
      [[-25,0,6],[25,0,6]]);
    const updated=await session.applyEditAndEvaluate(h=>runtime.resizePlateHoleLayout(h,{
      sketchFeatureId:'sketch.plate',eventId:'occt8.layout.resize',
      expectedRevision:h.document.revision,admission:'require_admissible',
      holeIds:['holeA','holeB'],pivotXmm:60,pivotYmm:40,
      scaleX:0.8,scaleY:1,radiusScale:0.75,
    }),options('occt8.layout.resized'));
    assert.equal(updated.kind,'submitted',JSON.stringify(updated));
    assert.equal(updated.evaluation.kind,'experimental_plate_evaluated');
    assert.deepEqual(updated.edit.invalidation.invalidatedFeatureIds,
      ['sketch.plate','plate','cut']);
    assert.deepEqual(updated.evaluation.result.intendedPlate.holes.map(h=>[h.x,h.y,h.radius]),
      [[-20,0,4.5],[20,0,4.5]]);
    assert.notEqual(updated.evaluation.step.sha256,initial.step.sha256);
    assert.equal(session.currentStep()?.sha256,updated.evaluation.step.sha256);
    const resizedArchive=session.save();
    assert.notEqual(resizedArchive,initialArchive);
    const undone=await session.applyEditAndEvaluate(
      h=>runtime.undo(h,['occt8.layout.undo']),options('occt8.layout.undone'));
    assert.equal(undone.kind,'submitted');
    assert.equal(undone.evaluation.kind,'experimental_plate_evaluated');
    assert.equal(undone.evaluation.step.sha256,initial.step.sha256);
    const restored=await session.reopenAndEvaluate(resizedArchive,{
      ...options('occt8.layout.reopened'),confirmReplacement:true,
    });
    assert.equal(restored.kind,'submitted');
    assert.equal(restored.evaluation.step.sha256,updated.evaluation.step.sha256);
    assert.equal(session.save(),resizedArchive);
    const reopenedInitial=await session.reopenAndEvaluate(initialArchive,{
      ...options('occt8.layout.initial.reopened'),confirmReplacement:true,
    });
    assert.equal(reopenedInitial.kind,'submitted');
    assert.equal(reopenedInitial.evaluation.step.sha256,initial.step.sha256);
    assert.equal(session.save(),initialArchive);
    assert.equal(calls.length,5);
    assert.ok(calls.every(x=>x.options.part21StepAudit===true));
  });
});

test('actual INTENT/SKETCH revision edit revokes obsolete independent STEP source',async()=>{
  const {verifyCurrentLivePlateStep}=await import('../nonocct-step-probe.mjs');
  let current=plateProject();
  const calls=[];
  const session=createLivePlateSession({
    runtime,readCurrentHistory:()=>current,publishHistory:h=>{current=h;},
  });
  await withHost(fakePinnedFactory(calls),async host=>{
    const original=await session.evaluate({
      url:host.url,token:host.token,requestId:'occt8.external.original',exportStep:true,
    });
    assert.equal(original.kind,'experimental_plate_evaluated');
    const edit=session.applyEdit(h=>runtime.resizePlateHoleLayout(h,{
      sketchFeatureId:'sketch.plate',eventId:'occt8.external.edit',
      expectedRevision:h.document.revision,admission:'require_admissible',
      holeIds:['holeA','holeB'],pivotXmm:60,pivotYmm:40,
      scaleX:0.8,scaleY:1,radiusScale:0.75,
    }));
    assert.equal(edit.kind,'committed');
    assert.equal(session.currentStep(),null);
    await assert.rejects(()=>verifyCurrentLivePlateStep({
      session,evaluation:original,probeExecutable:'/not/run',
      expectedProbeSha256:'a'.repeat(64),
    }),/stale live CAD revision/);
    assert.equal(calls.length,1,'stale external check never starts a native rebuild');
  });
});

test('pinned C++ pairing identifies configured host and guards live session evaluation',async()=>{
  const calls=[],current=plateProject();
  const session=createLivePlateSession({
    runtime,readCurrentHistory:()=>current,publishHistory:()=>{},
  });
  await withHost(fakePinnedFactory(calls),async host=>{
    const identity=await inspectLocalPlateBridge({url:host.url,token:host.token});
    assert.equal(identity.kind,'paired',JSON.stringify(identity));
    assert.equal(identity.backend,'OCCT-cxx-8.0.1');
    assert.equal(identity.occtVersion,'8.0.1');
    assert.equal(identity.stepVerification,'occt8_part21_plate_subset');
    const result=await session.evaluate({
      url:host.url,token:host.token,requestId:'pinned.only.native',
      exportStep:true,requiredBackend:'OCCT-cxx-8.0.1',
    });
    assert.equal(result.kind,'experimental_plate_evaluated',JSON.stringify(result));
    assert.equal(session.currentStep()?.verification,'occt8_part21_plate_subset');
    assert.equal(result.exactAuthority,false);
    assert.equal(calls.length,1);
    const refused=await session.evaluate({
      url:host.url,token:host.token,requestId:'wrong.expected.native',
      exportStep:true,requiredBackend:'OCP-python-prototype',
    });
    assert.equal(refused.kind,'unresolved');
    assert.equal(refused.code,'provider_mismatch');
    assert.equal(calls.length,1,'wrong backend cannot launch a C++ request');
    assert.equal(session.currentStep()?.sha256,result.step.sha256,
      'refused same-revision backend switch preserves already verified bytes');
  });
});
test('a misleading capability handshake cannot override the actual provider reply',async()=>{
  const current=plateProject(),calls=[];
  await withHost(fakePinnedFactory(calls),async host=>{
    const spoof=async(url,options)=>{
      const response=await fetch(url,options);
      if(!url.endsWith('/v1/plate/capabilities')) return response;
      const payload=await response.json();
      return {
        ok:response.ok,
        json:async()=>({...payload,backend:'OCP-python-prototype',
          occtVersion:'7.9.3.1',stepVerification:'same_engine_step_readback'}),
      };
    };
    const out=await evaluateLocalPlate({
      url:host.url,token:host.token,runtime,readCurrentHistory:()=>current,
      cutFeatureId:'cut',requestId:'spoofed.provider',exportStep:true,
      requiredBackend:'OCCT-cxx-8.0.1',fetchImpl:spoof,
    });
    assert.equal(out.kind,'unresolved');
    assert.equal(out.code,'provider_mismatch');
    assert.equal(calls.length,0);
  });
});
