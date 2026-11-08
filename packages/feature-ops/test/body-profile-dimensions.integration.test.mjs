import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as sketch from '@intuit3d/sketch';
import {
  makeMotorSensorMount,inspect,selectBody,applyDimensions,applyHandle,
  services,runtime,runDemo
} from '../examples/motor-sensor-profile-revision.mjs';
import {
  editSelectedBodyProfileDimensions,dragSelectedBodyProfileDimension,
  inspectSelectedBodyProfileDimensions
} from '@intuit3d/feature-ops/body-profile-dimensions/v1';

const find=(h,id)=>model.featuresOf(h.document).find(f=>f.id===id);
const cmd=(h,s,v,changes)=>({
  ...selectBody(h,s),expectedAffectedFeatureIds:v.affectedFeatureIds,
  eventId:'edit.dim.'+h.document.revision,changes
});
test('three real constrained dimension edits atomically rebuild selected body and cut',()=>{
  const {history,selections}=makeMotorSensorMount();
  const selected=selections['sketch.mount'],start=inspect(history,selected);
  assert.equal(start.kind,'body_profile_dimensions');
  assert.deepEqual(start.affectedFeatureIds,['cut.cable','extrude.mount','sketch.mount']);
  const original=sketch.serializeSketch(find(history,'sketch.mount').payload.sketch);
  const changed=applyDimensions(history,selected,start,[
    ['L:length',144],['L:flangeHeight',36],['L:holeLowerRadius',6]]);
  assert.equal(changed.kind,'committed');
  assert.equal(changed.history.document.revision,history.document.revision+1);
  assert.equal(changed.history.undoStack.length,history.undoStack.length+1);
  assert.notEqual(sketch.serializeSketch(find(changed.history,'sketch.mount').payload.sketch),original);
  assert.deepEqual(changed.changedConstraintIds,
    ['L:flangeHeight','L:holeLowerRadius','L:length']);
  assert.deepEqual(changed.changedRadiusIds,['L:holeLower']);
  for(const id of start.affectedFeatureIds)
    assert.ok(changed.invalidation.invalidatedFeatureIds.includes(id),id);
  for(const id of ['sketch.shim','extrude.shim','sketch.cable'])
    assert.ok(!changed.invalidation.invalidatedFeatureIds.includes(id),id);
  assert.equal(changed.report.features.find(f=>f.featureId==='cut.cable').status,
    'pending_exact_provider');
  assert.equal(changed.exactAuthority,false);
  assert.equal(changed.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
});
test('drag via real SKETCH handle, undo/redo/archive preserve IDs and dimensions',()=>{
  const {history,selections}=makeMotorSensorMount();
  const view=inspect(history,selections['sketch.mount']);
  const first=applyDimensions(history,selections['sketch.mount'],view,
    [['L:length',144],['L:flangeHeight',36],['L:holeLowerRadius',6]]);
  const secondView=inspect(first.history,first.selectedProfile);
  const radius=secondView.dimensions.find(d=>d.constraintId==='L:holeLowerRadius');
  const moved=applyHandle(first.history,first.selectedProfile,secondView,
    radius.handle.id,{x:radius.handle.position.x+1,y:radius.handle.position.y+5});
  assert.equal(moved.kind,'committed');
  assert.ok(moved.gesture.projectionDeviationMm>0);
  assert.equal(moved.history.document.revision,first.history.document.revision+1);
  const undo=runtime.undo(moved.history,['undo.profile.drag']);
  const undoView=inspect(undo,first.selectedProfile);
  assert.equal(undoView.dimensions.find(d=>d.constraintId==='L:holeLowerRadius').value,6);
  const redo=runtime.redo(undo,['redo.profile.drag']);
  const reopened=runtime.reopen(runtime.save(redo));
  const persisted=find(reopened,'sketch.mount').payload.selectedProfileSelection;
  const final=inspect(reopened,persisted);
  assert.equal(final.dimensions.find(d=>d.constraintId==='L:holeLowerRadius').value,7);
  assert.deepEqual(find(reopened,'sketch.mount').payload.sketch.circles.map(c=>c.id),
    ['L:holeLower','L:holeUpper']);
  assert.equal(find(reopened,'cut.cable').id,'cut.cable');
  assert.equal(find(reopened,'extrude.shim').payload.thicknessMm,3);
});
test('stale/wrong-target/foreign selection and conflicting edits refuse before mutation',()=>{
  const {history,selections}=makeMotorSensorMount();
  const selected=selections['sketch.mount'],view=inspect(history,selected);
  const original=JSON.stringify(history);
  const good=[{constraintId:'L:length',expectedValueMm:120,valueMm:144}];
  const request=cmd(history,selected,view,good);
  const invalid=[
    {expectedRevision:history.document.revision-1},
    {expectedProjectId:'another.project'},
    {sourceSketchId:'sketch.shim'},
    {extrudeFeatureId:'extrude.shim'},
    {targetBodyId:'body.shim'},
    {targetBodyId:'body.unknown'},
    {units:'cm'},{frame:'world'},
    {expectedAffectedFeatureIds:['sketch.mount','extrude.mount']},
    {expectedAffectedFeatureIds:['sketch.mount','cut.cable','extrude.shim']},
    {selection:{...selected,candidateId:'cycle:forged'}},
    {selection:{...selected,sourceSignature:'stale'}},
    {changes:[{constraintId:'L:length',expectedValueMm:110,valueMm:144}]},
    {changes:[{constraintId:'L:origin',expectedValueMm:0,valueMm:1}]},
    {changes:[...good,...good]},
    {changes:[{constraintId:'L:length',expectedValueMm:120,valueMm:120}]},
    {changes:[{constraintId:'L:holeLowerRadius',expectedValueMm:5,valueMm:-1}]},
    {changes:[{constraintId:'L:holeLowerRadius',expectedValueMm:5,valueMm:100}]},
    {changes:[{constraintId:'L:flangeHeight',expectedValueMm:30,valueMm:Infinity}]}
  ];
  for(const override of invalid){
    assert.throws(()=>editSelectedBodyProfileDimensions(history,
      {...request,...override},services),JSON.stringify(override));
    assert.equal(JSON.stringify(history),original);
  }
  const handle=view.dimensions.find(d=>d.constraintId==='L:holeLowerRadius').handle;
  const dragging={...selectBody(history,selected),
    expectedAffectedFeatureIds:view.affectedFeatureIds,eventId:'drag.bad',
    handleId:handle.id,target:{x:handle.position.x+1,y:handle.position.y}};
  for(const override of [
    {handleId:'dimension:unknown'}, {target:{x:Infinity,y:1}},
    {target:{x:handle.position.x-100,y:handle.position.y}},
    {expectedAffectedFeatureIds:['sketch.mount']},
    {targetBodyId:'body.shim'}, {selection:{...selected,sourceSignature:'x'}}
  ]){
    assert.throws(()=>dragSelectedBodyProfileDimension(history,
      {...dragging,...override},services),JSON.stringify(override));
    assert.equal(JSON.stringify(history),original);
  }
  assert.throws(()=>inspectSelectedBodyProfileDimensions(history,
    {...selectBody(history,selected),targetBodyId:'body.shim'},services));
});
test('one obsolete inspector cannot overwrite later committed edits',()=>{
  const {history,selections}=makeMotorSensorMount();
  const old=inspect(history,selections['sketch.mount']);
  const changed=applyDimensions(history,selections['sketch.mount'],old,
    [['L:length',144]]);
  assert.throws(()=>editSelectedBodyProfileDimensions(changed.history,
    {...cmd(changed.history,selections['sketch.mount'],old,[
      {constraintId:'L:length',expectedValueMm:120,valueMm:155}
    ]),selection:selections['sketch.mount']},services));
  assert.equal(find(changed.history,'extrude.mount').id,'extrude.mount');
});
test('public real consumer executes archive and independently unaffected body',()=>{
  const file=fileURLToPath(new URL(
    '../examples/motor-sensor-profile-revision.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',file],
    {encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||String(run.error));
  const report=JSON.parse(run.stdout);
  assert.equal(report.operation,'@intuit3d/feature-ops/body-profile-dimensions/v1');
  assert.equal(report.dimensions.lengthMm,144);
  assert.equal(report.dimensions.flangeHeightMm,36);
  assert.equal(report.dimensions.clearanceRadiusMm,7);
  assert.equal(report.mountThicknessMm,13);
  assert.equal(report.unrelatedShimDepthMm,3);
  assert.equal(report.independentShimUnaffected,true);
  assert.equal(report.retainedCutFeatureId,'cut.cable');
  assert.deepEqual(report.status.map(x=>x[1]),
    ['analytic_profile_only','preview_only','pending_exact_provider']);
  assert.equal(report.exactAuthority,false);
});
test('public example is callable with real injected services',()=>{
  const report=runDemo();
  assert.equal(report.revisions.edit,report.revisions.start+1);
  assert.equal(report.revisions.drag,report.revisions.edit+1);
});
