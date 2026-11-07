/**
 * Real INTENT/SKETCH circular-array admission and KERNEL request contract.
 * This test is semantic/analytic: physical STEP is exercised separately by
 * the real experimental native demo, never invented here.
 */
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
const feature=(report,id)=>report.features.find(f=>f.featureId===id);
function initialPlate() {
  let history=transactions.startUndoHistory(model.newProject('runtime.circular.array'));
  return runtime.commit(history,[
    created('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    created('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    created('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
}
function polar(history,overrides={}) {
  return runtime.patternCircularHoles(history,{
    sketchFeatureId:'sketch.plate',eventId:'polar.'+history.document.revision,
    expectedRevision:history.document.revision,
    sourceHoleId:'holeA',idPrefix:'boltCircle',instances:4,
    pivotXmm:45,pivotYmm:40,sweepDegrees:360,
    admission:'require_admissible',...overrides,
  });
}
function almost(actual,wanted) {
  assert.ok(Math.abs(actual-wanted)<1e-10,`coordinate ${actual} != ${wanted}`);
}

test('user can author a full bolt circle from solved geometry and undo/reopen/redo one transaction',()=>{
  const baseline=initialPlate();
  const edited=runtime.editSketchConstraints(baseline,{
    sketchFeatureId:'sketch.plate',eventId:'move.and.size.source',
    expectedRevision:baseline.document.revision,
    edits:[{constraintId:'holeA:fixed',patch:{x:30}},
      {constraintId:'holeA:diameter',patch:{value:5}}],
  });
  assert.equal(edited.kind,'committed',JSON.stringify(edited));
  const originalArchive=runtime.save(edited.history);
  const outcome=polar(edited.history);
  assert.equal(outcome.kind,'committed',JSON.stringify(outcome));
  assert.equal(runtime.save(edited.history),originalArchive,'source history stays immutable');
  assert.deepEqual(outcome.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  const admitted=feature(outcome.report,'plate').profile.holes;
  assert.deepEqual(admitted.map(h=>h.id),[
    'holeA','holeB','boltCircle:p1','boltCircle:p2','boltCircle:p3']);
  assert.equal(admitted[0].radius,5);
  for(const [i,x,y] of [[2,45,25],[3,60,40],[4,45,55]]) {
    almost(admitted[i].x,x);almost(admitted[i].y,y);
    assert.equal(admitted[i].radius,5);
  }
  assert.equal(feature(outcome.report,'cut').status,'pending_exact_provider');
  assert.equal(outcome.report.exactGeometryAvailable,false);
  const source=model.featuresOf(outcome.history.document)
    .find(f=>f.id==='sketch.plate').payload.sketch;
  for(let i=1;i<=3;i++){
    assert.ok(source.circles.some(c=>c.id===`boltCircle:p${i}`));
    assert.ok(source.constraints.some(c=>c.id===`boltCircle:p${i}:fixed`));
    assert.ok(source.constraints.some(c=>c.id===`boltCircle:p${i}:diameter`));
  }
  let current=runtime.reopen(runtime.save(outcome.history));
  assert.deepEqual(runtime.inspect(current),outcome.report);
  current=runtime.undo(current,['undo.circular']);
  assert.deepEqual(feature(runtime.inspect(current),'plate').profile.holes.map(h=>h.id),
    ['holeA','holeB']);
  current=runtime.redo(runtime.reopen(runtime.save(current)),['redo.circular']);
  assert.deepEqual(feature(runtime.inspect(current),'plate').profile.holes.map(h=>h.id),
    admitted.map(h=>h.id));
});

test('partial clockwise sweep has explicit end position; invalid or overlapping arrays never commit',()=>{
  const initial=initialPlate(),archiveBefore=runtime.save(initial);
  const partial=polar(initial,{instances:3,sweepDegrees:-180,idPrefix:'halfCircle'});
  assert.equal(partial.kind,'committed',JSON.stringify(partial));
  const admitted=feature(partial.report,'plate').profile.holes;
  assert.deepEqual(admitted.slice(2).map(h=>h.id),['halfCircle:p1','halfCircle:p2']);
  almost(admitted[2].x,45);almost(admitted[2].y,50);
  almost(admitted[3].x,55);almost(admitted[3].y,40);
  assert.throws(()=>polar(initial,{expectedRevision:initial.document.revision-1}),/stale/);
  assert.throws(()=>polar(initial,{instances:1}),/2–32/);
  assert.throws(()=>polar(initial,{instances:33}),/2–32/);
  assert.throws(()=>polar(initial,{sweepDegrees:0}),/nonzero sweep/);
  assert.throws(()=>polar(initial,{sweepDegrees:361}),/nonzero sweep/);
  assert.throws(()=>polar(initial,{pivotXmm:35,pivotYmm:40}),/pivot must differ/);
  assert.throws(()=>polar(initial,{sourceHoleId:'missing'}),/source hole/);
  const overlap=polar(initial,{instances:5});
  assert.equal(overlap.kind,'refused',JSON.stringify(overlap));
  assert.equal(overlap.notCommitted,true);
  assert.equal(overlap.candidateFeature.status,'invalid_profile');
  assert.equal(runtime.save(initial),archiveBefore,'refusal cannot edit model');
});

test('native provider receives exactly the five new-and-existing authenticated hole positions',async()=>{
  const before=initialPlate();
  const out=polar(before);
  assert.equal(out.kind,'committed',JSON.stringify(out));
  const history=runtime.reopen(runtime.save(out.history));
  let requested=null;
  const provider=createExperimentalPlateWorkflow({runtime,model,plateContract,
    runExperimentalPlate:async req=>{
      requested=req;
      assert.deepEqual(plateContract.parsePlateRequest(req),req);
      return {kind:'unresolved',code:'provider_unavailable',artifact:null};
    }});
  const result=await provider.evaluate(history,{cutFeatureId:'cut',
    requestId:'polar.native.request',readCurrentHistory:()=>history});
  assert.equal(result.kind,'unresolved');
  assert.equal(result.code,'provider_unavailable');
  assert.equal(requested.plate.holes.length,5);
  assert.deepEqual(requested.plate.holes.map(h=>h.radius),[6,6,6,6,6]);
  const copies=requested.plate.holes.slice(2);
  almost(copies[0].x,45);almost(copies[0].y,30);
  almost(copies[1].x,55);almost(copies[1].y,40);
  almost(copies[2].x,45);almost(copies[2].y,50);
  assert.equal(requested.exportStep,false,'native test double does not generate real STEP');
});
