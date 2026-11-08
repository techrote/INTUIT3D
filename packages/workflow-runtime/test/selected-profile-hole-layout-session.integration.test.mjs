import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createDimensionedLPlateSketch} from '@intuit3d/sketch/selected-profile/v1';
import {createWorkflowRuntime} from '../index.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';
import {createPersistentHistorySource} from '../persistent-history-source.mjs';

// Real INTENT transactions, SKETCH solver and selected-profile layout provider.
// This L-section is deliberately not a plate-v1 native/STEP qualification.
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const initial=()=>runtime.commit(transactions.startUndoHistory(model.newProject('runtime.profile.atomic-layout')),[
  {eventId:'seed.sketch',type:'feature.create',feature:{
    id:'sketch.L',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:createDimensionedLPlateSketch()}}},
  {eventId:'seed.plate',type:'feature.create',feature:{
    id:'plate',kind:'extrude',dependsOn:['sketch.L'],writeTargets:['body.L'],
    payload:{sourceSketchId:'sketch.L',thicknessMm:8}}},
  {eventId:'seed.cut',type:'feature.create',feature:{
    id:'cut',kind:'cut',dependsOn:['plate'],writeTargets:['body.L'],
    payload:{sourceSketchId:'sketch.L',targetBodyId:'body.L'}}},
]);
const memoryStorage=()=>({data:new Map(),
  getItem(key){return this.data.get(key)??null;},
  setItem(key,value){this.data.set(key,value);},
});
const controls=(session)=>{
  const {projectId,revision}=session.refresh();
  return session.inspectSelectedProfileHoleLayout({
    projectId,expectedRevision:revision,sketchFeatureId:'sketch.L',
  });
};
const swap=(inspection,eventId='layout.swap')=>({
  kind:'sketch.holes.selected-profile-layout',
  request:{sketchFeatureId:'sketch.L',eventId,
    selection:inspection.selection,
    command:{kind:'set-hole-layout',sourceSignature:inspection.sourceSignature,
      edits:[
        {holeId:'L:holeLower',xMm:20,yMm:60,radiusMm:4,anchorPointId:'L:a'},
        {holeId:'L:holeUpper',xMm:90,yMm:15,radiusMm:6},
      ]}},
});
const submit=(session,command)=>{
  const {projectId,revision}=session.refresh();
  return session.applyCommand({...command,projectId,expectedRevision:revision});
};
const hole=(inspection,id)=>inspection.holes.find(h=>h.holeId===id);
const close=(n,expected)=>assert.ok(Math.abs(n-expected)<1e-7,
  `expected ${n} near ${expected}`);

