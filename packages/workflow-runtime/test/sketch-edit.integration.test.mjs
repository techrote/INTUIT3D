/** Real INTENT+SKETCH consumer acceptance for atomic, revision-fenced user edits. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '../index.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const created=(eventId,feature)=>({eventId,type:'feature.create',feature});
function plateProject() {
  let history=transactions.startUndoHistory(model.newProject('runtime.atomic.sketch'));
  history=runtime.commit(history,[
    created('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    created('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    created('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
  return history;
}
const state=(report,id)=>report.features.find(f=>f.featureId===id);
const request=(history,edits,admission='require_admissible',eventId='edit.sketch.batch')=>({
  sketchFeatureId:'sketch.plate',eventId,
  expectedRevision:history.document.revision,admission,edits,
});

test('atomic hole diameter and plate width edit changes real admitted profile in one undo frame',()=>{
  const source=plateProject();
  const before=runtime.save(source);
  const out=runtime.editSketchConstraints(source,request(source,[
    {constraintId:'width',patch:{value:140}},
    {constraintId:'holeA:diameter',patch:{value:5}},
    {constraintId:'holeB:diameter',patch:{value:5}},
  ]));
  assert.equal(out.kind,'committed',JSON.stringify(out));
  assert.equal(out.sketchStatus,'analytic_profile_only');
  assert.equal(out.history.document.revision,source.document.revision+1);
  assert.equal(runtime.save(source),before);
  assert.deepEqual(out.invalidation.changedFeatureIds,['sketch.plate']);
  assert.deepEqual(out.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  const profile=state(out.report,'plate').profile;
  assert.equal(state(out.report,'cut').status,'pending_exact_provider');
  assert.equal(out.report.exactGeometryAvailable,false);
  assert.equal(profile.outer.reduce((m,p)=>Math.max(m,p.x),-Infinity)-
    profile.outer.reduce((m,p)=>Math.min(m,p.x),Infinity),140);
  assert.deepEqual(profile.holes.map(h=>h.radius),[5,5]);
  const reopened=runtime.reopen(runtime.save(out.history));
  assert.deepEqual(runtime.inspect(reopened),out.report);
  const undone=runtime.undo(reopened,['undo.atomic.sketch']);
  assert.deepEqual(state(runtime.inspect(undone),'plate').profile.holes.map(h=>h.radius),[6,6]);
  const redone=runtime.redo(undone,['redo.atomic.sketch']);
  assert.deepEqual(state(runtime.inspect(redone),'plate').profile.holes.map(h=>h.radius),[5,5]);
});

test('inadmissible editing refuses without writing any authored journal entry',()=>{
  const source=plateProject(),before=runtime.save(source);
  const out=runtime.editSketchConstraints(source,request(source,[
    {constraintId:'width',patch:{value:90}},
  ],'require_admissible','edit.bad.width'));
  assert.equal(out.kind,'refused',JSON.stringify(out));
  assert.equal(out.code,'inadmissible_sketch');
  assert.equal(out.notCommitted,true);
  assert.equal(out.sourceRevision,source.document.revision);
  assert.equal(out.candidateRevision,source.document.revision+1);
  assert.equal(out.candidateFeature.status,'invalid_profile');
  assert.equal(runtime.save(source),before);
  assert.equal(state(runtime.inspect(source),'cut').status,'pending_exact_provider');
});

test('user can deliberately retain invalid intent, repair it, and undo the repair',()=>{
  const source=plateProject();
  const invalid=runtime.editSketchConstraints(source,request(source,[
    {constraintId:'width',patch:{value:90}},
  ],'preserve_unresolved','edit.pending.width'));
  assert.equal(invalid.kind,'committed');
  assert.equal(invalid.sketchStatus,'invalid_profile');
  assert.equal(state(invalid.report,'plate').status,'blocked_dependency');
  assert.equal(state(invalid.report,'cut').status,'blocked_dependency');
  const saved=runtime.reopen(runtime.save(invalid.history));
  const fixed=runtime.editSketchConstraints(saved,request(saved,[
    {constraintId:'width',patch:{value:120}},
  ],'require_admissible','repair.width'));
  assert.equal(fixed.kind,'committed',JSON.stringify(fixed));
  assert.equal(state(fixed.report,'plate').status,'preview_only');
  assert.equal(state(fixed.report,'cut').status,'pending_exact_provider');
  const undone=runtime.undo(fixed.history,['undo.repair.width']);
  assert.equal(state(runtime.inspect(undone),'sketch.plate').status,'invalid_profile');
});

test('stale request, duplicated constraints, unsupported patch and missing sketch never modify journal',()=>{
  const source=plateProject(),before=runtime.save(source);
  const standard=[{constraintId:'width',patch:{value:120}}];
  assert.throws(()=>runtime.editSketchConstraints(source,{
    ...request(source,standard),expectedRevision:source.document.revision-1}),/stale/);
  assert.throws(()=>runtime.editSketchConstraints(source,request(source,[
    ...standard,...standard])),/repeated/);
  assert.throws(()=>runtime.editSketchConstraints(source,request(source,[
    {constraintId:'holeA:diameter',patch:{x:3}}])),/patch keys/);
  assert.throws(()=>runtime.editSketchConstraints(source,{
    ...request(source,standard),sketchFeatureId:'missing'}),/authoritative sketch/);
  assert.equal(runtime.save(source),before);
});
