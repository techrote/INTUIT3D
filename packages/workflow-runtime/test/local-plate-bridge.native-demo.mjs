/**
 * One-command REAL experimental native/HTTP test:
 * npm run demo:bridge --workspace @intuit3d/workflow-runtime
 * Requires pinned Linux Python/OCP 7.9.3.1.1. This is NOT production exactness
 * or independent STEP interoperability.
 */
import assert from 'node:assert/strict';
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
import {startLocalPlateBridge} from '../local-plate-bridge.mjs';
import {evaluateLocalPlate} from '../local-plate-client.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const created=(eventId,feature)=>({eventId,type:'feature.create',feature});
let current=transactions.startUndoHistory(model.newProject('runtime.native_bridge_demo'));
current=runtime.commit(current,[
  created('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:sketch.plateSketchFixture()}}),
  created('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
    writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
  created('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],writeTargets:['body.plate'],
    payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
]);
const host=await startLocalPlateBridge({runtime,model,plateContract,runExperimentalPlate,
  timeoutMs:45000});
try {
  const evaluate=async requestId=>{
    const out=await evaluateLocalPlate({url:host.url,token:host.token,runtime,
      readCurrentHistory:()=>current,cutFeatureId:'cut',requestId,exportStep:true});
    assert.equal(out.kind,'experimental_plate_evaluated',JSON.stringify(out));
    assert.ok(out.step.bytes.length>0);
    assert.equal(out.exactAuthority,false);
    assert.equal(out.independentInteroperability,false);
    return {revision:out.source.revision,plate:out.result.intendedPlate,
      sha256:out.step.sha256,bytes:out.step.bytes.length,
      volumeMm3:out.result.observed.source.volumeMm3,
      backend:out.result.backend,occtVersion:out.result.occtVersion};
  };
  const first=await evaluate('bridge.native.first');
  current=runtime.commit(current,[created('create.parameter',{id:'parameter.t',
    kind:'parameter',dependsOn:[],writeTargets:[],
    payload:{parameter:{name:'thickness',unit:'mm',
      expression:{op:'literal',value:10,unit:'mm'}}}})]);
  current=runtime.editDimensions(current,{
    format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,
    version:dimensions.DIMENSION_BATCH_EDIT_VERSION,
    expectedRevision:current.document.revision,
    admission:'require_admissible',
    edits:[{eventId:'bind.thickness',featureId:'plate',field:'thicknessMm',
      binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.t'}}}],
  });
  current=runtime.reopen(runtime.save(current));
  const second=await evaluate('bridge.native.second');
  assert.equal(first.plate.thickness,8);
  assert.equal(second.plate.thickness,10);
  assert.notEqual(first.sha256,second.sha256);
  assert.ok(second.volumeMm3>first.volumeMm3);

  // An actual user edit to BOTH hole constraints is now one revision-fenced,
  // undoable INTENT event via the public SKETCH-backed runtime API.
  const edited=runtime.editSketchConstraints(current,{
    sketchFeatureId:'sketch.plate',eventId:'edit.bridge.holes',
    expectedRevision:current.document.revision,
    admission:'require_admissible',
    edits:[
      {constraintId:'holeA:diameter',patch:{value:5}},
      {constraintId:'holeB:diameter',patch:{value:5}},
    ],
  });
  assert.equal(edited.kind,'committed',JSON.stringify(edited));
  assert.deepEqual(edited.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  current=runtime.reopen(runtime.save(edited.history));
  const changedHoles=await evaluate('bridge.native.changed.holes');
  assert.deepEqual(changedHoles.plate.holes.map(h=>h.radius),[5,5]);
  assert.notEqual(changedHoles.sha256,second.sha256);
  assert.ok(changedHoles.volumeMm3>second.volumeMm3);

  // Undo the hole edit through the durable model archive, then rebuild a
  // REAL native solid rather than reusing an old same-revision STEP artifact.
  current=runtime.reopen(runtime.save(runtime.undo(current,['undo.bridge.holes'])));
  const undoneHoles=await evaluate('bridge.native.undo.holes');
  assert.deepEqual(undoneHoles.plate.holes.map(h=>h.radius),[6,6]);
  assert.ok(Math.abs(undoneHoles.volumeMm3-second.volumeMm3)<1e-5);
  current=runtime.reopen(runtime.save(runtime.redo(current,['redo.bridge.holes'])));
  assert.deepEqual(runtime.inspect(current).features
    .find(f=>f.featureId==='plate').profile.holes.map(h=>h.radius),[5,5]);
  // Real third-hole creation: one model transaction, full SKETCH admission,
  // then a fresh OCP Boolean and STEP over authenticated localhost HTTP.
  const added=runtime.editPlateHoles(current,{
    sketchFeatureId:'sketch.plate',eventId:'author.bridge.third.hole',
    expectedRevision:current.document.revision,admission:'require_admissible',
    operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}],
  });
  assert.equal(added.kind,'committed',JSON.stringify(added));
  assert.deepEqual(added.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  current=runtime.reopen(runtime.save(added.history));
  const withThirdHole=await evaluate('bridge.native.three.holes');
  assert.deepEqual(withThirdHole.plate.holes.map(h=>h.radius),[5,5,4]);
  assert.ok(withThirdHole.volumeMm3<changedHoles.volumeMm3);
  assert.notEqual(withThirdHole.sha256,changedHoles.sha256);
  // Undo is an authoritative journal action, not reusing an old STEP receipt.
  current=runtime.reopen(runtime.save(runtime.undo(current,['undo.third.hole'])));
  const afterUndoThirdHole=await evaluate('bridge.native.undo.third.hole');
  assert.deepEqual(afterUndoThirdHole.plate.holes.map(h=>h.radius),[5,5]);
  assert.notEqual(afterUndoThirdHole.sha256,withThirdHole.sha256);
  // One-shot rectangular hole array: copies the solved source constraint,
  // authors all three additional bores in one INTENT revision, then produces
  // a NEW real OCP Boolean/STEP through authenticated local HTTP.
  const patterned=runtime.patternPlateHoles(current,{
    sketchFeatureId:'sketch.plate',eventId:'author.bridge.array',
    expectedRevision:current.document.revision,admission:'require_admissible',
    sourceHoleId:'holeA',idPrefix:'grid1',
    columns:2,rows:2,pitchXmm:16,pitchYmm:-18,
  });
  assert.equal(patterned.kind,'committed',JSON.stringify(patterned));
  assert.deepEqual(patterned.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  current=runtime.reopen(runtime.save(patterned.history));
  const withArray=await evaluate('bridge.native.array');
  assert.deepEqual(withArray.plate.holes.map(h=>h.radius),[5,5,5,5,5]);
  assert.ok(withArray.volumeMm3<afterUndoThirdHole.volumeMm3);
  assert.notEqual(withArray.sha256,afterUndoThirdHole.sha256);
  current=runtime.reopen(runtime.save(runtime.undo(current,['undo.bridge.array'])));
  const undoneArray=await evaluate('bridge.native.undo.array');
  assert.deepEqual(undoneArray.plate.holes.map(h=>h.radius),[5,5]);
  assert.ok(Math.abs(undoneArray.volumeMm3-afterUndoThirdHole.volumeMm3)<1e-5);
  console.log(JSON.stringify({status:'real_experimental_native_bridge_pass',
    first,second,changedHoles,undoneHoles,withThirdHole,afterUndoThirdHole,
    withArray,undoneArray,
    redoAdmitted:true,independentStep:false,productionExact:false},null,2));
} finally {await host.close();}
