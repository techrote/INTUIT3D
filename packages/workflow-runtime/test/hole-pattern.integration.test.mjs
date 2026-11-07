/** Genuine INTENT+SKETCH consumer test for one-shot rectangular hole arrays.
 * Native requests pass through the accepted KERNEL parser, without claiming
 * that this unit test executes the native provider.
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
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
function plate(){
  const h=transactions.startUndoHistory(model.newProject('runtime.rectangular.array'));
  return runtime.commit(h,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    create('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
}
const reportFeature=(report,id)=>report.features.find(f=>f.featureId===id);
const array=(h,overrides={})=>runtime.patternPlateHoles(h,{
  sketchFeatureId:'sketch.plate',
  eventId:'array.holes.'+h.document.revision,
  expectedRevision:h.document.revision,
  admission:'require_admissible',
  sourceHoleId:'holeA',
  idPrefix:'array1',
  columns:2,rows:2,pitchXmm:16,pitchYmm:-18,
  ...overrides,
});

test('a 2×2 rectangular array copies SOLVED source constraints and survives undo/reopen/redo',()=>{
  const baseline=plate();
  // Existing authored seeds remain at x=35 and r=6; the solved constraints
  // below move the source to x=30 and radius 5. Copies MUST use the solve.
  const edited=runtime.editSketchConstraints(baseline,{
    sketchFeatureId:'sketch.plate',eventId:'edit.source.hole',
    expectedRevision:baseline.document.revision,
    edits:[
      {constraintId:'holeA:fixed',patch:{x:30}},
      {constraintId:'holeA:diameter',patch:{value:5}},
    ],
  });
  assert.equal(edited.kind,'committed',JSON.stringify(edited));
  const before=runtime.save(edited.history);
  const created=array(edited.history);
  assert.equal(created.kind,'committed',JSON.stringify(created));
  assert.equal(created.history.document.revision,edited.history.document.revision+1);
  assert.equal(runtime.save(edited.history),before,'input is immutable');
  assert.deepEqual(created.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  const admitted=reportFeature(created.report,'plate').profile.holes;
  assert.deepEqual(admitted.map(x=>x.id),[
    'holeA','holeB','array1:r0c1','array1:r1c0','array1:r1c1']);
  assert.deepEqual(admitted.slice(2).map(x=>[x.x,x.y,x.radius]),[
    [46,40,5],[30,22,5],[46,22,5]]);
  assert.equal(reportFeature(created.report,'cut').status,'pending_exact_provider');
  assert.equal(created.report.exactGeometryAvailable,false);
  const source=model.featuresOf(created.history.document)
    .find(f=>f.id==='sketch.plate').payload.sketch;
  assert.equal(source.circles.find(c=>c.id==='array1:r0c1').radius,5);
  assert.ok(source.constraints.some(c=>c.id==='array1:r0c1:fixed'&&c.x===46));
  let current=runtime.reopen(runtime.save(created.history));
  assert.deepEqual(runtime.inspect(current),created.report);
  current=runtime.undo(current,['undo.array']);
  assert.deepEqual(reportFeature(runtime.inspect(current),'plate').profile.holes.map(h=>h.id),
    ['holeA','holeB']);
  current=runtime.redo(runtime.reopen(runtime.save(current)),['redo.array']);
  assert.deepEqual(reportFeature(runtime.inspect(current),'plate').profile.holes.map(h=>h.id),
    admitted.map(h=>h.id));
});

test('array is revision-fenced, bounded and admission-refused for physical overlap',()=>{
  const h=plate(),saved=runtime.save(h);
  assert.throws(()=>array(h,{expectedRevision:h.document.revision-1}),/stale/);
  assert.throws(()=>array(h,{columns:1,rows:1}),/2–32/);
  assert.throws(()=>array(h,{columns:8,rows:8}),/2–32/);
  assert.throws(()=>array(h,{columns:2,rows:1,pitchXmm:0}),/nonzero/);
  assert.throws(()=>array(h,{sourceHoleId:'missing'}),/source hole/);
  const refused=array(h,{columns:2,rows:1,pitchXmm:8});
  assert.equal(refused.kind,'refused',JSON.stringify(refused));
  assert.equal(refused.notCommitted,true);
  assert.equal(refused.candidateFeature.status,'invalid_profile');
  assert.equal(runtime.save(h),saved);
  const retained=array(h,{columns:2,rows:1,pitchXmm:8,admission:'preserve_unresolved'});
  assert.equal(retained.kind,'committed');
  assert.equal(reportFeature(retained.report,'plate').status,'blocked_dependency');
  const repaired=runtime.editPlateHoles(retained.history,{
    sketchFeatureId:'sketch.plate',eventId:'repair.array',
    expectedRevision:retained.history.document.revision,
    operations:[{kind:'remove',id:'array1:r0c1'}],
  });
  assert.equal(repaired.kind,'committed');
  assert.equal(reportFeature(repaired.report,'plate').status,'preview_only');
});

test('array reaches actual KERNEL plate-v1 request with all five holes',async()=>{
  let history=plate(),requested=null;
  const out=array(history);
  assert.equal(out.kind,'committed',JSON.stringify(out));
  history=runtime.reopen(runtime.save(out.history));
  const experimental=createExperimentalPlateWorkflow({runtime,model,plateContract,
    runExperimentalPlate:async req=>{
      requested=req;
      assert.deepEqual(plateContract.parsePlateRequest(req),req);
      return {kind:'unresolved',code:'provider_unavailable',artifact:null};
    }});
  const result=await experimental.evaluate(history,{cutFeatureId:'cut',
    requestId:'pattern.native.request',readCurrentHistory:()=>history});
  assert.equal(result.kind,'unresolved');
  assert.equal(result.code,'provider_unavailable');
  assert.equal(requested.plate.holes.length,5);
  assert.deepEqual(requested.plate.holes.map(h=>h.radius),[6,6,6,6,6]);
  assert.equal(requested.exportStep,false);
});
