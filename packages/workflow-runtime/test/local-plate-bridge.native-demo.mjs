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
import {createLivePlateSession} from '../live-plate-session.mjs';

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
const session=createLivePlateSession({runtime,readCurrentHistory:()=>current,
  publishHistory:h=>{current=h;}});
try {
  const evaluate=async requestId=>{
    const out=await session.evaluate({url:host.url,token:host.token,requestId,exportStep:true});
    assert.equal(out.kind,'experimental_plate_evaluated',JSON.stringify(out));
    assert.ok(out.step.bytes.length>0);
    assert.equal(session.currentStep()?.sha256,out.step.sha256,
      'STEP must remain bound to the live authoritative archive');
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
  const edited=session.applyEdit(h=>runtime.editSketchConstraints(h,{
    sketchFeatureId:'sketch.plate',eventId:'edit.bridge.holes',
    expectedRevision:current.document.revision,
    admission:'require_admissible',
    edits:[
      {constraintId:'holeA:diameter',patch:{value:5}},
      {constraintId:'holeB:diameter',patch:{value:5}},
    ],
  }));
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
  // A drag-like model-backed proposal computes the actual SKETCH profile and
  // dependency closure but DOES NOT publish intent or revoke current STEP.
  const beforeThirdPreview=session.save();
  const beforeThirdStep=session.currentStep();
  const proposedThird=session.previewEdit(h=>runtime.editPlateHoles(h,{
    sketchFeatureId:'sketch.plate',eventId:'author.bridge.third.hole',
    expectedRevision:current.document.revision,admission:'require_admissible',
    operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}],
  }));
  assert.equal(proposedThird.kind,'preview',JSON.stringify(proposedThird));
  assert.equal(proposedThird.exactAuthority,false);
  assert.deepEqual(proposedThird.invalidation.invalidatedFeatureIds,
    ['sketch.plate','plate','cut']);
  assert.equal(session.save(),beforeThirdPreview);
  assert.equal(session.currentStep(),beforeThirdStep);
  // Pointer release: commit exactly this revision-fenced proposal, then
  // produce a NEW physical OCP B-rep/STEP through the live loopback host.
  const addedAndBuilt=await session.commitPreviewAndEvaluate(proposedThird,{
    url:host.url,token:host.token,requestId:'bridge.native.three.holes',
    exportStep:true});
  assert.equal(addedAndBuilt.kind,'submitted');
  const added=addedAndBuilt.edit;
  assert.equal(added.kind,'committed',JSON.stringify(added));
  assert.deepEqual(added.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  const nativeThird=addedAndBuilt.evaluation;
  assert.equal(nativeThird.kind,'experimental_plate_evaluated',JSON.stringify(nativeThird));
  assert.equal(session.currentStep()?.sha256,nativeThird.step.sha256);
  current=runtime.reopen(runtime.save(added.history));
  const withThirdHole={
    plate:nativeThird.result.intendedPlate,
    volumeMm3:nativeThird.result.observed.source.volumeMm3,
    sha256:nativeThird.step.sha256,
  };
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
  const patterned=session.applyEdit(h=>runtime.patternPlateHoles(h,{
    sketchFeatureId:'sketch.plate',eventId:'author.bridge.array',
    expectedRevision:current.document.revision,admission:'require_admissible',
    sourceHoleId:'holeA',idPrefix:'grid1',
    columns:2,rows:2,pitchXmm:16,pitchYmm:-18,
  }));
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
  // One-shot polar bolt-circle pattern, using the already admitted source
  // hole. This produces real OCP cut/STEP through the same localhost bridge.
  const circular=session.applyEdit(h=>runtime.patternCircularHoles(h,{
    sketchFeatureId:'sketch.plate',eventId:'author.bridge.polar',
    expectedRevision:current.document.revision,admission:'require_admissible',
    sourceHoleId:'holeA',idPrefix:'boltCircle',
    instances:4,pivotXmm:45,pivotYmm:40,sweepDegrees:360,
  }));
  assert.equal(circular.kind,'committed',JSON.stringify(circular));
  assert.deepEqual(circular.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  current=runtime.reopen(runtime.save(circular.history));
  const withPolarArray=await evaluate('bridge.native.polar');
  assert.deepEqual(withPolarArray.plate.holes.map(h=>h.radius),[5,5,5,5,5]);
  assert.ok(withPolarArray.volumeMm3<undoneArray.volumeMm3);
  assert.notEqual(withPolarArray.sha256,undoneArray.sha256);
  current=runtime.reopen(runtime.save(runtime.undo(current,['undo.bridge.polar'])));
  const undonePolarArray=await evaluate('bridge.native.undo.polar');
  assert.deepEqual(undonePolarArray.plate.holes.map(h=>h.radius),[5,5]);
  assert.ok(Math.abs(undonePolarArray.volumeMm3-undoneArray.volumeMm3)<1e-5);


  // A single browser-consumable transaction rigidly repositions TWO existing
  // holes using the actual SKETCH solved centres. Native OCP must physically
  // rebuild a new B-rep/STEP, not reuse the prior STEP at a later revision.
  const rigid=session.applyEdit(h=>runtime.transformPlateHoles(h,{
    sketchFeatureId:'sketch.plate',eventId:'author.bridge.rigid.holes',
    expectedRevision:current.document.revision,admission:'require_admissible',
    holeIds:['holeA','holeB'],pivotXmm:60,pivotYmm:40,
    rotateDegrees:90,translateXmm:5,translateYmm:0,
  }));
  assert.equal(rigid.kind,'committed',JSON.stringify(rigid));
  assert.deepEqual(rigid.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.equal(session.currentStep(),null,'authored transformation revokes previous STEP');
  current=runtime.reopen(runtime.save(rigid.history));
  const withRigidTransform=await evaluate('bridge.native.rigid.holes');
  assert.deepEqual(withRigidTransform.plate.holes.map(h=>h.radius),[5,5]);
  assert.ok(Math.abs(withRigidTransform.plate.holes[0].x-5)<1e-9);
  assert.ok(Math.abs(withRigidTransform.plate.holes[0].y+25)<1e-9);
  assert.ok(Math.abs(withRigidTransform.plate.holes[1].x-5)<1e-9);
  assert.ok(Math.abs(withRigidTransform.plate.holes[1].y-25)<1e-9);
  assert.ok(Math.abs(withRigidTransform.volumeMm3-undonePolarArray.volumeMm3)<1e-5);
  assert.notEqual(withRigidTransform.sha256,undonePolarArray.sha256);
  current=runtime.reopen(runtime.save(runtime.undo(current,['undo.bridge.rigid'])));
  const undoneRigidTransform=await evaluate('bridge.native.undo.rigid');
  assert.deepEqual(undoneRigidTransform.plate.holes.map(h=>[h.x,h.y]),[[-25,0],[25,0]]);
  assert.ok(Math.abs(undoneRigidTransform.volumeMm3-undonePolarArray.volumeMm3)<1e-5);

  // Retrospective dimensional resize of BOTH original bores and their
  // centre spacing. This is real solver-backed intent and a fresh physical
  // experimental OCP STEP, not a viewport-only transform.
  const resized=session.applyEdit(h=>runtime.resizePlateHoleLayout(h,{
    sketchFeatureId:'sketch.plate',eventId:'author.bridge.resize.layout',
    expectedRevision:current.document.revision,admission:'require_admissible',
    holeIds:['holeA','holeB'],pivotXmm:60,pivotYmm:40,
    scaleX:0.8,scaleY:1,radiusScale:0.8,
  }));
  assert.equal(resized.kind,'committed',JSON.stringify(resized));
  assert.deepEqual(resized.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.equal(session.currentStep(),null,'layout edit invalidates old native STEP');
  current=runtime.reopen(runtime.save(resized.history));
  const withResizedLayout=await evaluate('bridge.native.resized.layout');
  assert.deepEqual(withResizedLayout.plate.holes.map(h=>h.radius),[4,4]);
  assert.deepEqual(withResizedLayout.plate.holes.map(h=>h.x),[-20,20]);
  assert.ok(withResizedLayout.volumeMm3>undoneRigidTransform.volumeMm3);
  assert.notEqual(withResizedLayout.sha256,undoneRigidTransform.sha256);
  current=runtime.reopen(runtime.save(runtime.undo(current,['undo.bridge.resize.layout'])));
  const undoneResize=await evaluate('bridge.native.undo.layout.resize');
  assert.deepEqual(undoneResize.plate.holes.map(h=>h.radius),[5,5]);
  assert.deepEqual(undoneResize.plate.holes.map(h=>h.x),[-25,25]);
  assert.ok(Math.abs(undoneResize.volumeMm3-undoneRigidTransform.volumeMm3)<1e-5);

  // Real archive re-open and native STEP reconstruction in one browser-safe
  // operation. An intermediate authored edit must revoke the old receipt;
  // reopening the saved archive requires explicit replacement consent.
  const savedNativeArchive=session.save();
  const transient=session.applyEdit(h=>runtime.editPlateHoles(h,{
    sketchFeatureId:'sketch.plate',eventId:'author.bridge.transient.hole',
    expectedRevision:h.document.revision,admission:'require_admissible',
    operations:[{kind:'add',id:'holeReopen',x:60,y:20,radius:3}],
  }));
  assert.equal(transient.kind,'committed',JSON.stringify(transient));
  assert.equal(session.currentStep(),null,'transient edit must revoke prior STEP');
  const refusedNativeRestore=await session.reopenAndEvaluate(savedNativeArchive,{
    url:host.url,token:host.token,requestId:'bridge.native.reopen.denied',
    exportStep:true,
  });
  assert.equal(refusedNativeRestore.kind,'refused');
  assert.equal(refusedNativeRestore.evaluation,null);
  const reopenedNative=await session.reopenAndEvaluate(savedNativeArchive,{
    confirmReplacement:true,url:host.url,token:host.token,
    requestId:'bridge.native.reopen.rebuild',exportStep:true,
  });
  assert.equal(reopenedNative.kind,'submitted');
  assert.equal(reopenedNative.evaluation.kind,'experimental_plate_evaluated',
    JSON.stringify(reopenedNative.evaluation));
  assert.equal(session.save(),savedNativeArchive);
  assert.equal(reopenedNative.evaluation.result.intendedPlate.holes.length,2);
  assert.ok(Math.abs(reopenedNative.evaluation.result.observed.source.volumeMm3-
    undoneResize.volumeMm3)<1e-5);
  assert.equal(session.currentStep()?.sha256,reopenedNative.evaluation.step.sha256);
  assert.equal(reopenedNative.evaluation.exactAuthority,false);
  assert.equal(reopenedNative.evaluation.independentInteroperability,false);

  console.log(JSON.stringify({status:'real_experimental_native_bridge_pass',
    first,second,changedHoles,undoneHoles,withThirdHole,afterUndoThirdHole,
    withArray,undoneArray,withPolarArray,undonePolarArray,
    withRigidTransform,undoneRigidTransform,withResizedLayout,undoneResize,
    reopenedNative:{volumeMm3:reopenedNative.evaluation.result.observed.source.volumeMm3,
      bytes:reopenedNative.evaluation.step.bytes.length,
      sha256:reopenedNative.evaluation.step.sha256},
    redoAdmitted:true,independentStep:false,productionExact:false},null,2));
} finally {session.cancel();await host.close();}
