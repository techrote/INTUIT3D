/**
 * RUNTIME integration of accepted SKETCH selected-contour edge-hole authoring.
 * Uses REAL INTENT journal, SKETCH constraints, authoritative session and
 * localhost native transport. No native solid or fabricated exact STEP claim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {createDimensionedLPlateSketch} from '@intuit3d/sketch/selected-profile/v1';
import {inspectSelectedEdgeHolePlacement} from '@intuit3d/sketch/selected-edge-hole-placement/v1';
import {createWorkflowRuntime} from '../index.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';
import {createPersistentHistorySource} from '../persistent-history-source.mjs';
import {startLocalPlateBridge} from '../local-plate-bridge.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const initial=()=>{
  const h=transactions.startUndoHistory(model.newProject('runtime.edge.selected'));
  return runtime.commit(h,[
    {eventId:'edge.seed.sketch',type:'feature.create',feature:{
      id:'sketch.L',kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:createDimensionedLPlateSketch()}}},
    {eventId:'edge.seed.extrude',type:'feature.create',feature:{
      id:'plate',kind:'extrude',dependsOn:['sketch.L'],writeTargets:['body.L'],
      payload:{sourceSketchId:'sketch.L',thicknessMm:8}}},
    {eventId:'edge.seed.cut',type:'feature.create',feature:{
      id:'cut',kind:'cut',dependsOn:['plate'],writeTargets:['body.L'],
      payload:{sourceSketchId:'sketch.L',targetBodyId:'body.L'}}},
  ]);
};
const storage=()=>({
  records:new Map(),
  getItem(key){return this.records.get(key)??null;},
  setItem(key,value){this.records.set(key,value);}
});
const currentSketch=h=>model.featuresOf(h.document).find(f=>f.id==='sketch.L').payload.sketch;
const selected=h=>{
  const doc=currentSketch(h);
  const view=discovery.discoverPlateProfiles(doc);
  assert.equal(view.status,'ready');
  assert.equal(view.candidates.length,1);
  return {candidateId:view.candidates[0].id,
    sourceSignature:sketch.serializeSketch(doc)};
};
const operation=(selection,eventId,edits)=>({
  kind:'sketch.holes.selected-edge',
  request:{sketchFeatureId:'sketch.L',eventId,selection,
    command:{kind:'set-edge-holes',sourceSignature:selection.sourceSignature,edits}},
});
const add=(holeId='mount:a',alongMm=55)=>({
  holeId,edgeId:'L:edge0',alongMm,insetMm:15,radiusMm:4,
});
const submit=(session,action)=>{
  const {projectId,revision}=session.refresh();
  return session.applyCommand({...action,projectId,expectedRevision:revision});
};

test('selected-edge holes become real journal events: stable binding, retrospective dimension, grouped undo, durable reopen',()=>{
  const db=storage();
  const historySource=createPersistentHistorySource({runtime,storage:db,initialHistory:initial()});
  const session=createLivePlateSession({runtime,...historySource});
  const before=session.save();
  const selection=selected(historySource.readCurrentHistory());
  const baseline=runtime.inspect(historySource.readCurrentHistory());
  assert.equal(baseline.features.find(f=>f.featureId==='sketch.L').status,'analytic_profile_only');
  const result=submit(session,operation(selection,'edge.mount.two',[add(),add('mount:b',70)]));
  assert.equal(result.kind,'committed',JSON.stringify(result));
  assert.equal(result.report.revision,baseline.revision+1);
  assert.equal(result.exactAuthority,undefined,'session commits are model provenance, not native receipts');
  assert.deepEqual(result.invalidation.invalidatedFeatureIds,['sketch.L','plate','cut']);
  assert.equal(session.save()===before,false);
  let latest=historySource.readCurrentHistory();
  const check=inspectSelectedEdgeHolePlacement(currentSketch(latest),selected(latest));
  assert.equal(check.kind,'selected_edge_hole_placement',check.reason);
  for(const [id,along] of [['mount:a',55],['mount:b',70]]){
    const bound=check.holes.find(h=>h.holeId===id);
    assert.equal(bound.edgeBinding.edgeId,'L:edge0');
    assert.equal(bound.edgeBinding.alongMm,along);
    assert.equal(bound.edgeBinding.insetMm,15);
  }
  // Real solver edits the upstream width after the holes have been anchored.
  const width=submit(session,{
    kind:'sketch.constraints',request:{
      sketchFeatureId:'sketch.L',eventId:'edge.width.150',
      admission:'require_admissible',
      edits:[{constraintId:'L:length',patch:{value:150}}],
    },
  });
  assert.equal(width.kind,'committed',JSON.stringify(width));
  latest=historySource.readCurrentHistory();
  const widened=inspectSelectedEdgeHolePlacement(currentSketch(latest),selected(latest));
  assert.equal(widened.kind,'selected_edge_hole_placement',widened.reason);
  assert.equal(widened.holes.find(h=>h.holeId==='mount:a').position.x,55);
  assert.equal(widened.holes.find(h=>h.holeId==='mount:b').position.x,70);
  const saved=session.save();
  const reopened=createLivePlateSession({runtime,
    ...createPersistentHistorySource({runtime,storage:db})});
  assert.equal(reopened.save(),saved);
  assert.equal(reopened.currentStep(),null);
  const undoWidth=submit(reopened,{kind:'model.undo',eventIds:['edge.undo.width']});
  assert.equal(undoWidth.kind,'committed');
  const undoHoles=submit(reopened,{kind:'model.undo',eventIds:['edge.undo.holes']});
  assert.equal(undoHoles.kind,'committed');
  assert.deepEqual(inspectSelectedEdgeHolePlacement(
    currentSketch(runtime.reopen(reopened.save())),
    selected(runtime.reopen(reopened.save()))).holes.map(h=>h.holeId),
    ['L:holeLower','L:holeUpper']);
  const redoHoles=submit(reopened,{kind:'model.redo',eventIds:['edge.redo.holes']});
  assert.equal(redoHoles.kind,'committed');
  const redoWidth=submit(reopened,{kind:'model.redo',eventIds:['edge.redo.width']});
  assert.equal(redoWidth.kind,'committed');
  const redone=runtime.reopen(reopened.save());
  assert.equal(inspectSelectedEdgeHolePlacement(currentSketch(redone),
    selected(redone)).holes.find(h=>h.holeId==='mount:b').edgeBinding.alongMm,70);
  session.cancel();reopened.cancel();
});

test('stale signatures, overlapping holes and stale command revision never write or dispatch native evaluation',async()=>{
  let current=initial(),nativeCalls=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>current,publishHistory:h=>{current=h;},
    evaluateImpl:async()=>{nativeCalls++;throw new Error('must not evaluate');}});
  const selection=selected(current);
  const first=submit(session,operation(selection,'edge.first',[add()]));
  assert.equal(first.kind,'committed');
  const committedArchive=session.save();
  const previousRevision=current.document.revision;
  const old=await session.applyCommandAndEvaluate({
    ...operation(selection,'edge.stale',[add('mount:b',70)]),
    projectId:current.document.projectId,expectedRevision:current.document.revision,
  });
  assert.equal(old.kind,'refused');
  assert.equal(old.edit.code,'selected_edge_edit_refused');
  assert.equal(old.edit.reason,'stale_source');
  assert.equal(old.evaluation,null);
  assert.equal(session.save(),committedArchive);
  const currentSelection=selected(current);
  const duplicate=submit(session,operation(currentSelection,'edge.overlap',[
    add('mount:b',55),
  ]));
  assert.equal(duplicate.kind,'refused');
  assert.equal(duplicate.reason,'profile_rejected_after_edit');
  assert.equal(session.save(),committedArchive);
  const mismatch=submit(session,{
    ...operation(currentSelection,'edge.mismatch',[add('mount:b',70)]),
    request:{...operation(currentSelection,'edge.mismatch',[add('mount:b',70)]).request,
      command:{kind:'set-edge-holes',sourceSignature:'mismatched',edits:[add('mount:b',70)]}},
  });
  assert.equal(mismatch.code,'stale_selection');
  const stale=await session.applyCommandAndEvaluate({
    ...operation(currentSelection,'edge.revision',[add('mount:b',70)]),
    projectId:current.document.projectId,expectedRevision:previousRevision-1,
  });
  assert.equal(stale.kind,'refused');
  assert.equal(stale.edit.code,'stale_command');
  assert.equal(nativeCalls,0);
  assert.equal(session.save(),committedArchive);
  session.cancel();
});

test('selected L profile does not pretend the rectangle-only trusted bridge can export exact STEP',async()=>{
  let current=initial(),providerCalls=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>current,publishHistory:h=>{current=h;}});
  const selection=selected(current);
  const edited=submit(session,operation(selection,'edge.host.test',[add()]));
  assert.equal(edited.kind,'committed');
  const host=await startLocalPlateBridge({runtime,model,plateContract,
    runExperimentalPlate:async()=>{providerCalls++;throw new Error('unsupported L cannot dispatch');}});
  try {
    const outcome=await session.evaluate({url:host.url,token:host.token,
      requestId:'edge.unsupported',exportStep:true});
    assert.equal(outcome.kind,'unresolved');
    assert.equal(outcome.code,'unsupported_profile');
    assert.equal(providerCalls,0,'a nonrectangular selected profile cannot be sent to plate-v1');
    assert.equal(session.currentStep(),null);
    assert.equal(session.refresh().hasVerifiedStep,false);
  }finally{session.cancel();await host.close();}
});

test('live selected-edge inspector supplies editable controls and rejects stale selection without native dispatch',()=>{
  let current=initial(),nativeCalls=0,publications=0;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>current,
    publishHistory:h=>{publications++;current=h;},
    evaluateImpl:async()=>{nativeCalls++;throw new Error('read-only inspector dispatched native');}});
  const state=session.refresh(),before=session.save();
  const request={projectId:state.projectId,expectedRevision:state.revision,sketchFeatureId:'sketch.L'};
  const inspected=session.inspectSelectedEdgeHoles(request);
  assert.equal(inspected.kind,'ready',JSON.stringify(inspected));
  assert.equal(inspected.exactAuthority,false);
  assert.equal(inspected.inspection.previewOnly,true);
  assert.equal(inspected.inspection.nativeExact,false);
  assert.equal(inspected.inspection.sourceSignature,sketch.serializeSketch(currentSketch(current)));
  assert.equal(inspected.inspection.selection.sourceSignature,inspected.inspection.sourceSignature);
  assert.ok(inspected.inspection.edges.some(e=>e.edgeId==='L:edge0'&&e.editable));
  assert.equal(publications,0);
  assert.equal(nativeCalls,0);
  assert.equal(session.save(),before);
  assert.equal(session.inspectSelectedEdgeHoles({...request,projectId:'other.project'}).code,'stale_command');
  assert.equal(session.inspectSelectedEdgeHoles({...request,sketchFeatureId:'absent'}).code,'missing_sketch');
  assert.equal(session.inspectSelectedEdgeHoles({...request,candidateId:'cycle:absent'}).code,'profile_unavailable');
  assert.equal(publications,0);
  const accepted=submit(session,operation(inspected.inspection.selection,'edge.inspected.add',[add()]));
  assert.equal(accepted.kind,'committed',JSON.stringify(accepted));
  assert.equal(publications,1);
  assert.equal(session.inspectSelectedEdgeHoles(request).code,'stale_command');
  const next=session.refresh();
  const latest=session.inspectSelectedEdgeHoles({
    projectId:next.projectId,expectedRevision:next.revision,sketchFeatureId:'sketch.L'});
  assert.equal(latest.kind,'ready');
  assert.equal(latest.inspection.holes.find(h=>h.holeId==='mount:a').edgeBinding.alongMm,55);
  assert.notEqual(latest.inspection.sourceSignature,inspected.inspection.sourceSignature);
  assert.equal(nativeCalls,0);
  assert.equal(session.currentStep(),null);
  session.cancel();
});
