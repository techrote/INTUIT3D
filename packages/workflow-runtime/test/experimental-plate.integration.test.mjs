/** Actual model, sketch, and kernel *contract*; provider is deliberately stubbed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {createWorkflowRuntime} from '../index.mjs';
import {createExperimentalPlateWorkflow} from '../experimental-plate.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const created=(eventId,feature)=>({eventId,type:'feature.create',feature});
function plateProject(){
  let history=transactions.startUndoHistory(model.newProject('runtime.native_plate_replay'));
  history=runtime.commit(history,[
    created('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:sketch.plateSketchFixture()}}),
    created('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    created('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
  return history;
}
test('real INTENT/SKETCH plate and holes become valid KERNEL request, not native evidence',async()=>{
  let history=plateProject(); const calls=[];
  const flow=createExperimentalPlateWorkflow({runtime,model,plateContract,
    runExperimentalPlate:async (request,options)=>{
      calls.push(request);
      assert.equal(options.readCurrentRevision(),history.document.revision);
      assert.deepEqual(request,plateContract.parsePlateRequest(request));
      return {kind:'unresolved',code:'worker_crash',artifact:null}; // explicitly NOT native
    }});
  const run=()=>flow.evaluate(history,{cutFeatureId:'cut',requestId:'plate.native.1',readCurrentHistory:()=>history});
  assert.equal((await run()).code,'worker_crash');
  assert.deepEqual(calls[0].plate,{width:120,depth:80,thickness:8,
    holes:[{x:-25,y:0,radius:6},{x:25,y:0,radius:6}]});
  history=runtime.commit(history,[created('create.parameter',{id:'parameter.t',kind:'parameter',
    dependsOn:[],writeTargets:[],payload:{parameter:{name:'thickness',unit:'mm',
      expression:{op:'literal',value:11,unit:'mm'}}}})]);
  history=runtime.editDimensions(history,{format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,
    version:dimensions.DIMENSION_BATCH_EDIT_VERSION,
    expectedRevision:history.document.revision,admission:'require_admissible',
    edits:[{eventId:'bind.thickness',featureId:'plate',field:'thicknessMm',
      binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.t'}}}]});
  history=runtime.reopen(runtime.save(history));
  assert.equal((await run()).code,'worker_crash');
  assert.equal(calls.at(-1).plate.thickness,11);
  const broken=sketch.editConstraint(sketch.plateSketchFixture(),'width',{value:90});
  history=runtime.commit(history,[{eventId:'edit.sketch.invalid',type:'feature.edit',
    featureId:'sketch.plate',patch:{payload:{sketch:broken}}}]);
  assert.equal((await run()).code,'source_unavailable');
  assert.equal(calls.length,2);
});

test('native reply is refused after a different same-revision journal replaces the authoritative archive',async()=>{
  const original=plateProject();
  // Distinct event identities, but identical semantic features, dimensions and
  // source project/revision. Native cannot treat an equal feature *report* as
  // proof that the user still has the original persistent history open.
  const divergent=runtime.commit(
    transactions.startUndoHistory(model.newProject('runtime.native_plate_replay')),[
      created('alternate.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
        payload:{sketch:sketch.plateSketchFixture()}}),
      created('alternate.extrude',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
        writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
      created('alternate.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
        writeTargets:['body.plate'],
        payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
    ]);
  assert.equal(original.document.projectId,divergent.document.projectId);
  assert.equal(original.document.revision,divergent.document.revision);
  assert.deepEqual(runtime.inspect(original),runtime.inspect(divergent),
    'the publicly evaluated geometry report is unchanged');
  assert.notEqual(runtime.save(original),runtime.save(divergent),
    'the actual source archives have different history/event identities');
  let current=original,dispatched=0;
  const flow=createExperimentalPlateWorkflow({runtime,model,plateContract,
    runExperimentalPlate:async(request,options)=>{
      dispatched++;
      assert.equal(options.readCurrentRevision(),request.revision);
      current=divergent;
      assert.notEqual(options.readCurrentRevision(),request.revision,
        'the native progress fence must detect equal-revision journal substitution');
      // A positive, correctly shaped native report was previously accepted
      // for the wrong same-revision archive by a feature-report-only fence.
      return {kind:'experimental_report',
        requestId:request.requestId,featureId:request.featureId,
        revision:request.revision,
        backend:plateContract.EXPERIMENTAL_BACKEND,
        occtVersion:plateContract.EXPERIMENTAL_OCCT_VERSION,
        exactAuthority:false,independentInteroperability:false,
        observed:{source:{valid:true}},artifact:null};

    }});
  const outcome=await flow.evaluate(original,{
    cutFeatureId:'cut',requestId:'plate.alternate.archive',
    readCurrentHistory:()=>current,
  });
  assert.equal(dispatched,1);
  assert.equal(outcome.code,'stale_revision');
  assert.equal(outcome.artifact,null);
});

test('real archived multi-body INTENT refuses partial STEP; undo restores one-body eligibility',async()=>{
  let history=plateProject(),calls=0;
  const flow=createExperimentalPlateWorkflow({runtime,model,plateContract,
    runExperimentalPlate:async request=>{
      calls++;
      assert.deepEqual(request,plateContract.parsePlateRequest(request));
      return {kind:'unresolved',code:'worker_crash',artifact:null};
    }});
  const evaluate=()=>flow.evaluate(history,{cutFeatureId:'cut',
    requestId:'native.multibody.1',exportStep:true,
    readCurrentHistory:()=>history});
  assert.equal((await evaluate()).code,'worker_crash');
  assert.equal(calls,1,'original single plate is still dispatched');

  const before=runtime.save(history);
  history=runtime.commit(history,[
    created('second.sketch.event',{id:'sketch.second',kind:'sketch',
      dependsOn:[],writeTargets:[],
      payload:{sketch:sketch.plateSketchFixture()}}),
    created('second.extrude.event',{id:'extrude.second',kind:'extrude',
      dependsOn:['sketch.second'],writeTargets:['body.second'],
      payload:{sourceSketchId:'sketch.second',thicknessMm:6}}),
  ]);
  assert.equal(model.featuresOf(history.document).filter(f=>f.kind==='extrude').length,2);
  history=runtime.reopen(runtime.save(history));
  const blocked=await evaluate();
  assert.equal(blocked.kind,'unresolved');
  assert.equal(blocked.code,'unsupported_feature');
  assert.deepEqual(blocked.unsupportedFeatureIds,['extrude.second']);
  assert.equal(blocked.artifact,null);
  assert.equal(calls,1,'a second authored body never produces a misleading one-body STEP');

  history=runtime.undo(history,['undo.second.extrude','undo.second.sketch']);
  assert.equal(model.featuresOf(history.document).filter(f=>f.kind==='extrude').length,1);
  assert.equal((await evaluate()).code,'worker_crash');
  assert.equal(calls,2,'undo removing the second body restores native eligibility');
  history=runtime.reopen(before);
  assert.equal((await evaluate()).code,'worker_crash');
  assert.equal(calls,3,'reopened original archive remains native-eligible');
});
