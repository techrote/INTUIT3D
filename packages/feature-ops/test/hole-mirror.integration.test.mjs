import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorMountingFlange,FEATURE_OPS_FORMAT,FEATURE_OPS_VERSION} from '../src/index.mjs';
import {mirrorProfileHoles,HOLE_MIRROR_FORMAT,HOLE_MIRROR_VERSION} from '../src/hole-mirror.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch};
function start(){
  const empty=transactions.startUndoHistory(model.newProject('mirror.flange.cut'));
  const authored=authorMountingFlange(empty,{
    format:FEATURE_OPS_FORMAT,version:FEATURE_OPS_VERSION,
    eventId:'author.mirror.flange',expectedRevision:empty.document.revision,
    sketchFeatureId:'sketch.flange',extrudeFeatureId:'extrude.flange',
    cutFeatureId:'cut.flange',targetBodyId:'body.flange',thicknessMm:8,
    spec:{units:'mm',frame:'local_centered_xy',widthMm:160,depthMm:100,
      holes:[{id:'top-left',xMm:-60,yMm:30,radiusMm:5}]}
  },{runtime,model,sketch,discovery});
  return {history:authored.history,request:{
    format:HOLE_MIRROR_FORMAT,version:HOLE_MIRROR_VERSION,
    eventId:'mirror.flange.holes',expectedRevision:authored.history.document.revision,
    units:'mm',frame:'local_xy',sketchFeatureId:'sketch.flange',
    extrudeFeatureId:'extrude.flange',cutFeatureId:'cut.flange',targetBodyId:'body.flange',
    axis:{xMm:0,yMm:0,dx:1,dy:0},
    copies:[{sourceHoleId:'hole.top-left',outputHoleId:'hole.bottom-left'}]
  }};
}
test('real INTENT/SKETCH/RUNTIME mirrored flange: invalidation, undo/redo, save/reopen',()=>{
  const {history,request}=start();
  const result=mirrorProfileHoles(history,request,services);
  assert.equal(result.kind,'committed');
  assert.equal(result.history.document.revision,history.document.revision+1);
  assert.deepEqual(result.mirrorCopies,[{kind:'add',id:'hole.bottom-left',x:-60,y:-30,radius:5}]);
  for(const id of ['sketch.flange','extrude.flange','cut.flange'])
    assert.ok(result.invalidation.invalidatedFeatureIds.includes(id));
  assert.equal(result.report.features.find(f=>f.featureId==='extrude.flange').profile.holes.length,2);
  assert.equal(result.report.features.find(f=>f.featureId==='cut.flange').status,'pending_exact_provider');
  const undo=runtime.undo(result.history,['undo.flange.mirror']);
  assert.equal(runtime.inspect(undo).features.find(f=>f.featureId==='extrude.flange').profile.holes.length,1);
  const redo=runtime.redo(undo,['redo.flange.mirror']);
  const reopened=runtime.reopen(runtime.save(redo));
  const edited=model.featuresOf(reopened.document).find(f=>f.id==='sketch.flange').payload.sketch;
  assert.equal(edited.circles.length,2);
  assert.ok(edited.circles.some(c=>c.id==='hole.bottom-left'));
  assert.equal(runtime.inspect(reopened).features.find(f=>f.featureId==='cut.flange').status,
    'pending_exact_provider');
  assert.equal(result.exactAuthority,false);
  assert.equal(result.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
});
test('real SKETCH profile gate rejects mirrored hole outside material',()=>{
  const {history,request}=start();
  const result=mirrorProfileHoles(history,{
    ...request,axis:{xMm:0,yMm:70,dx:1,dy:0}
  },services);
  assert.equal(result.kind,'refused');
  assert.equal(result.notCommitted,true);
  assert.equal(runtime.inspect(history).features.find(f=>f.featureId==='extrude.flange').profile.holes.length,1);
});
