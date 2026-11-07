/** Physical-profile-backed retrospective hole pitch and diameter editing. */
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
function plate(){
  return runtime.commit(transactions.startUndoHistory(model.newProject('runtime.layout.resize')),[
    created('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:sketch.plateSketchFixture()}}),
    created('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:10}}),
    created('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
}
const resize=(h,options={})=>runtime.resizePlateHoleLayout(h,{
  sketchFeatureId:'sketch.plate',eventId:'resize.'+h.document.revision,
  expectedRevision:h.document.revision,admission:'require_admissible',
  holeIds:['holeA','holeB'],pivotXmm:60,pivotYmm:40,
  scaleX:0.8,scaleY:1,radiusScale:0.75,...options,
});
const profile=h=>runtime.inspect(h).features.find(f=>f.featureId==='plate').profile;

test('retrospective pitch/radius edit retains solved hole IDs across one event, archive, undo/redo',()=>{
  const baseline=plate(),before=runtime.save(baseline);
  const out=resize(baseline);
  assert.equal(out.kind,'committed',JSON.stringify(out));
  assert.deepEqual(out.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.equal(out.history.document.revision,baseline.document.revision+1);
  assert.deepEqual(profile(out.history).holes.map(h=>[h.id,h.x,h.y,h.radius]),[
    ['holeA',40,40,4.5],['holeB',80,40,4.5]]);
  assert.equal(out.report.exactGeometryAvailable,false);
  assert.equal(out.report.features.find(f=>f.featureId==='cut').status,'pending_exact_provider');
  assert.equal(runtime.save(baseline),before);
  const archived=runtime.reopen(runtime.save(out.history));
  assert.deepEqual(runtime.inspect(archived),out.report);
  const undone=runtime.undo(archived,['undo.resize']);
  assert.deepEqual(profile(undone).holes.map(h=>[h.id,h.x,h.radius]),[
    ['holeA',35,6],['holeB',85,6]]);
  const redone=runtime.redo(runtime.reopen(runtime.save(undone)),['redo.resize']);
  assert.deepEqual(profile(redone).holes.map(h=>[h.id,h.x,h.radius]),[
    ['holeA',40,4.5],['holeB',80,4.5]]);
});

test('inadmissible centre-spacing collisions, stale revisions and invalid scale are explicit',()=>{
  const h=plate(),archiveBefore=runtime.save(h);
  const refused=resize(h,{scaleX:0.1,radiusScale:1});
  assert.equal(refused.kind,'refused',JSON.stringify(refused));
  assert.equal(refused.notCommitted,true);
  assert.equal(refused.candidateFeature.status,'invalid_profile');
  assert.equal(runtime.save(h),archiveBefore);
  const unresolved=resize(h,{scaleX:0.1,radiusScale:1,admission:'preserve_unresolved'});
  assert.equal(unresolved.kind,'committed');
  assert.equal(runtime.inspect(unresolved.history).features.find(f=>f.featureId==='plate').status,
    'blocked_dependency');
  assert.throws(()=>resize(h,{expectedRevision:h.document.revision-1}),/stale/);
  assert.throws(()=>resize(h,{scaleX:0}),/positive/);
  assert.throws(()=>resize(h,{radiusScale:-1}),/positive/);
  assert.throws(()=>resize(h,{scaleX:1,scaleY:1,radiusScale:1}),/nonzero change/);
  assert.throws(()=>resize(h,{holeIds:['holeA','holeA']}),/unique/);
  assert.throws(()=>resize(h,{holeIds:['missing']}),/selected hole/);
  assert.equal(runtime.save(h),archiveBefore);
});

test('actual KERNEL request uses solved resized positions and bore radii, not stale seeds',async()=>{
  let h=plate();
  const out=resize(h);
  assert.equal(out.kind,'committed');
  h=runtime.reopen(runtime.save(out.history));
  let observed=null;
  const provider=createExperimentalPlateWorkflow({runtime,model,plateContract,
    runExperimentalPlate:async request=>{
      observed=plateContract.parsePlateRequest(request);
      return {kind:'unresolved',code:'provider_unavailable',artifact:null};
    }});
  const response=await provider.evaluate(h,{cutFeatureId:'cut',
    requestId:'layout.resize.native.request',readCurrentHistory:()=>h});
  assert.equal(response.kind,'unresolved');
  assert.equal(response.code,'provider_unavailable');
  assert.deepEqual(observed.plate.holes.map(h=>[h.x,h.y,h.radius]),[
    [-20,0,4.5],[20,0,4.5]]);
  assert.equal(observed.exportStep,false);
});
