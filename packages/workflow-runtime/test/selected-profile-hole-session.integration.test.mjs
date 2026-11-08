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
import {inspectSelectedProfileHoleAuthoring} from '@intuit3d/sketch/selected-profile-hole-authoring/v1';
import {createWorkflowRuntime} from '../index.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';
import {createPersistentHistorySource} from '../persistent-history-source.mjs';

// Real accepted INTENT journal and SKETCH solver, no fake exact provider.
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const initial=()=>runtime.commit(transactions.startUndoHistory(model.newProject('runtime.profile.holes')),[
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
const makeStore=()=>({data:new Map(),
  getItem(key){return this.data.get(key)??null;},
  setItem(key,value){this.data.set(key,value);},
});
const source=h=>model.featuresOf(h.document).find(f=>f.id==='sketch.L').payload.sketch;
const selection=h=>{
  const doc=source(h),found=discovery.discoverPlateProfiles(doc);
  assert.equal(found.status,'ready');
  assert.equal(found.candidates.length,1);
  return {candidateId:found.candidates[0].id,sourceSignature:sketch.serializeSketch(doc)};
};
const edit=(sel,eventId,command)=>({kind:'sketch.holes.selected-profile',request:{
  sketchFeatureId:'sketch.L',eventId,selection:sel,
  command:{...command,sourceSignature:sel.sourceSignature},
}});
const submit=(session,action)=>{
  const {projectId,revision}=session.refresh();
  return session.applyCommand({...action,projectId,expectedRevision:revision});
};
const view=h=>inspectSelectedProfileHoleAuthoring(source(h),selection(h));
const approx=(n,x)=>assert.ok(Math.abs(n-x)<1e-6,`expected ${n} near ${x}`);

test('selected-profile add/reanchor, retrospective rebuild, undo/redo and durable reopen',()=>{
  const db=makeStore();
  const persisted=createPersistentHistorySource({runtime,storage:db,initialHistory:initial()});
  const session=createLivePlateSession({runtime,...persisted});
  const oldArchive=session.save();
  let selected=selection(persisted.readCurrentHistory());
  const created=submit(session,edit(selected,'mount.add',{
    kind:'add-hole',holeId:'mount:profile',anchorPointId:'L:a',
    xMm:60,yMm:15,radiusMm:4}));
  assert.equal(created.kind,'committed',JSON.stringify(created));
  assert.deepEqual(created.invalidation.invalidatedFeatureIds,['sketch.L','plate','cut']);
  assert.equal(created.report.features.find(f=>f.featureId==='sketch.L').status,'analytic_profile_only');
  assert.notEqual(session.save(),oldArchive);
  assert.equal(view(persisted.readCurrentHistory()).holes.find(h=>h.holeId==='mount:profile')
    .xReferencePointId,'L:a');
  selected=selection(persisted.readCurrentHistory());
  const reanchored=submit(session,edit(selected,'mount.reanchor',{
    kind:'reanchor-hole',holeId:'mount:profile',anchorPointId:'L:b'}));
  assert.equal(reanchored.kind,'committed',JSON.stringify(reanchored));
  const resized=submit(session,{kind:'sketch.constraints',request:{
    sketchFeatureId:'sketch.L',eventId:'mount.length.150',
    admission:'require_admissible',edits:[{constraintId:'L:length',patch:{value:150}}]}});
  assert.equal(resized.kind,'committed',JSON.stringify(resized));
  let anchor=view(persisted.readCurrentHistory());
  assert.equal(anchor.kind,'selected_profile_hole_authoring',anchor.reason);
  const mounted=anchor.holes.find(h=>h.holeId==='mount:profile');
  assert.equal(mounted.xReferencePointId,'L:b');
  approx(mounted.position.x,90);
  approx(mounted.position.y,15);
  const archiveNow=session.save();
  const reopened=createLivePlateSession({runtime,
    ...createPersistentHistorySource({runtime,storage:db})});
  assert.equal(reopened.save(),archiveNow);
  assert.equal(reopened.currentStep(),null);
  for(const id of ['mount.undo.length','mount.undo.anchor','mount.undo.add']){
    assert.equal(submit(reopened,{kind:'model.undo',eventIds:[id]}).kind,'committed');
  }
  assert.equal(view(runtime.reopen(reopened.save())).holes.some(h=>h.holeId==='mount:profile'),false);
  for(const id of ['mount.redo.add','mount.redo.anchor','mount.redo.length']){
    assert.equal(submit(reopened,{kind:'model.redo',eventIds:[id]}).kind,'committed');
  }
  approx(view(runtime.reopen(reopened.save())).holes.find(h=>h.holeId==='mount:profile').position.x,90);
  session.cancel();reopened.cancel();
});

test('stale source, mismatched signature, invalid anchor and overlapping holes refuse atomically; remove can be undone',async()=>{
  let current=initial(),nativeCalls=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>current,publishHistory:h=>{current=h;},
    evaluateImpl:async()=>{nativeCalls++;throw new Error('should not dispatch');}});
  const first=selection(current);
  assert.equal(submit(session,edit(first,'mount.seed',{
    kind:'add-hole',holeId:'mount:profile',anchorPointId:'L:a',
    xMm:60,yMm:15,radiusMm:4})).kind,'committed');
  const archiveNow=session.save(),sel=selection(current);
  const bad=await session.applyCommandAndEvaluate({...edit(sel,'mount.bad.anchor',{
    kind:'reanchor-hole',holeId:'mount:profile',anchorPointId:'unknown'}),
    projectId:current.document.projectId,expectedRevision:current.document.revision});
  assert.equal(bad.kind,'refused');
  assert.equal(bad.edit.reason,'unknown_selected_anchor');
  assert.equal(bad.evaluation,null);
  assert.equal(submit(session,edit(first,'mount.stale',{
    kind:'remove-hole',holeId:'mount:profile'})).reason,'stale_source');
  const forged=edit(sel,'mount.forged',{kind:'remove-hole',holeId:'mount:profile'});
  forged.request.command.sourceSignature='forged';
  assert.equal(submit(session,forged).code,'stale_selection');
  const overlap=submit(session,edit(sel,'mount.overlap',{
    kind:'add-hole',holeId:'mount:conflict',anchorPointId:'L:a',
    xMm:60,yMm:15,radiusMm:4}));
  assert.equal(overlap.kind,'refused');
  assert.equal(overlap.reason,'profile_rejected_after_edit');
  assert.equal(session.save(),archiveNow);
  assert.equal(session.currentStep(),null);
  assert.equal(nativeCalls,0);
  assert.equal(submit(session,edit(sel,'mount.remove',{
    kind:'remove-hole',holeId:'mount:profile'})).kind,'committed');
  assert.equal(view(current).holes.some(h=>h.holeId==='mount:profile'),false);
  assert.equal(submit(session,{kind:'model.undo',eventIds:['mount.restore']}).kind,'committed');
  assert.equal(view(current).holes.some(h=>h.holeId==='mount:profile'),true);
  session.cancel();
});

