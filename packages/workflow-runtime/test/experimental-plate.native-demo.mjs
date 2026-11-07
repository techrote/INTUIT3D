/**
 * Explicit native qualification: npm run demo:native --workspace @intuit3d/workflow-runtime
 * Requires pinned Python/OCP research dependency; never run in the browser.
 */
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {runExperimentalPlate} from '@intuit3d/kernel-contract/local-plate-provider';
import {createWorkflowRuntime} from '../index.mjs';
import {createExperimentalPlateWorkflow} from '../experimental-plate.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const workflow=createExperimentalPlateWorkflow({runtime,model,plateContract,runExperimentalPlate});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
let current=transactions.startUndoHistory(model.newProject('runtime.native.demo'));
current=runtime.commit(current,[
  create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:sketch.plateSketchFixture()}}),
  create('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
    writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
  create('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],writeTargets:['body.plate'],
    payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
]);
const folder=await mkdtemp(join(tmpdir(),'intuit3d-workflow-native-'));
try {
  const evaluate=async (id,path)=>{
    const res=await workflow.evaluate(current,{cutFeatureId:'cut',requestId:id,
      readCurrentHistory:()=>current,exportStep:true,stepOutput:join(folder,path),timeoutMs:45000});
    assert.equal(res.kind,'experimental_plate_evaluated',JSON.stringify(res));
    assert.equal(res.exactAuthority,false);
    assert.equal(res.independentInteroperability,false);
    const bytes=await readFile(res.artifact.path);
    assert.ok(bytes.length>0);
    return {revision:res.revision,plate:res.intendedPlate,artifact:res.artifact,
      backend:res.backend,occtVersion:res.occtVersion};
  };
  const first=await evaluate('plate.native.first','first.step');
  current=runtime.commit(current,[create('create.parameter',{id:'parameter.t',kind:'parameter',
    dependsOn:[],writeTargets:[],payload:{parameter:{name:'thickness',unit:'mm',
      expression:{op:'literal',value:10,unit:'mm'}}}})]);
  current=runtime.editDimensions(current,{format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,
    version:dimensions.DIMENSION_BATCH_EDIT_VERSION,admission:'require_admissible',
    expectedRevision:current.document.revision,
    edits:[{eventId:'bind.thickness',featureId:'plate',field:'thicknessMm',
      binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.t'}}}]});
  current=runtime.reopen(runtime.save(current));
  const second=await evaluate('plate.native.second','second.step');
  assert.equal(first.plate.thickness,8);
  assert.equal(second.plate.thickness,10);
  assert.notEqual(first.artifact.sha256,second.artifact.sha256);
  const edited=runtime.editSketchConstraints(current,{
    sketchFeatureId:'sketch.plate',eventId:'edit.native.holes',
    expectedRevision:current.document.revision,
    admission:'require_admissible',
    edits:[
      {constraintId:'holeA:diameter',patch:{value:5}},
      {constraintId:'holeB:diameter',patch:{value:5}},
    ],
  });
  assert.equal(edited.kind,'committed',JSON.stringify(edited));
  current=runtime.reopen(runtime.save(edited.history));
  const changedHoles=await evaluate('plate.native.changed.holes','changed-holes.step');
  assert.deepEqual(changedHoles.plate.holes.map(h=>h.radius),[5,5]);
  assert.notEqual(changedHoles.artifact.sha256,second.artifact.sha256);

  current=runtime.reopen(runtime.save(runtime.undo(current,['undo.native.holes'])));
  const undoneHoles=await evaluate('plate.native.undo.holes','undone-holes.step');
  assert.deepEqual(undoneHoles.plate.holes.map(h=>h.radius),[6,6]);
  assert.ok(changedHoles.artifact.sha256!==undoneHoles.artifact.sha256);
  current=runtime.reopen(runtime.save(runtime.redo(current,['redo.native.holes'])));
  assert.deepEqual(runtime.inspect(current).features
    .find(f=>f.featureId==='plate').profile.holes.map(h=>h.radius),[5,5]);
  console.log(JSON.stringify({status:'experimental_native_pass',first,second,
    changedHoles,undoneHoles,redoAdmitted:true,
    independentStep:false,productionExact:false},null,2));
} finally {await rm(folder,{recursive:true,force:true});}
