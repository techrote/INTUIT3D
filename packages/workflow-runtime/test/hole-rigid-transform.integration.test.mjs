/** Real INTENT+SKETCH rigid multi-hole move and KERNEL request admission.
 * Native/OCP geometry is exercised by demo:bridge, not by this test double.
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
  let h=transactions.startUndoHistory(model.newProject('runtime.rigid.holes'));
  return runtime.commit(h,[
    create('sketch.create',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    create('plate.create',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:10}}),
    create('cut.create',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
}
const feature=(r,id)=>r.features.find(f=>f.featureId===id);
const holes=h=>feature(runtime.inspect(h),'plate').profile.holes;
const move=(h,other={})=>runtime.transformPlateHoles(h,{
  sketchFeatureId:'sketch.plate',eventId:'rigid.'+h.document.revision,
  expectedRevision:h.document.revision,
  holeIds:['holeA','holeB'],pivotXmm:60,pivotYmm:40,
  rotateDegrees:90,translateXmm:5,translateYmm:0,...other,
});
const approx=(n,w)=>assert.ok(Math.abs(n-w)<1e-9,'expected '+w+', got '+n);

test('real solved holes rotate together; identities, radius, history and archive survive undo/redo',()=>{
  const original=plate(),archivedBefore=runtime.save(original);
  const transformed=move(original);
  assert.equal(transformed.kind,'committed',JSON.stringify(transformed));
  assert.equal(transformed.history.document.revision,original.document.revision+1);
  assert.deepEqual(transformed.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  const selected=holes(transformed.history);
  assert.deepEqual(selected.map(h=>h.id),['holeA','holeB']);
  approx(selected[0].x,65);approx(selected[0].y,15);
  approx(selected[1].x,65);approx(selected[1].y,65);
  assert.deepEqual(selected.map(h=>h.radius),[6,6]);
  assert.equal(feature(transformed.report,'cut').status,'pending_exact_provider');
  assert.equal(transformed.report.exactGeometryAvailable,false);
  assert.equal(runtime.save(original),archivedBefore,'input journal remains unchanged');
  let h=runtime.reopen(runtime.save(transformed.history));
  assert.deepEqual(runtime.inspect(h),transformed.report);
  h=runtime.undo(h,['undo.rigid']);
  assert.deepEqual(holes(h).map(x=>[x.x,x.y]),[[35,40],[85,40]]);
  h=runtime.redo(runtime.reopen(runtime.save(h)),['redo.rigid']);
  for(const [i,y] of [[0,15],[1,65]]){
    approx(holes(h)[i].x,65);approx(holes(h)[i].y,y);
  }
});

test('overlap refusal, stale request, unsupported selection and unresolved intent never silently mutate',()=>{
  const h=plate(),before=runtime.save(h);
  const collision=move(h,{holeIds:['holeA'],translateXmm:50,translateYmm:0,rotateDegrees:0});
  assert.equal(collision.kind,'refused',JSON.stringify(collision));
  assert.equal(collision.notCommitted,true);
  assert.equal(collision.candidateFeature.status,'invalid_profile');
  assert.equal(runtime.save(h),before);
  const unresolved=move(h,{holeIds:['holeA'],translateXmm:50,translateYmm:0,
    rotateDegrees:0,admission:'preserve_unresolved'});
  assert.equal(unresolved.kind,'committed');
  assert.equal(feature(unresolved.report,'plate').status,'blocked_dependency');
  assert.throws(()=>move(h,{expectedRevision:h.document.revision-1}),/stale/);
  assert.throws(()=>move(h,{holeIds:['holeA','holeA']}),/unique/);
  assert.throws(()=>move(h,{holeIds:['missing']}),/selected hole/);
  assert.throws(()=>move(h,{pivotXmm:undefined}),/pivot/);
  assert.throws(()=>move(h,{rotateDegrees:360}),/under 360/);
  assert.throws(()=>move(h,{translateXmm:0,rotateDegrees:0}),/rigid transform/);
  assert.equal(runtime.save(h),before);
});

test('actual KERNEL plate-v1 parser receives translated/rotated solved centres',async()=>{
  let h=plate();
  const result=move(h);
  assert.equal(result.kind,'committed',JSON.stringify(result));
  h=runtime.reopen(runtime.save(result.history));
  let observed=null;
  const provider=createExperimentalPlateWorkflow({runtime,model,plateContract,
    runExperimentalPlate:async request=>{
      observed=plateContract.parsePlateRequest(request);
      return {kind:'unresolved',code:'provider_unavailable',artifact:null};
    }});
  const outcome=await provider.evaluate(h,{cutFeatureId:'cut',
    requestId:'rigid.native.request',readCurrentHistory:()=>h});
  assert.equal(outcome.kind,'unresolved');
  assert.equal(outcome.code,'provider_unavailable');
  assert.equal(observed.exportStep,false);
  assert.deepEqual(observed.plate.holes.map(h=>h.radius),[6,6]);
  approx(observed.plate.holes[0].x,5);approx(observed.plate.holes[0].y,-25);
  approx(observed.plate.holes[1].x,5);approx(observed.plate.holes[1].y,25);
});
