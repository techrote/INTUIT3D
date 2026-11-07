import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editModelDimension, inspectModelSession, modelDimensionValues,
  newModelPlateSession, previewModelProfile, redoModelSession,
  reopenModelSession, runtime, serializeModelSession, undoModelSession,
} from './runtimeSession.ts';

const state=(r:ReturnType<typeof inspectModelSession>, id:string)=>
  r.features.find(f=>f.featureId===id)?.status;

test('browser plate consumes real INTENT/SKETCH/RUNTIME and preserves retrospective order',()=>{
  const h=newModelPlateSession(), report=inspectModelSession(h);
  assert.deepEqual(report.authoredOrder,['sketch.plate','plate','cut','parameter.t']);
  assert.ok(report.executableOrder.indexOf('parameter.t')<report.executableOrder.indexOf('plate'));
  assert.equal(state(report,'sketch.plate'),'analytic_profile_only');
  assert.equal(state(report,'plate'),'preview_only');
  assert.equal(state(report,'cut'),'pending_exact_provider');
  assert.equal(report.exactGeometryAvailable,false);
  assert.equal(previewModelProfile(report)?.profile.holes.length,2);
  assert.equal(previewModelProfile(report)?.thickness,10);
  assert.equal(modelDimensionValues(h).width,120);
  const reopened=reopenModelSession(serializeModelSession(h));
  assert.equal(serializeModelSession(reopened),serializeModelSession(h));
  assert.deepEqual(inspectModelSession(reopened),report);
});

test('historical width edit invalidates solid and cut, preserves bad intent, undo/redo recovers',()=>{
  const a=newModelPlateSession();
  const bad=editModelDimension(a,'width',90);
  const diff=runtime.diff(a,bad);
  assert.deepEqual(diff.changedFeatureIds,['sketch.plate']);
  assert.deepEqual(diff.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.equal(diff.exactReuseAllowed,false);
  const report=inspectModelSession(bad);
  assert.equal(modelDimensionValues(bad).width,90);
  assert.equal(state(report,'sketch.plate'),'invalid_profile');
  assert.equal(state(report,'plate'),'blocked_dependency');
  assert.equal(previewModelProfile(report),null);
  assert.equal(modelDimensionValues(a).width,120);
  const recovered=undoModelSession(bad);
  assert.equal(state(inspectModelSession(recovered),'plate'),'preview_only');
  assert.equal(modelDimensionValues(recovered).width,120);
  assert.equal(modelDimensionValues(redoModelSession(recovered)).width,90);
  assert.equal(state(inspectModelSession(reopenModelSession(serializeModelSession(bad))),'plate'),'blocked_dependency');
});

test('parameter and circle dimensional edits are journalled and persistent, not browser authority',()=>{
  let h=newModelPlateSession();
  h=editModelDimension(h,'thickness',14);
  assert.equal(previewModelProfile(inspectModelSession(h))?.thickness,14);
  const beforeCircle=h;
  h=editModelDimension(h,'holeDiameter',18);
  assert.equal(modelDimensionValues(h).holeDiameter,18);
  assert.equal(previewModelProfile(inspectModelSession(h))?.profile.holes[0]?.radius,9);
  assert.equal(modelDimensionValues(beforeCircle).holeDiameter,12);
  h=editModelDimension(h,'holePitch',110);
  assert.equal(modelDimensionValues(h).holePitch,110);
  assert.equal(previewModelProfile(inspectModelSession(h)),null);
  assert.equal(state(inspectModelSession(h),'sketch.plate'),'invalid_profile');
  const reopened=reopenModelSession(serializeModelSession(h));
  assert.equal(modelDimensionValues(reopened).thickness,14);
  assert.equal(modelDimensionValues(reopened).holePitch,110);
  assert.equal(modelDimensionValues(undoModelSession(reopened)).holePitch,50);
});

test('stale revision, bogus archive and invalid dimension cannot mutate original project',()=>{
  const h=newModelPlateSession(), fence=serializeModelSession(h);
  assert.throws(()=>editModelDimension(h,'width',0),/finite positive/);
  assert.throws(()=>editModelDimension(h,'thickness',Infinity),/finite positive/);
  assert.throws(()=>reopenModelSession('{"format":"nope"}'));
  assert.equal(serializeModelSession(h),fence);
  const after=editModelDimension(h,'depth',95);
  assert.throws(()=>runtime.commit(after,[{eventId:'edit.stale',type:'feature.remove',featureId:'cut'}],h.document.revision),/stale/i);
  assert.equal(modelDimensionValues(after).depth,95);
});
