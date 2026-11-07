import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createModelExtrusion,createModelThroughCut,editModelDimension,inspectModelSession,
  modelFeatureTimeline,newModelSketchSession,previewModelProfile,previewModelSketchProfile,
  redoModelSession,reopenModelSession,runtime,serializeModelSession,undoModelSession,
} from './runtimeSession';

const status=(h:ReturnType<typeof newModelSketchSession>,id:string)=>
  inspectModelSession(h).features.find(f=>f.featureId===id)?.status;

test('genuine staged sketch -> extrude -> explicit body cut -> dimension edit -> undo/save/reopen',()=>{
  const sketch=newModelSketchSession('workbench.sketch-first.test');
  assert.deepEqual(modelFeatureTimeline(sketch).map(f=>f.featureId),['sketch.plate']);
  assert.equal(status(sketch,'sketch.plate'),'analytic_profile_only');
  assert.equal(previewModelSketchProfile(inspectModelSession(sketch))?.holes.length,2);
  assert.equal(previewModelProfile(inspectModelSession(sketch)),null);
  assert.throws(()=>createModelThroughCut(sketch),/extrusion before cutting/);
  assert.throws(()=>createModelExtrusion(sketch,0),/finite and positive/);

  const editedSketch=editModelDimension(sketch,'width',140);
  assert.equal(status(editedSketch,'sketch.plate'),'analytic_profile_only');
  assert.equal(modelFeatureTimeline(editedSketch).length,1);
  const extruded=createModelExtrusion(editedSketch,12);
  assert.deepEqual(modelFeatureTimeline(extruded).map(f=>f.featureId),
    ['sketch.plate','plate']);
  assert.equal(status(extruded,'plate'),'preview_only');
  assert.equal(previewModelProfile(inspectModelSession(extruded))?.thickness,12);
  assert.throws(()=>createModelExtrusion(extruded,14),/already exists/);

  const cut=createModelThroughCut(extruded);
  assert.deepEqual(modelFeatureTimeline(cut).map(f=>f.featureId),
    ['sketch.plate','plate','cut']);
  assert.equal(status(cut,'cut'),'pending_exact_provider');
  const cutFeature=cut.document.features.find(f=>f.id==='cut');
  assert.equal(cutFeature?.payload.targetBodyId,'body.plate');
  assert.equal(cutFeature?.payload.sourceSketchId,'sketch.plate');
  assert.throws(()=>createModelThroughCut(cut),/already exists/);
  const archived=reopenModelSession(serializeModelSession(cut));
  assert.equal(status(archived,'cut'),'pending_exact_provider');

  const wider=editModelDimension(archived,'width',155);
  const delta=runtime.diff(archived,wider);
  assert.equal(delta.exactReuseAllowed,false);
  assert.ok(delta.invalidatedFeatureIds.includes('plate'));
  assert.ok(delta.invalidatedFeatureIds.includes('cut'));
  const undone=undoModelSession(wider);
  assert.equal(status(undone,'cut'),'pending_exact_provider');
  const redone=redoModelSession(undone);
  assert.deepEqual(inspectModelSession(redone).authoredOrder,inspectModelSession(wider).authoredOrder);
  assert.equal(status(reopenModelSession(serializeModelSession(redone)),'cut'),'pending_exact_provider');
});

test('sketch-only and extruded-but-uncut archives are durable; undo isolates feature creation',()=>{
  const initial=newModelSketchSession('workbench.sketch-archive.test');
  const reopenedSketch=reopenModelSession(serializeModelSession(initial));
  assert.equal(modelFeatureTimeline(reopenedSketch).length,1);
  const extruded=createModelExtrusion(reopenedSketch,9);
  const reopenedExtrusion=reopenModelSession(serializeModelSession(extruded));
  assert.equal(status(reopenedExtrusion,'plate'),'preview_only');
  assert.equal(modelFeatureTimeline(reopenedExtrusion).length,2);
  const cut=createModelThroughCut(reopenedExtrusion);
  const undone=undoModelSession(cut);
  assert.equal(modelFeatureTimeline(undone).length,2);
  assert.equal(status(undone,'plate'),'preview_only');
  const redone=redoModelSession(undone);
  assert.equal(status(redone,'cut'),'pending_exact_provider');
  assert.notEqual(redone.document.revision,cut.document.revision);
});
