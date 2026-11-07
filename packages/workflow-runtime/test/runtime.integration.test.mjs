/** Real accepted-package contract test (requires Integration's workspace lockfile admission). */
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
function start() {
  const fixture=sketch.plateSketchFixture();
  let h=transactions.startUndoHistory(model.newProject('runtime.plate.holes'));
  h=runtime.commit(h,[
    created('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:fixture}}),
    created('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    created('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
  return h;
}
const item=(report,id)=>report.features.find(f=>f.featureId===id);

test('real INTENT plan + real SKETCH solver/admission + archive preserves identity, refuses native claims',()=>{
  const h=start();
  const report=runtime.inspect(h);
  assert.deepEqual(report.authoredOrder,['sketch.plate','plate','cut']);
  assert.deepEqual(report.executableOrder,['sketch.plate','plate','cut']);
  assert.equal(item(report,'sketch.plate').status,'analytic_profile_only');
  assert.equal(item(report,'plate').status,'preview_only');
  assert.equal(item(report,'plate').profile.holes.length,2);
  assert.equal(item(report,'cut').status,'pending_exact_provider');
  assert.equal(report.exactGeometryAvailable,false);
  const serialized=runtime.save(h), reopened=runtime.reopen(serialized);
  assert.equal(runtime.save(reopened),serialized);
  assert.deepEqual(runtime.inspect(reopened),report);
  const undone=runtime.undo(reopened,['undo.cut','undo.plate','undo.sketch']);
  assert.equal(runtime.inspect(undone).features.length,0);
  const redone=runtime.redo(undone,['redo.sketch','redo.plate','redo.cut']);
  assert.deepEqual(runtime.inspect(redone).authoredOrder,report.authoredOrder);
});

test('retrospective binding changes intended thickness, not authored fallback; undo/reopen replays',()=>{
  let h=start();
  h=runtime.commit(h,[created('create.parameter',{id:'parameter.t',kind:'parameter',
    dependsOn:[],writeTargets:[],payload:{parameter:{name:'thickness',unit:'mm',
      expression:{op:'literal',value:10,unit:'mm'}}}})]);
  const request={format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,
    version:dimensions.DIMENSION_BATCH_EDIT_VERSION,expectedRevision:h.document.revision,
    admission:'require_admissible',edits:[{eventId:'bind.thickness',featureId:'plate',field:'thicknessMm',
      binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.t'}}}]};
  const original=model.serializeProject(h.document);
  const updated=runtime.editDimensions(h,request);
  assert.equal(model.serializeProject(h.document),original);
  assert.equal(model.featuresOf(updated.document).find(f=>f.id==='plate').payload.thicknessMm,8);
  const report=runtime.inspect(updated);
  assert.equal(item(report,'plate').thicknessMm,10);
  assert.ok(report.executableOrder.indexOf('parameter.t')<report.executableOrder.indexOf('plate'));
  assert.equal(item(report,'cut').status,'pending_exact_provider');
  const saved=runtime.reopen(runtime.save(updated));
  assert.equal(item(runtime.inspect(saved),'plate').thicknessMm,10);
  assert.throws(()=>runtime.editDimensions(updated,request),/stale/);
  const undone=runtime.undo(saved,['undo.binding']);
  assert.equal(item(runtime.inspect(undone),'plate').thicknessMm,8);
  const redone=runtime.redo(undone,['redo.binding']);
  assert.equal(item(runtime.inspect(redone),'plate').thicknessMm,10);
});

test('real solver refuses hole crossing; runtime preserves journal intent and blocks dependent solid',()=>{
  const h=start(), bad=sketch.editConstraint(sketch.plateSketchFixture(),'width',{value:90});
  const edited=runtime.commit(h,[{eventId:'edit.sketch.width',type:'feature.edit',
    featureId:'sketch.plate',patch:{payload:{sketch:bad}}}]);
  const report=runtime.inspect(edited);
  assert.equal(item(report,'sketch.plate').status,'invalid_profile');
  assert.equal(item(report,'plate').status,'blocked_dependency');
  assert.equal(item(report,'cut').status,'blocked_dependency');
  assert.equal(model.featuresOf(h.document).find(f=>f.id==='sketch.plate').payload.sketch.constraints
    .find(c=>c.id==='width').value,120);
});

test('model plan retains an unresolved future source and refuses fabricated extrusion',()=>{
  let h=transactions.startUndoHistory(model.newProject('runtime.unresolved'));
  h=runtime.commit(h,[created('create.plate',{id:'plate',kind:'extrude',
    dependsOn:['sketch.future'],writeTargets:['body.plate'],
    payload:{sourceSketchId:'sketch.future',thicknessMm:8}})]);
  const report=runtime.inspect(h);
  assert.equal(item(report,'plate').status,'pending_intent');
  assert.deepEqual(report.authoredOrder,['plate']);
  assert.deepEqual(report.executableOrder,[]);
});

test('actual INTENT revision diff invalidates edited sketch, extrude and cut transitively',()=>{
  const before=start();
  const bad=sketch.editConstraint(sketch.plateSketchFixture(),'width',{value:90});
  const after=runtime.commit(before,[{eventId:'edit.sketch.for.invalidation',type:'feature.edit',
    featureId:'sketch.plate',patch:{payload:{sketch:bad}}}]);
  const d=runtime.diff(before,after);
  assert.equal(d.projectId,'runtime.plate.holes');
  assert.equal(d.previousRevision,before.document.revision);
  assert.equal(d.revision,after.document.revision);
  assert.deepEqual(d.changedFeatureIds,['sketch.plate']);
  assert.deepEqual(d.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.deepEqual(d.removedFeatureIds,[]);
  assert.equal(d.exactReuseAllowed,false);
  assert.deepEqual(runtime.diff(before,before).invalidatedFeatureIds,[]);
  assert.throws(()=>runtime.diff(after,before),/reverse revision/);
  const replayed=runtime.reopen(runtime.save(after));
  assert.deepEqual(runtime.diff(before,replayed),d);
});
