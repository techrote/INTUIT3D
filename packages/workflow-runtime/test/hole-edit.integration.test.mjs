/**
 * Real accepted INTENT+SKETCH hole authoring fixture. Does not claim native B-rep
 * execution; KERNEL request mapping is tested through the genuine plate parser.
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
const event=(eventId,feature)=>({eventId,type:'feature.create',feature});
function project(sketchSource=sketch.plateSketchFixture()){
  let h=transactions.startUndoHistory(model.newProject('runtime.hole.authoring'));
  return runtime.commit(h,[
    event('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketchSource}}),
    event('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    event('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
}
function edit(h,operations,eventId='author.hole',admission='require_admissible'){
  return runtime.editPlateHoles(h,{sketchFeatureId:'sketch.plate',eventId,
    expectedRevision:h.document.revision,operations,admission});
}
const add={kind:'add',id:'holeC',x:60,y:20,radius:4};
const item=(report,id)=>report.features.find(f=>f.featureId===id);

test('user adds and removes holes in authoritative sketch; undo/reopen restores identities',()=>{
  const before=project(),saved=runtime.save(before);
  const added=edit(before,[add],'add.holeC');
  assert.equal(added.kind,'committed',JSON.stringify(added));
  assert.equal(added.history.document.revision,before.document.revision+1);
  assert.equal(runtime.save(before),saved,'input history must not be modified');
  assert.deepEqual(added.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.equal(item(added.report,'sketch.plate').status,'analytic_profile_only');
  assert.equal(item(added.report,'plate').status,'preview_only');
  assert.equal(item(added.report,'cut').status,'pending_exact_provider');
  assert.deepEqual(item(added.report,'plate').profile.holes.map(h=>h.id),
    ['holeA','holeB','holeC']);
  assert.equal(added.report.exactGeometryAvailable,false);
  let now=runtime.reopen(runtime.save(added.history));
  assert.deepEqual(runtime.inspect(now),added.report);
  const removed=edit(now,[{kind:'remove',id:'holeA'}],'remove.holeA');
  assert.equal(removed.kind,'committed',JSON.stringify(removed));
  assert.deepEqual(item(removed.report,'plate').profile.holes.map(h=>h.id),
    ['holeB','holeC']);
  const sk=model.featuresOf(removed.history.document).find(f=>f.id==='sketch.plate').payload.sketch;
  assert.equal(sk.points.some(p=>p.id==='holeA:center'),false);
  assert.equal(sk.constraints.some(c=>c.id==='holeA:fixed'||c.id==='holeA:diameter'),false);
  assert.ok(sk.constraints.some(c=>c.id==='holeB:fixed'),'other hole identity survived');
  now=runtime.reopen(runtime.save(removed.history));
  now=runtime.undo(now,['undo.remove']);
  assert.deepEqual(item(runtime.inspect(now),'plate').profile.holes.map(h=>h.id),
    ['holeA','holeB','holeC']);
  now=runtime.undo(now,['undo.add']);
  assert.deepEqual(item(runtime.inspect(now),'plate').profile.holes.map(h=>h.id),
    ['holeA','holeB']);
  now=runtime.redo(now,['redo.add']);
  assert.deepEqual(item(runtime.inspect(now),'plate').profile.holes.map(h=>h.id),
    ['holeA','holeB','holeC']);
});

test('colliding hole refuses without committing and can be retained/repaired explicitly',()=>{
  const before=project(),saved=runtime.save(before);
  const touching={kind:'add',id:'holeC',x:35,y:40,radius:4};
  const refused=edit(before,[touching],'add.overlap');
  assert.equal(refused.kind,'refused',JSON.stringify(refused));
  assert.equal(refused.notCommitted,true);
  assert.equal(refused.candidateFeature.status,'invalid_profile');
  assert.equal(runtime.save(before),saved);
  const retained=edit(before,[touching],'retain.overlap','preserve_unresolved');
  assert.equal(retained.kind,'committed');
  assert.equal(item(retained.report,'plate').status,'blocked_dependency');
  const fixed=edit(runtime.reopen(runtime.save(retained.history)),
    [{kind:'remove',id:'holeC'}],'repair.overlap');
  assert.equal(fixed.kind,'committed',JSON.stringify(fixed));
  assert.equal(item(fixed.report,'sketch.plate').status,'analytic_profile_only');
  assert.equal(item(fixed.report,'cut').status,'pending_exact_provider');
});

test('cannot silently delete someone else\'s constraint or reuse occupied IDs',()=>{
  const document=sketch.plateSketchFixture();
  document.constraints.push({id:'equal.holes',kind:'equalRadius',a:'holeA',b:'holeB'});
  const before=project(sketch.validateSketch(document)),saved=runtime.save(before);
  assert.throws(()=>edit(before,[{kind:'remove',id:'holeA'}]),/non-owned constraints/);
  assert.throws(()=>edit(before,[{...add,id:'holeA'}]),/identity already exists/);
  assert.throws(()=>edit(before,[add,{...add,x:61}]),/repeated hole identity/);
  assert.throws(()=>runtime.editPlateHoles(before,{sketchFeatureId:'sketch.plate',
    eventId:'stale.hole',expectedRevision:before.document.revision-1,
    operations:[add]}),/stale/);
  assert.equal(runtime.save(before),saved);
});

test('new third hole reaches the real KERNEL plate request and reflects retrospective edit',async()=>{
  let history=project(),requested=[];
  const bridge=createExperimentalPlateWorkflow({runtime,model,plateContract,
    runExperimentalPlate:async request=>{
      requested.push(request);
      assert.deepEqual(plateContract.parsePlateRequest(request),request);
      return {kind:'unresolved',code:'worker_crash',artifact:null};
    }});
  const run=()=>bridge.evaluate(history,{cutFeatureId:'cut',
    requestId:'runtime.holes.1',readCurrentHistory:()=>history});
  assert.equal((await run()).code,'worker_crash');
  assert.equal(requested[0].plate.holes.length,2);
  const added=edit(history,[add],'add.third');
  assert.equal(added.kind,'committed');
  history=runtime.reopen(runtime.save(added.history));
  assert.equal((await run()).code,'worker_crash');
  assert.deepEqual(requested[1].plate.holes,[{x:-25,y:0,radius:6},
    {x:25,y:0,radius:6},{x:0,y:-20,radius:4}]);
  const removed=edit(history,[{kind:'remove',id:'holeA'}],'remove.first');
  history=runtime.reopen(runtime.save(removed.history));
  assert.equal((await run()).code,'worker_crash');
  assert.deepEqual(requested[2].plate.holes,[{x:25,y:0,radius:6},
    {x:0,y:-20,radius:4}]);
  assert.equal(requested.every(r=>r.exportStep===false),true);
});
