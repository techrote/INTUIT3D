/**
 * Physical design intent: two separate L-guard/backer relief cuts are migrated
 * together from a shared old profile to a new SKETCH, with an unrelated shim.
 * This is real persisted semantic CAD, not a native Boolean/STEP demonstration.
 */
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as cutSource from '@intuit3d/model/cut-profile-source';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {fileURLToPath} from 'node:url';
import {makeAssembly,authorRequest,polygon,runtime,services as base}
  from './coordinated-pockets.mjs';
import {authorCoordinatedBodyCuts}
  from '@intuit3d/feature-ops/coordinated-body-cuts/v1';
import {editExtrudeThickness} from '@intuit3d/feature-ops';
import {replaceSharedCutProfiles,SHARED_CUT_SOURCE_FORMAT,
  SHARED_CUT_SOURCE_VERSION}
  from '@intuit3d/feature-ops/shared-cut-source-retrofit/v1';
const services={...base,cutSource};
const byId=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);
export function runDemo(){
  const start=makeAssembly();
  let history=authorCoordinatedBodyCuts(start.history,
    authorRequest(start.history,start.candidates),services).history;
  const newSketch=polygon('relief.next',[[12,6],[30,6],[30,15],[12,15]]);
  const proposed=discovery.discoverPlateProfiles(newSketch);
  assert.equal(proposed.status,'ready');
  assert.equal(proposed.candidates.length,1);
  const newCandidate=proposed.candidates[0].id;
  history=runtime.commit(history,[{
    eventId:'create.sketch.relief.next',type:'feature.create',
    feature:{id:'sketch.relief.next',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:newSketch}}
  }],history.document.revision);
  const originalRevision=history.document.revision;
  const request={
    format:SHARED_CUT_SOURCE_FORMAT,version:SHARED_CUT_SOURCE_VERSION,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
    edits:[
      {eventId:'migrate.guard.relief',cutFeatureId:'cut.guard.relief',
        targetBodyId:'body.guard',expectedSourceSketchId:'sketch.relief',
        expectedProfileCandidateId:start.candidates['sketch.relief'],
        sourceSketchId:'sketch.relief.next',profileCandidateId:newCandidate,
        releasePreviousSketchDependency:true},
      {eventId:'migrate.backer.relief',cutFeatureId:'cut.backer.relief',
        targetBodyId:'body.backer',expectedSourceSketchId:'sketch.relief',
        expectedProfileCandidateId:start.candidates['sketch.relief'],
        sourceSketchId:'sketch.relief.next',profileCandidateId:newCandidate,
        releasePreviousSketchDependency:true}
    ],
    retireSketch:{eventId:'retire.sketch.relief',featureId:'sketch.relief'}
  };
  for(const bad of [
    {...request,expectedRevision:originalRevision-1},
    {...request,units:'cm'},
    {...request,edits:[request.edits[0],request.edits[0]]},
    {...request,edits:request.edits.map((e,i)=>i?{...e,targetBodyId:'body.shim'}:e)},
    {...request,edits:request.edits.map((e,i)=>i?{...e,profileCandidateId:'cycle:stale'}:e)},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,expectedProfileCandidateId:'cycle:stale'}:e)},
    {...request,retireSketch:{eventId:'retire.wrong',featureId:'sketch.guard'}}
  ]){
    assert.throws(()=>replaceSharedCutProfiles(history,bad,services));
    assert.equal(history.document.revision,originalRevision);
  }
  const result=replaceSharedCutProfiles(history,request,services);
  assert.equal(result.history.undoStack.length,history.undoStack.length+1);
  assert.equal(result.history.document.revision,originalRevision+3);
  assert.deepEqual(result.editedCutIds,['cut.guard.relief','cut.backer.relief']);
  assert.equal(result.retiredSketchId,'sketch.relief');
  assert.equal(byId(result.history,'sketch.relief'),undefined);
  for(const selected of request.edits){
    const cut=byId(result.history,selected.cutFeatureId);
    assert.equal(cut.payload.sourceSketchId,'sketch.relief.next');
    assert.equal(cut.payload.profileCandidateId,newCandidate);
    assert.equal(cut.payload.targetBodyId,selected.targetBodyId);
    assert.ok(!cut.dependsOn.includes('sketch.relief'));
    assert.ok(result.invalidation.invalidatedFeatureIds.includes(selected.cutFeatureId));
  }
  assert.ok(!result.invalidation.invalidatedFeatureIds.includes('extrude.shim'));
  const undone=runtime.undo(result.history,
    ['undo.retire.relief','undo.backer.relief','undo.guard.relief']);
  assert.ok(byId(undone,'sketch.relief'));
  assert.equal(byId(undone,'cut.guard.relief').payload.sourceSketchId,'sketch.relief');
  const redone=runtime.redo(undone,
    ['redo.guard.relief','redo.backer.relief','redo.retire.relief']);
  assert.equal(byId(redone,'sketch.relief'),undefined);
  history=runtime.reopen(runtime.save(redone));
  assert.equal(byId(history,'cut.backer.relief').payload.profileCandidateId,newCandidate);
  const thicker=editExtrudeThickness(history,{
    eventId:'edit.guard.depth',featureId:'extrude.guard',
    expectedRevision:history.document.revision,thicknessMm:14},services);
  assert.ok(thicker.invalidation.invalidatedFeatureIds.includes('cut.guard.relief'));
  assert.ok(!thicker.invalidation.invalidatedFeatureIds.includes('extrude.shim'));
  assert.ok(!thicker.invalidation.invalidatedFeatureIds.includes('cut.backer.relief'));
  const beforeSource=byId(thicker.history,'sketch.relief.next');
  const resized=polygon('relief.next',[[14,5],[32,5],[32,14],[14,14]]);
  const revised=runtime.commit(thicker.history,[{
    eventId:'resize.shared.new.relief',type:'feature.edit',
    featureId:'sketch.relief.next',
    patch:{payload:{...beforeSource.payload,sketch:resized}}
  }],thicker.history.document.revision);
  const affected=runtime.diff(thicker.history,revised).invalidatedFeatureIds;
  assert.ok(affected.includes('cut.guard.relief'));
  assert.ok(affected.includes('cut.backer.relief'));
  assert.ok(!affected.includes('extrude.shim'));
  history=runtime.reopen(runtime.save(revised));
  assert.equal(byId(history,'extrude.guard').payload.thicknessMm,14);
  assert.equal(byId(history,'extrude.shim').payload.thicknessMm,3);
  return {kind:'real_SKETCH_INTENT_RUNTIME_consumer',
    part:'L-shaped machine guard, independent backing rail and shim',
    editedCutIds:result.editedCutIds,
    oldSketchRetired:result.retiredSketchId,
    undoFrames:1,undoRedoArchive:'passed',
    invalidSelections:'refused_before_mutation',
    guardDepthMm:14,unchangedShimDepthMm:3,
    sourceEditInvalidated:affected,
    statuses:result.cuts.map(x=>x.status),
    semanticStatus:'ready',nativeBrep:'not_executed',step:'not_executed',
    exactAuthority:false,independentInteroperability:false};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  console.log(JSON.stringify(runDemo(),null,2));
