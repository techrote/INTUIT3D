import test from 'node:test';
import assert from 'node:assert/strict';
import { patternModelCircularHoles } from './circularHolePattern.ts';
import {
  inspectModelSession, modelHoleValues, newModelPlateSession, previewModelProfile,
  redoModelSession, reopenModelSession, serializeModelSession, undoModelSession,
} from './runtimeSession.ts';

const request={sourceHoleId:'holeA',instances:3,pivotXmm:60,pivotYmm:40,sweepDegrees:360};
const near=(actual:number,expected:number)=>
  assert.ok(Math.abs(actual-expected)<1e-8,'expected '+actual+' close to '+expected);

test('solved three-position bolt circle journals two holes, one undo frame and durable replay',()=>{
  const original=newModelPlateSession('workbench.circular.test'),snapshot=serializeModelSession(original);
  const result=patternModelCircularHoles(original,request);
  assert.equal(result.kind,'committed');
  if(result.kind!=='committed')return;
  const next=result.history;
  assert.equal(next.document.projectId,original.document.projectId);
  assert.equal(next.document.revision,original.document.revision+1);
  assert.equal(next.undoStack.length,original.undoStack.length+1);
  assert.equal(result.sketchStatus,'analytic_profile_only');
  assert.equal(result.report.exactGeometryAvailable,false);
  assert.deepEqual(result.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  const holes=modelHoleValues(next);
  const a=holes['orbit.'+original.document.revision+':p1'];
  const b=holes['orbit.'+original.document.revision+':p2'];
  assert.ok(a&&b);
  near(a.x,72.5);near(a.y,40-25*Math.sqrt(3)/2);
  near(b.x,72.5);near(b.y,40+25*Math.sqrt(3)/2);
  assert.equal(a.diameter,holes.holeA.diameter);
  assert.equal(b.diameter,holes.holeA.diameter);
  assert.deepEqual(holes.holeB,modelHoleValues(original).holeB);
  assert.equal(previewModelProfile(inspectModelSession(next))?.profile.holes.length,4);
  assert.equal(inspectModelSession(next).features.find(f=>f.featureId==='cut')?.status,'pending_exact_provider');
  assert.equal(serializeModelSession(original),snapshot);
  const reopened=reopenModelSession(serializeModelSession(next));
  assert.deepEqual(modelHoleValues(reopened),holes);
  const undone=undoModelSession(reopened);
  assert.deepEqual(modelHoleValues(undone),modelHoleValues(original));
  assert.deepEqual(modelHoleValues(redoModelSession(undone)),holes);
});

test('signed partial sweep includes terminal placement in selected direction',()=>{
  const initial=newModelPlateSession('workbench.circular.partial');
  const result=patternModelCircularHoles(initial,{...request,instances:2,sweepDegrees:-90});
  assert.equal(result.kind,'committed');
  if(result.kind!=='committed')return;
  const added=modelHoleValues(result.history)['orbit.'+initial.document.revision+':p1'];
  near(added.x,60);near(added.y,65);
  assert.equal(result.history.undoStack.length,initial.undoStack.length+1);
});

test('invalid controls and overlapping array refuse atomically without altering archive',()=>{
  const initial=newModelPlateSession('workbench.circular.invalid');
  const original=serializeModelSession(initial);
  for(const change of [
    {instances:1},{instances:33},{instances:2.5},
    {pivotXmm:NaN},{pivotYmm:10001},{sweepDegrees:0},
    {sweepDegrees:361},{sourceHoleId:'absent'},
    {pivotXmm:35,pivotYmm:40},
  ]){
    assert.throws(()=>patternModelCircularHoles(initial,{...request,...change}));
    assert.equal(serializeModelSession(initial),original);
  }
  // With 4 equally spaced samples, the 180-degree copy of holeA coincides
  // with the existing holeB; no partial journal transaction may survive.
  const overlapping=patternModelCircularHoles(initial,{...request,instances:4});
  assert.equal(overlapping.kind,'refused');
  if(overlapping.kind==='refused')assert.equal(overlapping.notCommitted,true);
  assert.equal(serializeModelSession(initial),original);
});