test('one selected-profile batch swaps holes, preserves semantic anchors, rebuilds, undo/reopen/replays',()=>{
  const storage=memoryStorage();
  const persisted=createPersistentHistorySource({runtime,storage,initialHistory:initial()});
  const session=createLivePlateSession({runtime,...persisted});
  const original=session.save();
  const before=controls(session);
  assert.equal(before.kind,'ready',JSON.stringify(before));
  assert.equal(before.inspection.kind,'selected_profile_hole_layout');
  assert.equal(before.inspection.nativeExact,false);
  assert.equal(before.exactAuthority,false);
  assert.equal(before.inspection.holes.length,2);
  assert.ok(before.inspection.holes.every(h=>h.canEdit));

  const result=submit(session,swap(before.inspection));
  assert.equal(result.kind,'committed',JSON.stringify(result));
  assert.deepEqual(result.invalidation.invalidatedFeatureIds,['sketch.L','plate','cut']);
  assert.equal(result.report.exactGeometryAvailable,false);
  assert.notEqual(session.save(),original);
  assert.equal(session.currentStep(),null);
  const edited=controls(session);
  assert.equal(edited.kind,'ready');
  assert.equal(edited.inspection.semanticProfileId,before.inspection.semanticProfileId);
  close(hole(edited.inspection,'L:holeLower').position.x,20);
  close(hole(edited.inspection,'L:holeLower').position.y,60);
  close(hole(edited.inspection,'L:holeLower').radiusMm,4);
  close(hole(edited.inspection,'L:holeUpper').position.x,90);
  close(hole(edited.inspection,'L:holeUpper').radiusMm,6);
  assert.equal(hole(edited.inspection,'L:holeLower').xReferencePointId,'L:a');

  const width=submit(session,{kind:'sketch.constraints',request:{
    sketchFeatureId:'sketch.L',eventId:'layout.length.150',
    admission:'require_admissible',
    edits:[{constraintId:'L:length',patch:{value:150}}]}});
  assert.equal(width.kind,'committed',JSON.stringify(width));
  const expanded=controls(session);
  assert.equal(expanded.kind,'ready');
  assert.equal(expanded.inspection.semanticProfileId,edited.inspection.semanticProfileId);
  close(hole(expanded.inspection,'L:holeLower').position.x,20);

  const saved=session.save();
  const reopened=createLivePlateSession({runtime,
    ...createPersistentHistorySource({runtime,storage})});
  assert.equal(reopened.save(),saved);
  assert.equal(reopened.currentStep(),null);
  assert.equal(controls(reopened).inspection.semanticProfileId,expanded.inspection.semanticProfileId);
  assert.equal(submit(reopened,{kind:'model.undo',eventIds:['layout.undo.width']}).kind,'committed');
  assert.equal(submit(reopened,{kind:'model.undo',eventIds:['layout.undo.swap']}).kind,'committed');
  const restored=controls(reopened);
  assert.equal(restored.kind,'ready');
  close(hole(restored.inspection,'L:holeLower').radiusMm,
    hole(before.inspection,'L:holeLower').radiusMm);
  close(hole(restored.inspection,'L:holeUpper').position.x,
    hole(before.inspection,'L:holeUpper').position.x);
  assert.equal(submit(reopened,{kind:'model.redo',eventIds:['layout.redo.swap']}).kind,'committed');
  assert.equal(submit(reopened,{kind:'model.redo',eventIds:['layout.redo.width']}).kind,'committed');
  const replayed=controls(reopened);
  assert.equal(replayed.kind,'ready');
  close(hole(replayed.inspection,'L:holeLower').position.x,20);
  close(hole(replayed.inspection,'L:holeUpper').radiusMm,6);
  assert.equal(replayed.inspection.semanticProfileId,expanded.inspection.semanticProfileId);
  assert.equal(reopened.currentStep(),null);
  session.cancel();reopened.cancel();
});

test('stale signature, invalid selection, overlapping targets and provider refusal never publish or evaluate native',async()=>{
  let current=initial(),publications=0,nativeCalls=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>current,
    publishHistory:h=>{current=h;publications++;},
    evaluateImpl:async()=>{nativeCalls++;throw new Error('a refused layout must not dispatch native');},
  });
  const before=controls(session);
  assert.equal(before.kind,'ready');
  const {projectId,revision}=session.refresh();
  assert.equal(session.inspectSelectedProfileHoleLayout({
    projectId:'other-project',expectedRevision:revision,sketchFeatureId:'sketch.L'
  }).code,'stale_command');
  assert.equal(session.inspectSelectedProfileHoleLayout({
    projectId,expectedRevision:revision,sketchFeatureId:'missing'
  }).code,'missing_sketch');
  assert.equal(session.inspectSelectedProfileHoleLayout({
    projectId,expectedRevision:revision,sketchFeatureId:'sketch.L',
    candidateId:'cycle:nonexistent'
  }).code,'profile_unavailable');
  const original=session.save();
  const collided=swap(before.inspection,'layout.overlap');
  collided.request.command.edits[1]={holeId:'L:holeUpper',xMm:20,yMm:60,radiusMm:6};
  const invalid=await session.applyCommandAndEvaluate({
    ...collided,projectId,expectedRevision:revision,
  });
  assert.equal(invalid.kind,'refused',JSON.stringify(invalid));
  assert.equal(invalid.evaluation,null);
  assert.equal(invalid.edit.notCommitted,true);
  const forged=swap(before.inspection,'layout.forged');
  forged.request.command.sourceSignature='forged';
  assert.equal(submit(session,forged).code,'stale_selection');
  assert.equal(session.save(),original);
  assert.equal(publications,0);
  assert.equal(nativeCalls,0);

  assert.equal(submit(session,swap(before.inspection)).kind,'committed');
  assert.equal(publications,1);
  const committed=session.save();
  const stale=await session.applyCommandAndEvaluate({
    ...swap(before.inspection,'layout.stale'),projectId,
    expectedRevision:current.document.revision,
  });
  assert.equal(stale.kind,'refused');
  assert.equal(stale.edit.reason,'stale_source');
  assert.equal(stale.evaluation,null);
  assert.equal(session.save(),committed);
  assert.equal(publications,1);
  assert.equal(nativeCalls,0);
  assert.equal(session.currentStep(),null);
  session.cancel();
});
