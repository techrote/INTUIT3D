import test from 'node:test';
import assert from 'node:assert/strict';
import {stampSelectedModelHoles,removeSelectedModelHoles} from './selectedHoleStamp.ts';
import {editModelHole,inspectModelSession,modelHoleValues,newModelPlateSession,
  previewModelProfile,redoModelSession,reopenModelSession,serializeModelSession,
  undoModelSession} from './runtimeSession.ts';

test('stamp selected solved holes as one journal event; preserve source IDs and independent copied radii',()=>{
  const original=newModelPlateSession('workbench.stamp.selected');
  const baseline=modelHoleValues(original);
  const stamp=stampSelectedModelHoles(original,{
    holeIds:['holeA','holeB'],deltaXmm:20,deltaYmm:0,
  });
  assert.equal(stamp.result.kind,'committed',stamp.result.kind==='refused'?stamp.result.reason:'');
  if(stamp.result.kind!=='committed')return;
  assert.deepEqual(stamp.copiedHoleIds,
    [`stamp.${original.document.revision}:0`,`stamp.${original.document.revision}:1`]);
  const changed=stamp.result.history;
  assert.equal(changed.document.revision,original.document.revision+1);
  assert.equal(changed.undoStack.length,original.undoStack.length+1);
  assert.equal(stamp.result.invalidation.exactReuseAllowed,false);
  assert.deepEqual(stamp.result.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  for(const [index,id] of stamp.copiedHoleIds.entries()){
    const source=baseline[index===0?'holeA':'holeB'];
    assert.deepEqual(modelHoleValues(changed)[id],
      {x:source.x+20,y:source.y,diameter:source.diameter});
  }
  assert.deepEqual([modelHoleValues(changed).holeA,modelHoleValues(changed).holeB],
    [baseline.holeA,baseline.holeB]);
  assert.equal(previewModelProfile(stamp.result.report)?.profile.holes.length,4);
  assert.equal(stamp.result.report.features.find(f=>f.featureId==='cut')?.status,'pending_exact_provider');
  const reopened=reopenModelSession(serializeModelSession(changed));
  assert.deepEqual(modelHoleValues(reopened),modelHoleValues(changed));
  assert.deepEqual(modelHoleValues(undoModelSession(reopened)),baseline);
  assert.deepEqual(modelHoleValues(redoModelSession(undoModelSession(reopened))),modelHoleValues(changed));
  const edited=editModelHole(reopened,'holeA','diameter',8);
  assert.equal(edited.kind,'committed');
  if(edited.kind==='committed')
    assert.equal(modelHoleValues(edited.history)[stamp.copiedHoleIds[0]].diameter,12,
      'stamped circles must remain independent of their source');
});

test('stamping rejects overlap, out-of-profile placement, zero displacement, bad and duplicate selections without mutation',()=>{
  const h=newModelPlateSession('workbench.stamp.reject');
  const original=serializeModelSession(h);
  for(const offset of [{deltaXmm:2,deltaYmm:0},{deltaXmm:200,deltaYmm:0}]){
    assert.throws(()=>stampSelectedModelHoles(h,{holeIds:['holeA'],...offset}),
      /overlap|outside/);
  }
  assert.throws(()=>stampSelectedModelHoles(h,{holeIds:['holeA'],deltaXmm:0,deltaYmm:0}),/nonzero/);
  assert.throws(()=>stampSelectedModelHoles(h,{holeIds:['holeA','holeA'],deltaXmm:20,deltaYmm:0}),/distinct/);
  assert.throws(()=>stampSelectedModelHoles(h,{holeIds:['missing'],deltaXmm:20,deltaYmm:0}),/unknown/);
  assert.throws(()=>stampSelectedModelHoles(h,{holeIds:['holeA'],deltaXmm:Infinity,deltaYmm:0}),/finite/);
  assert.equal(serializeModelSession(h),original);
});

test('remove multiple selected custom holes atomically; undo/redo and archive preserve semantic identity',()=>{
  const h=newModelPlateSession('workbench.stamp.remove');
  const result=stampSelectedModelHoles(h,{
    holeIds:['holeA','holeB'],deltaXmm:20,deltaYmm:0,
  });
  assert.equal(result.result.kind,'committed');
  if(result.result.kind!=='committed')return;
  const before=result.result.history;
  assert.throws(()=>removeSelectedModelHoles(before,['holeA',result.copiedHoleIds[0]]),/Base holes/);
  assert.throws(()=>removeSelectedModelHoles(before,[result.copiedHoleIds[0],result.copiedHoleIds[0]]),/distinct/);
  assert.throws(()=>removeSelectedModelHoles(before,['missing']),/unknown/);
  const removed=removeSelectedModelHoles(before,result.copiedHoleIds);
  assert.equal(removed.kind,'committed',removed.kind==='refused'?removed.reason:'');
  if(removed.kind!=='committed')return;
  assert.equal(removed.history.document.revision,before.document.revision+1);
  assert.equal(removed.history.undoStack.length,before.undoStack.length+1);
  assert.equal(Object.keys(modelHoleValues(removed.history)).length,2);
  assert.equal(previewModelProfile(inspectModelSession(removed.history))?.profile.holes.length,2);
  assert.equal(removed.invalidation.exactReuseAllowed,false);
  const reopened=reopenModelSession(serializeModelSession(removed.history));
  assert.deepEqual(modelHoleValues(undoModelSession(reopened)),modelHoleValues(before));
  assert.deepEqual(modelHoleValues(redoModelSession(undoModelSession(reopened))),modelHoleValues(removed.history));
});