test('session inspector exposes current profile anchors and refuses stale/foreign selection without native dispatch',()=>{
  let current=initial(),nativeCalls=0,publications=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>current,
    publishHistory:h=>{publications++;current=h;},
    evaluateImpl:async()=>{nativeCalls++;throw new Error('inspector must not dispatch native');}});
  const state=session.refresh(),archiveBefore=session.save();
  const request={projectId:state.projectId,expectedRevision:state.revision,
    sketchFeatureId:'sketch.L'};
  const inspected=session.inspectSelectedProfileHoles(request);
  assert.equal(inspected.kind,'ready',JSON.stringify(inspected));
  assert.equal(inspected.inspection.nativeExact,false);
  assert.equal(inspected.exactAuthority,false);
  assert.equal(inspected.inspection.selection.sourceSignature,sketch.serializeSketch(source(current)));
  assert.ok(inspected.inspection.anchors.some(x=>x.pointId==='L:a'));
  assert.equal(publications,0);
  assert.equal(nativeCalls,0);
  assert.equal(session.save(),archiveBefore);
  assert.equal(session.inspectSelectedProfileHoles({...request,
    projectId:'different.project'}).code,'stale_command');
  assert.equal(session.inspectSelectedProfileHoles({...request,
    sketchFeatureId:'sketch.missing'}).code,'missing_sketch');
  assert.equal(session.inspectSelectedProfileHoles({...request,
    candidateId:'cycle:absent'}).code,'profile_unavailable');
  assert.equal(publications,0);
  const result=submit(session,edit(inspected.inspection.selection,'mount.inspect.add',{
    kind:'add-hole',holeId:'mount:inspected',anchorPointId:'L:a',
    xMm:60,yMm:15,radiusMm:4}));
  assert.equal(result.kind,'committed');
  assert.equal(publications,1);
  assert.equal(session.inspectSelectedProfileHoles(request).code,'stale_command');
  const next=session.refresh();
  const currentView=session.inspectSelectedProfileHoles({
    projectId:next.projectId,expectedRevision:next.revision,sketchFeatureId:'sketch.L'});
  assert.equal(currentView.kind,'ready');
  assert.equal(currentView.inspection.holes.find(h=>h.holeId==='mount:inspected')
    .xReferencePointId,'L:a');
  assert.notEqual(currentView.inspection.sourceSignature,inspected.inspection.sourceSignature);
  assert.equal(nativeCalls,0);
  assert.equal(session.currentStep(),null);
  session.cancel();
});
