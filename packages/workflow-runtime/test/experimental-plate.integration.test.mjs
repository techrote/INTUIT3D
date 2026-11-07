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
