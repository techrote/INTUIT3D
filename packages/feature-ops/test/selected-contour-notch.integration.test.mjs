import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as sketch from '@intuit3d/sketch';
import * as notch from '@intuit3d/sketch/selected-edge-notch/v1';
import {makePart,command,services,runtime,runDemo}
  from '../examples/selected-contour-notch.mjs';
import {authorSelectedContourNotch,editSelectedContourNotch,
  dragSelectedContourNotch} from '@intuit3d/feature-ops/selected-contour-notch/v1';

const byId=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);
const create=(h,selection,overrides={})=>command(h,selection,{
  edgeId:'L:edge0',fromMm:45,toMm:65,depthMm:8,...overrides});
const edit=(h,selection,overrides={})=>command(h,selection,{
  fromMm:42,toMm:70,depthMm:10,...overrides});
const make=()=>{
  const {history,selections}=makePart();
  return {history,selection:selections['sketch.arm']};
};
test('one selected constrained contour notch changes an actual target sketch and its downstream body',()=>{
  const {history,selection}=make();
  const original=byId(history,'sketch.arm').payload.sketch;
  const before=runtime.inspect(history);
  assert.equal(before.features.find(x=>x.featureId==='extrude.arm').status,'preview_only');
  const created=authorSelectedContourNotch(history,create(history,selection),services);
  assert.equal(created.kind,'committed');
  assert.equal(created.history.document.revision,history.document.revision+1);
  assert.equal(created.history.undoStack.length,history.undoStack.length+1);
  assert.notEqual(sketch.serializeSketch(byId(created.history,'sketch.arm').payload.sketch),
    sketch.serializeSketch(original));
  assert.deepEqual(byId(created.history,'sketch.arm').payload.selectedProfileSelection,
    created.selectedProfile);
  assert.equal(created.notch.originalEdgeId,'L:edge0');
  assert.equal(created.notch.depthMm,8);
  assert.equal(created.notch.handles.length,3);
  assert.equal(created.nativeHandoff.bodyId,'body.arm');
  assert.equal(created.exactAuthority,false);
  assert.equal(created.independentInteroperability,false);
  for(const fid of ['sketch.arm','extrude.arm','cut.arm.slot'])
    assert.ok(created.invalidation.invalidatedFeatureIds.includes(fid),fid);
  for(const fid of ['extrude.spacer','sketch.spacer','sketch.slot'])
    assert.ok(!created.invalidation.invalidatedFeatureIds.includes(fid),fid);
  assert.equal(runtime.inspect(created.history).features.find(
    x=>x.featureId==='extrude.arm').status,'preview_only');
  assert.equal(runtime.inspect(created.history).features.find(
    x=>x.featureId==='cut.arm.slot').status,'pending_exact_provider');
});
test('retrospective dimension edit, numeric handle drag, undo and archive all retain selected identity',()=>{
  const {history,selection}=make();
  const created=authorSelectedContourNotch(history,create(history,selection),services);
  const resized=editSelectedContourNotch(created.history,
    edit(created.history,created.selectedProfile),services);
  assert.equal(resized.notch.originalEdgeId,'L:edge0');
  assert.equal(resized.notch.notchId,'arm:relief');
  assert.equal(resized.notch.fromMm,42);
  assert.equal(resized.notch.toMm,70);
  assert.equal(resized.notch.depthMm,10);
  const depth=resized.notch.handles.find(x=>x.kind==='depth');
  const dragged=dragSelectedContourNotch(resized.history,
    command(resized.history,resized.selectedProfile,{
      handleId:depth.id,target:{x:depth.position.x,y:13}}),services);
  assert.equal(dragged.kind,'committed');
  assert.equal(dragged.gesture.handleId,depth.id);
  assert.equal(dragged.notch.originalEdgeId,'L:edge0');
  assert.equal(dragged.notch.fromMm,42);
  assert.equal(dragged.notch.toMm,70);
  assert.notEqual(dragged.notch.depthMm,10);
  const undo=runtime.undo(dragged.history,['undo.notch.drag']);
  assert.equal(byId(undo,'sketch.arm').payload.selectedProfileSelection.sourceSignature,
    resized.selectedProfile.sourceSignature);
  const redo=runtime.redo(undo,['redo.notch.drag']);
  const reopened=runtime.reopen(runtime.save(redo));
  assert.deepEqual(byId(reopened,'sketch.arm').payload.selectedProfileSelection,
    dragged.selectedProfile);
  const inspected=notch.inspectSelectedEdgeNotch(
    byId(reopened,'sketch.arm').payload.sketch,
    byId(reopened,'sketch.arm').payload.selectedProfileSelection,'arm:relief');
  assert.equal(inspected.kind,'selected_edge_notch');
  assert.equal(inspected.depthMm,dragged.notch.depthMm);
  assert.equal(byId(reopened,'cut.arm.slot').id,'cut.arm.slot');
  assert.equal(byId(reopened,'extrude.spacer').payload.thicknessMm,4);
});
test('authoring never targets missing/aliased/wrong bodies or invalid boundary selections',()=>{
  const {history,selection}=make();
  const frozen=JSON.stringify(history);
  const bad=[
    {targetBodyId:'body.spacer'},
    {targetBodyId:'body.missing'},
    {extrudeFeatureId:'extrude.spacer'},
    {sourceSketchId:'sketch.slot'},
    {sourceSketchId:'extrude.arm'},
    {units:'cm'},{frame:'world_xy'},
    {expectedProjectId:'project.other'},
    {expectedRevision:history.document.revision-1},
    {edgeId:'L:missing'},
    {edgeId:'L:hole0'},
    {fromMm:-1},{fromMm:66},
    {toMm:150},{depthMm:0},{depthMm:Number.NaN},
    {selection:{...selection,candidateId:'cycle:stale'}},
    {selection:{...selection,sourceSignature:'old'}},
    {notchId:'extrude.arm'}
  ];
  for(const patch of bad){
    assert.throws(()=>authorSelectedContourNotch(history,{
      ...create(history,selection),...patch},services),JSON.stringify(patch));
    assert.equal(JSON.stringify(history),frozen);
  }
  assert.equal(byId(history,'sketch.arm').payload.selectedProfileSelection.candidateId,
    selection.candidateId);
});
test('preflight rejects stale and invalid edits without partially mutating the selected body',()=>{
  const {history,selection}=make();
  const created=authorSelectedContourNotch(history,create(history,selection),services);
  const frozen=JSON.stringify(created.history);
  const valid=edit(created.history,created.selectedProfile);
  const bad=[
    {expectedRevision:valid.expectedRevision-1},
    {selection:{...created.selectedProfile,sourceSignature:'stale'}},
    {targetBodyId:'body.spacer'},{sourceSketchId:'sketch.slot'},
    {notchId:'missing.notch'},
    {fromMm:0},{toMm:1000},{depthMm:0},
    {fromMm:45,toMm:65,depthMm:8} // exact no-op
  ];
  for(const patch of bad){
    assert.throws(()=>editSelectedContourNotch(created.history,{...valid,...patch},services));
    assert.equal(JSON.stringify(created.history),frozen);
  }
  const depth=created.notch.handles.find(x=>x.kind==='depth');
  for(const patch of [
    {handleId:'unknown.handle'},
    {target:{x:Infinity,y:0}},
    {target:{x:NaN,y:0}},
    {sourceSketchId:'sketch.spacer'},
    {targetBodyId:'body.spacer'}
  ]){
    assert.throws(()=>dragSelectedContourNotch(created.history,{
      ...command(created.history,created.selectedProfile,{
        handleId:depth.id,target:{x:depth.position.x,y:11}}),...patch
    },services));
    assert.equal(JSON.stringify(created.history),frozen);
  }
  assert.throws(()=>editSelectedContourNotch(created.history,valid,
    {...services,notch:null}),/accepted SKETCH notch/);
});
test('external sketch edit invalidates old selected profile stamp rather than guessing successor',()=>{
  const {history,selection}=make();
  const made=authorSelectedContourNotch(history,create(history,selection),services);
  const external=runtime.editSketchConstraints(made.history,{
    sketchFeatureId:'sketch.arm',eventId:'external.length',
    expectedRevision:made.history.document.revision,
    edits:[{constraintId:'L:length',patch:{value:140}}],
    admission:'require_admissible'
  });
  assert.equal(external.kind,'committed');
  assert.throws(()=>editSelectedContourNotch(external.history,
    edit(external.history,made.selectedProfile),services),/stale selected source/);
});
test('public package consumer runs the real archived bracket, slot and spacer workflow',()=>{
  const file=fileURLToPath(new URL('../examples/selected-contour-notch.mjs',import.meta.url));
  const call=spawnSync(process.execPath,['--experimental-strip-types',file],
    {encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
  assert.equal(call.status,0,call.stderr||String(call.error));
  const out=JSON.parse(call.stdout);
  assert.equal(out.operation,'@intuit3d/feature-ops/selected-contour-notch/v1');
  assert.equal(out.status,'analytic_preview_pending_native');
  assert.equal(out.stableOriginalEdgeId,'L:edge0');
  assert.equal(out.armDepthMm,14);
  assert.equal(out.spacerDepthMm,4);
  assert.equal(out.slotCutId,'cut.arm.slot');
  assert.equal(out.unaffectedByNotch,true);
  assert.deepEqual(out.finalStatuses.map(x=>x.status),
    ['analytic_profile_only','preview_only','pending_exact_provider']);
  assert.equal(out.exactAuthority,false);
});
test('direct demo can be imported and executed without test-only providers',()=>{
  const out=runDemo();
  assert.equal(out.undoFramesForNotch,1);
  assert.ok(out.affectedByNotch.includes('cut.arm.slot'));
});
