import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editModelDimension,modelHoleIsCartesian,modelHoleValues,newModelPlateSession,
  reopenModelSession,serializeModelSession,undoModelSession,redoModelSession,
} from './runtimeSession.ts';
import {
  inspectModelEdgeHoles,commitModelEdgeHole,removeModelEdgeHole,
} from './selectedEdgeHole.ts';

const reviewOf=(history:ReturnType<typeof newModelPlateSession>)=>{
  const review=inspectModelEdgeHoles(history);
  assert.equal(review.kind,'ready',review.kind==='refused'?review.reason:'');
  if(review.kind!=='ready')throw Error('No selected contour');
  assert.equal(review.exactAuthority,false);
  assert.equal(review.inspection.nativeExact,false);
  assert.equal(review.inspection.previewOnly,true);
  return review;
};
const proposal=(review:ReturnType<typeof reviewOf>,holeId='hole.edge.test1')=>{
  const edge=review.inspection.edges.find(e=>e.editable&&e.lengthMm>=70);
  assert.ok(edge,'requires real solver-constrained boundary edge');
  return {holeId,edgeId:edge.edgeId,alongMm:edge.lengthMm/2,insetMm:15,radiusMm:4};
};

test('real selected-edge editor adds solver-anchored hole with semantic identity, single undo and archive replay',()=>{
  const source=newModelPlateSession('web.edge.test');
  const base=serializeModelSession(source);
  const review=reviewOf(source);
  const edit=proposal(review);
  const result=commitModelEdgeHole(source,review,edit);
  assert.equal(result.kind,'committed',result.kind==='refused'?result.reason:'');
  if(result.kind!=='committed')return;
  assert.deepEqual(result.createdHoleIds,[edit.holeId]);
  assert.equal(result.history.document.revision,source.document.revision+1);
  assert.equal(result.exactAuthority,false);
  assert.ok(result.invalidation.invalidatedFeatureIds.includes('sketch.plate'));
  assert.equal(modelHoleIsCartesian(result.history,edit.holeId),false);
  const inspected=reviewOf(result.history);
  const hole=inspected.inspection.holes.find(h=>h.holeId===edit.holeId);
  assert.ok(hole?.edgeBinding);
  assert.equal(hole.edgeBinding.edgeId,edit.edgeId);
  assert.equal(hole.edgeBinding.alongMm,edit.alongMm);
  assert.equal(hole.edgeBinding.insetMm,edit.insetMm);
  const solved=modelHoleValues(result.history)[edit.holeId];
  assert.equal(solved.diameter,8);
  assert.ok(Math.abs(solved.x-hole.position.x)<1e-8);
  assert.ok(Math.abs(solved.y-hole.position.y)<1e-8);
  const serialized=serializeModelSession(result.history);
  const reopened=reopenModelSession(serialized);
  assert.equal(serializeModelSession(reopened),serialized);
  assert.deepEqual(modelHoleValues(reopened)[edit.holeId],solved);
  const undone=undoModelSession(reopened);
  assert.equal(serializeModelSession(undone)===base,false,'undo adds a valid journal frame');
  assert.equal(Object.hasOwn(modelHoleValues(undone),edit.holeId),false);
  const redone=redoModelSession(undone);
  assert.deepEqual(modelHoleValues(redone)[edit.holeId],solved);
  const width=editModelDimension(redone,'width',150);
  const widened=reviewOf(width);
  const bound=widened.inspection.holes.find(h=>h.holeId===edit.holeId);
  assert.equal(bound?.edgeBinding?.alongMm,edit.alongMm);
  assert.equal(bound?.edgeBinding?.insetMm,edit.insetMm);
  assert.equal(modelHoleValues(width)[edit.holeId].diameter,8);
});

test('stale, overlapping, invalid and removal proposals do not silently publish or reuse STEP',()=>{
  const source=newModelPlateSession('web.edge.negative');
  const review=reviewOf(source),edit=proposal(review);
  const result=commitModelEdgeHole(source,review,edit);
  assert.equal(result.kind,'committed',result.kind==='refused'?result.reason:'');
  if(result.kind!=='committed')return;
  const latest=result.history,saved=serializeModelSession(latest);
  assert.throws(()=>commitModelEdgeHole(latest,review,{...edit,holeId:'hole.edge.second'}),/stale/);
  assert.throws(()=>commitModelEdgeHole(latest,reviewOf(latest),{...edit,holeId:'hole.edge.second',radiusMm:0}),/positive radius/);
  const collision=commitModelEdgeHole(latest,reviewOf(latest),{...edit,holeId:'hole.edge.second'});
  assert.equal(collision.kind,'refused');
  assert.equal(serializeModelSession(latest),saved);
  const removed=removeModelEdgeHole(latest,edit.holeId);
  assert.equal(removed.kind,'committed',removed.kind==='refused'?removed.reason:'');
  if(removed.kind!=='committed')return;
  assert.equal(Object.hasOwn(modelHoleValues(removed.history),edit.holeId),false);
  assert.equal(Object.hasOwn(modelHoleValues(undoModelSession(removed.history)),edit.holeId),true);
  assert.equal(serializeModelSession(latest),saved,'immutable source unchanged');
});
