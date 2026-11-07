import test from 'node:test';
import assert from 'node:assert/strict';
import {authorMountingFlange,editExtrudeThickness,reconfigureMountingFlange,FEATURE_OPS_FORMAT,FEATURE_OPS_VERSION} from '../src/index.mjs';
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


test('real model/sketch/runtime: complete flange reconfiguration is atomic, undoable and archive-stable',
  {skip:live ? false : 'requires monorepo workspace dependencies (not executed locally)'},()=>{
  const s=live, empty=s.transactions.startUndoHistory(s.model.newProject('flange.reconfiguration'));
  const old={format:FEATURE_OPS_FORMAT,version:FEATURE_OPS_VERSION,
    eventId:'create.flange',expectedRevision:empty.document.revision,
    sketchFeatureId:'sketch.flange',extrudeFeatureId:'extrude.flange',
    cutFeatureId:'cut.flange',targetBodyId:'body.flange',thicknessMm:8,
    spec:{widthMm:160,depthMm:90,units:'mm',frame:'local_centered_xy',holes:[
      {id:'nw',xMm:-55,yMm:28,radiusMm:5},{id:'ne',xMm:55,yMm:28,radiusMm:5},
      {id:'sw',xMm:-55,yMm:-28,radiusMm:5},{id:'se',xMm:55,yMm:-28,radiusMm:5}
    ]}};
  const initial=authorMountingFlange(empty,old,s);
  const changed=reconfigureMountingFlange(initial.history,{
    eventId:'replace.layout',expectedRevision:initial.history.document.revision,
    sketchFeatureId:'sketch.flange',extrudeFeatureId:'extrude.flange',
    cutFeatureId:'cut.flange',targetBodyId:'body.flange',thicknessMm:12,
    spec:{widthMm:200,depthMm:110,units:'mm',frame:'local_centered_xy',holes:[
      {id:'nw',xMm:-75,yMm:35,radiusMm:6},{id:'ne',xMm:75,yMm:35,radiusMm:6},
      {id:'middle',xMm:0,yMm:0,radiusMm:9},{id:'sw',xMm:-75,yMm:-35,radiusMm:6}
    ]}
  },s);
  assert.equal(changed.kind,'committed');
  assert.deepEqual(changed.holeChanges.added,['hole.middle']);
  assert.deepEqual(changed.holeChanges.removed,['hole.se']);
  assert.equal(changed.holeChanges.retained.length,3);
  assert.equal(changed.report.features.find(x=>x.featureId==='extrude.flange').profile.holes.length,4);
  assert.ok(changed.invalidation.invalidatedFeatureIds.includes('cut.flange'));
  assert.ok(changed.invalidation.invalidatedFeatureIds.includes('sketch.flange'));
  assert.equal(changed.report.features.find(x=>x.featureId==='cut.flange').status,'pending_exact_provider');
  const undo=s.runtime.undo(changed.history,['undo.reconfigure.sketch','undo.reconfigure.extrude']);
  const oldSketch=s.model.featuresOf(undo.document).find(f=>f.id==='sketch.flange').payload.sketch;
  assert.ok(oldSketch.circles.some(c=>c.id==='hole.se'));
  assert.equal(s.model.featuresOf(undo.document).find(f=>f.id==='extrude.flange').payload.thicknessMm,8);
  const redo=s.runtime.redo(undo,['redo.reconfigure.sketch','redo.reconfigure.extrude']);
  const reopened=s.runtime.reopen(s.runtime.save(redo));
  const current=s.model.featuresOf(reopened.document);
  assert.equal(current.find(f=>f.id==='extrude.flange').payload.thicknessMm,12);
  assert.deepEqual(current.find(f=>f.id==='cut.flange').writeTargets,['body.flange']);
  assert.ok(current.find(f=>f.id==='sketch.flange').payload.sketch.circles.some(c=>c.id==='hole.middle'));
  assert.equal(s.runtime.inspect(reopened).features.find(f=>f.featureId==='cut.flange').status,'pending_exact_provider');
});
