import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editModelDimension, inspectModelSession, modelDimensionValues, modelFeatureRemovalImpact,
  modelFeatureTimeline, newModelPlateSession, previewModelProfile, redoModelSession,
  removeModelFeature, reopenModelSession, restoreModelFeature, serializeModelSession, undoModelSession,
} from './runtimeSession.ts';

const state=(h:ReturnType<typeof newModelPlateSession>,id:string)=>
  inspectModelSession(h).features.find(f=>f.featureId===id)?.status;

test('remove plate retains pending cut, never shows prior solid as current; restore keeps stable IDs',()=>{
  const initial=newModelPlateSession('workbench.lifecycle.single');
  const impact=modelFeatureRemovalImpact(initial,'plate');
  assert.deepEqual(impact.transitiveDependents,['cut']);
  const removed=removeModelFeature(initial,'plate').history;
  assert.equal(modelFeatureTimeline(removed).find(f=>f.featureId==='plate')?.active,false);
  assert.equal(modelFeatureTimeline(removed).find(f=>f.featureId==='cut')?.active,true);
  assert.equal(previewModelProfile(inspectModelSession(removed)),null);
  assert.notEqual(state(removed,'cut'),'pending_exact_provider');
  assert.equal(state(removed,'plate'),undefined);
  const reopened=reopenModelSession(serializeModelSession(removed));
  assert.equal(serializeModelSession(reopened),serializeModelSession(removed));
  assert.equal(modelFeatureTimeline(reopened).find(f=>f.featureId==='plate')?.active,false);
  const restored=restoreModelFeature(reopened,'plate');
  assert.equal(modelFeatureTimeline(restored).find(f=>f.featureId==='plate')?.active,true);
  assert.equal(previewModelProfile(inspectModelSession(restored))?.thickness,10);
  assert.equal(state(restored,'cut'),'pending_exact_provider');
  const edited=editModelDimension(restored,'width',140);
  assert.equal(modelDimensionValues(edited).width,140);
  assert.equal(state(edited,'plate'),'preview_only');
  assert.equal(state(undoModelSession(edited),'plate'),'preview_only');
  assert.equal(modelDimensionValues(undoModelSession(edited)).width,120);
  assert.equal(modelDimensionValues(redoModelSession(undoModelSession(edited))).width,140);
});

test('explicit cascade removes both extrusion and cut as one reversible history frame',()=>{
  const initial=newModelPlateSession('workbench.lifecycle.cascade');
  const deleted=removeModelFeature(initial,'plate',true);
  assert.deepEqual(deleted.impact.cascadeIds,['plate','cut']);
  const rows=modelFeatureTimeline(deleted.history);
  assert.equal(rows.find(f=>f.featureId==='plate')?.active,false);
  assert.equal(rows.find(f=>f.featureId==='cut')?.active,false);
  assert.equal(previewModelProfile(inspectModelSession(deleted.history)),null);
  const undone=undoModelSession(deleted.history);
  assert.equal(modelFeatureTimeline(undone).find(f=>f.featureId==='plate')?.active,true);
  assert.equal(modelFeatureTimeline(undone).find(f=>f.featureId==='cut')?.active,true);
  const redone=redoModelSession(undone);
  assert.equal(modelFeatureTimeline(redone).find(f=>f.featureId==='cut')?.active,false);
  const archived=reopenModelSession(serializeModelSession(redone));
  const plateOnly=restoreModelFeature(archived,'plate');
  assert.equal(state(plateOnly,'plate'),'preview_only');
  assert.equal(modelFeatureTimeline(plateOnly).find(f=>f.featureId==='cut')?.active,false);
  const fullyRestored=restoreModelFeature(plateOnly,'cut');
  assert.equal(state(fullyRestored,'cut'),'pending_exact_provider');
});

test('restoring a cut before its removed parent retains unresolved intent, not invented solid',()=>{
  const initial=newModelPlateSession('workbench.lifecycle.pending');
  const both=removeModelFeature(initial,'plate',true).history;
  const cutOnly=restoreModelFeature(both,'cut');
  assert.equal(modelFeatureTimeline(cutOnly).find(f=>f.featureId==='plate')?.active,false);
  assert.equal(modelFeatureTimeline(cutOnly).find(f=>f.featureId==='cut')?.active,true);
  assert.equal(previewModelProfile(inspectModelSession(cutOnly)),null);
  assert.notEqual(state(cutOnly,'cut'),'pending_exact_provider');
  assert.equal(state(restoreModelFeature(cutOnly,'plate'),'cut'),'pending_exact_provider');
});

test('unsupported source deletion and double restoration cannot mutate authoritative journal',()=>{
  const initial=newModelPlateSession('workbench.lifecycle.negative');
  const saved=serializeModelSession(initial);
  assert.throws(()=>removeModelFeature(initial,'sketch.plate'),/supports removing only/);
  assert.throws(()=>restoreModelFeature(initial,'plate'),/no inactive tombstone/);
  const deleted=removeModelFeature(initial,'cut').history;
  assert.equal(state(deleted,'cut'),undefined);
  assert.equal(state(restoreModelFeature(deleted,'cut'),'cut'),'pending_exact_provider');
  assert.equal(serializeModelSession(initial),saved);
  const foreign=newModelPlateSession('workbench.other');
  assert.throws(()=>reopenModelSession(serializeModelSession(foreign).replaceAll('sketch.plate','sketch.foreign')),/supported plate\/sketch\/cut history|Missing authoritative/);
});
