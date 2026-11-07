import test from 'node:test';
import assert from 'node:assert/strict';
import {authorMountingFlange,editExtrudeThickness,FEATURE_OPS_FORMAT,FEATURE_OPS_VERSION} from '../src/index.mjs';
// Run this inside the checked-out INTUIT3D monorepo after INTEGRATION registers
// this new workspace. Missing packages are an explicit unqualified environment,
// never evidence of a successful live consumer integration.
let live = null;
try {
  const [model,transactions,bindings,dimensions,archive,sketch,discovery,workflow]=await Promise.all([
    import('@intuit3d/model'),import('@intuit3d/model/transactions'),
    import('@intuit3d/model/dimension-bindings'),import('@intuit3d/model/dimension-batch-edit'),
    import('@intuit3d/model/archive'),import('@intuit3d/sketch'),
    import('@intuit3d/sketch/profile-discovery/v1'),import('@intuit3d/workflow-runtime'),
  ]);
  live={model,transactions,sketch,discovery,runtime:workflow.createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery})};
} catch(e) { if(e?.code !== 'ERR_MODULE_NOT_FOUND') throw e; }

test('real INTENT + SKETCH + RUNTIME: four-hole mounting flange, retrospective edit, undo/redo and archive',
  {skip:live ? false : 'requires monorepo workspace dependencies (not executed locally)'},()=>{
  const s=live;
  const original=s.transactions.startUndoHistory(s.model.newProject('mounting.flange.four.bolts'));
  const request={format:FEATURE_OPS_FORMAT,version:FEATURE_OPS_VERSION,
    eventId:'create.mount',expectedRevision:original.document.revision,
    sketchFeatureId:'sketch.mount',extrudeFeatureId:'extrude.mount',
    cutFeatureId:'cut.mount',targetBodyId:'body.mount',thicknessMm:10,
    spec:{widthMm:180,depthMm:100,units:'mm',frame:'local_centered_xy',holes:[
      {id:'nw',xMm:-70,yMm:30,radiusMm:5},{id:'ne',xMm:70,yMm:30,radiusMm:5},
      {id:'sw',xMm:-70,yMm:-30,radiusMm:5},{id:'se',xMm:70,yMm:-30,radiusMm:5},
    ]}};
  const initial=authorMountingFlange(original,request,s);
  assert.equal(initial.report.features.find(x=>x.featureId==='sketch.mount').status,'analytic_profile_only');
  assert.equal(initial.report.features.find(x=>x.featureId==='cut.mount').status,'pending_exact_provider');
  assert.equal(initial.report.features.find(x=>x.featureId==='extrude.mount').profile.holes.length,4);
  const altered=editExtrudeThickness(initial.history,{eventId:'edit.mount.thickness',featureId:'extrude.mount',expectedRevision:initial.history.document.revision,thicknessMm:16},s);
  assert.ok(altered.invalidation.invalidatedFeatureIds.includes('cut.mount'));
  assert.ok(altered.invalidation.invalidatedFeatureIds.includes('extrude.mount'));
  assert.ok(!altered.invalidation.invalidatedFeatureIds.includes('sketch.mount'));
  const undone=s.runtime.undo(altered.history,['undo.mount.thickness']);
  assert.equal(s.model.featuresOf(undone.document).find(f=>f.id==='extrude.mount').payload.thicknessMm,10);
  const redone=s.runtime.redo(undone,['redo.mount.thickness']);
  assert.equal(s.model.featuresOf(redone.document).find(f=>f.id==='extrude.mount').payload.thicknessMm,16);
  const reopened=s.runtime.reopen(s.runtime.save(redone));
  assert.equal(s.model.featuresOf(reopened.document).find(f=>f.id==='extrude.mount').payload.thicknessMm,16);
  assert.equal(s.runtime.inspect(reopened).features.find(f=>f.featureId==='cut.mount').status,'pending_exact_provider');
});
