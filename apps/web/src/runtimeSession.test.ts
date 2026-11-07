import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addModelHole, editModelDimension, editModelHole, editModelSketchHandle, inspectModelSession, modelDimensionValues, modelHoleValues, moveModelHoleCenter, moveModelHoleGroup, moveModelFeature, removeModelHole,
  makeModelThicknessIndependent, modelThicknessBinding, newModelPlateSession, patternModelHoles, previewModelProfile, redoModelSession, resizeModelHoleLayout,
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


test('new plate projects cannot silently reuse an existing semantic project identity',()=>{
  const first=newModelPlateSession('workbench.plate.first');
  const second=newModelPlateSession('workbench.plate.second');
  assert.equal(first.document.projectId,'workbench.plate.first');
  assert.equal(second.document.projectId,'workbench.plate.second');
  assert.notEqual(first.document.projectId,second.document.projectId);
  assert.deepEqual(inspectModelSession(first).authoredOrder,inspectModelSession(second).authoredOrder);
  assert.equal(previewModelProfile(inspectModelSession(second))?.profile.holes.length,2);
  const reopened=reopenModelSession(serializeModelSession(second));
  assert.equal(reopened.document.projectId,'workbench.plate.second');
});

test('individual hole diameter is one authoritative constraint edit with undo and archive replay',()=>{
  const initial=newModelPlateSession();
  const before=modelHoleValues(initial);
  assert.deepEqual(before,{holeA:{x:35,y:40,diameter:12},holeB:{x:85,y:40,diameter:12}});
  const result=editModelHole(initial,'holeA','diameter',16);
  assert.equal(result.kind,'committed');
  if(result.kind!=='committed')return;
  assert.equal(modelHoleValues(result.history).holeA.diameter,16);
  assert.equal(modelHoleValues(result.history).holeB.diameter,12);
  assert.deepEqual(result.invalidation.changedFeatureIds,['sketch.plate']);
  assert.deepEqual(result.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.equal(result.sketchStatus,'analytic_profile_only');
  assert.equal(result.report.exactGeometryAvailable,false);
  assert.equal(previewModelProfile(result.report)?.profile.holes.find(x=>x.id==='holeA')?.radius,8);
  const reopened=reopenModelSession(serializeModelSession(result.history));
  assert.deepEqual(modelHoleValues(reopened),modelHoleValues(result.history));
  assert.deepEqual(modelHoleValues(undoModelSession(reopened)),before);
  assert.equal(modelHoleValues(redoModelSession(undoModelSession(reopened))).holeA.diameter,16);
});

test('dragging both hole center coordinates is one revision-fenced, undoable SKETCH transaction',()=>{
  const h=newModelPlateSession();
  const moved=moveModelHoleCenter(h,'holeA',45,42);
  assert.equal(moved.kind,'committed');
  if(moved.kind!=='committed')return;
  assert.equal(moved.history.document.revision,h.document.revision+1);
  assert.deepEqual(modelHoleValues(moved.history).holeA,{x:45,y:42,diameter:12});
  assert.deepEqual(modelHoleValues(h).holeA,{x:35,y:40,diameter:12});
  assert.equal(moved.sketchStatus,'analytic_profile_only');
  const undone=undoModelSession(moved.history);
  assert.deepEqual(modelHoleValues(undone).holeA,modelHoleValues(h).holeA);
  assert.deepEqual(modelHoleValues(reopenModelSession(serializeModelSession(moved.history))).holeA,
    {x:45,y:42,diameter:12});
});

test('invalid hole position refuses drag but numeric repair can retain unresolved authored intent',()=>{
  const h=newModelPlateSession();
  const refused=moveModelHoleCenter(h,'holeB',35,40);
  assert.equal(refused.kind,'refused');
  if(refused.kind!=='refused')return;
  assert.equal(refused.notCommitted,true);
  assert.equal(modelHoleValues(h).holeB.x,85);
  const kept=editModelHole(h,'holeB','x',35,'preserve_unresolved');
  assert.equal(kept.kind,'committed');
  if(kept.kind!=='committed')return;
  assert.equal(modelHoleValues(kept.history).holeB.x,35);
  assert.equal(previewModelProfile(kept.report),null);
  assert.equal(kept.report.features.find(x=>x.featureId==='cut')?.status,'blocked_dependency');
  assert.equal(kept.report.exactGeometryAvailable,false);
  assert.equal(modelHoleValues(undoModelSession(kept.history)).holeB.x,85);
  assert.throws(()=>editModelHole(h,'holeB','diameter',0),/diameter must be positive/);
});

test('authored timeline controls move stable features without rewiring dependency evaluation',()=>{
  const h=newModelPlateSession();
  const original=inspectModelSession(h);
  const moved=moveModelFeature(h,'cut','earlier');
  const after=inspectModelSession(moved.history);
  assert.deepEqual(after.authoredOrder,['sketch.plate','cut','plate','parameter.t']);
  assert.deepEqual(after.executableOrder,original.executableOrder);
  assert.deepEqual(moved.structuralInvalidation.changedFeatureIds,[]);
  assert.deepEqual(moved.structuralInvalidation.invalidatedFeatureIds,[]);
  assert.equal(after.features.find(x=>x.featureId==='plate')?.status,'preview_only');
  assert.equal(after.features.find(x=>x.featureId==='cut')?.status,'pending_exact_provider');
  assert.deepEqual(inspectModelSession(undoModelSession(moved.history)).authoredOrder,original.authoredOrder);
  assert.deepEqual(inspectModelSession(reopenModelSession(serializeModelSession(moved.history))).authoredOrder,after.authoredOrder);
  assert.throws(()=>moveModelFeature(h,'sketch.plate','earlier'),/No adjacent/);
});

test('direct sketch edge/diameter edits commit via accepted model contracts, refuse invalid drags and replay',()=>{
  const initial=newModelPlateSession('workbench.direct.dimension');
  const width=editModelSketchHandle(initial,'width',132);
  assert.equal(width.kind,'committed');
  if(width.kind!=='committed')return;
  assert.equal(width.history.document.revision,initial.document.revision+1);
  assert.deepEqual(width.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.equal(modelDimensionValues(width.history).width,132);
  const depth=editModelSketchHandle(width.history,'depth',85);
  assert.equal(depth.kind,'committed');
  if(depth.kind!=='committed')return;
  const circle=editModelSketchHandle(depth.history,'holeB.diameter',16);
  assert.equal(circle.kind,'committed');
  if(circle.kind!=='committed')return;
  assert.equal(modelHoleValues(circle.history).holeB.diameter,16);
  assert.equal(modelHoleValues(circle.history).holeA.diameter,12);
  assert.equal(inspectModelSession(circle.history).features.find(f=>f.featureId==='cut')?.status,'pending_exact_provider');
  const reopened=reopenModelSession(serializeModelSession(circle.history));
  assert.equal(modelDimensionValues(reopened).width,132);
  assert.equal(modelDimensionValues(reopened).depth,85);
  assert.equal(modelHoleValues(reopened).holeB.diameter,16);
  assert.equal(modelHoleValues(undoModelSession(reopened)).holeB.diameter,12);
  const refused=editModelSketchHandle(initial,'width',90);
  assert.equal(refused.kind,'refused');
  assert.equal(serializeModelSession(initial),serializeModelSession(newModelPlateSession('workbench.direct.dimension')));
  assert.equal(editModelSketchHandle(initial,'holeA.diameter',100).kind,'refused');
});

test('added hole is a real editable cut with durable identity, archive, undo and removal',()=>{
  const h=newModelPlateSession('workbench.add.circles');
  const added=addModelHole(h,'holeC',60,20,10);
  assert.equal(added.kind,'committed');
  if(added.kind!=='committed')return;
  assert.equal(added.history.document.revision,h.document.revision+1);
  assert.equal(previewModelProfile(added.report)?.profile.holes.length,3);
  assert.deepEqual(modelHoleValues(added.history).holeC,{x:60,y:20,diameter:10});
  assert.deepEqual(added.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  const moved=moveModelHoleCenter(added.history,'holeC',62,22);
  assert.equal(moved.kind,'committed');
  if(moved.kind!=='committed')return;
  const resized=editModelHole(moved.history,'holeC','diameter',12);
  assert.equal(resized.kind,'committed');
  if(resized.kind!=='committed')return;
  const reopened=reopenModelSession(serializeModelSession(resized.history));
  assert.deepEqual(modelHoleValues(reopened).holeC,{x:62,y:22,diameter:12});
  assert.equal(modelHoleValues(undoModelSession(reopened)).holeC.diameter,10);
  const removed=removeModelHole(reopened,'holeC');
  assert.equal(removed.kind,'committed');
  if(removed.kind!=='committed')return;
  assert.equal(previewModelProfile(removed.report)?.profile.holes.length,2);
  assert.equal(modelHoleValues(removed.history).holeC,undefined);
  assert.deepEqual(modelHoleValues(undoModelSession(removed.history)).holeC,{x:62,y:22,diameter:12});
  assert.equal(modelHoleValues(reopenModelSession(serializeModelSession(removed.history))).holeC,undefined);
  assert.throws(()=>removeModelHole(h,'holeA'),/Base hole/);
  const outside=addModelHole(h,'holeOutside',1000,1000,10);
  assert.equal(outside.kind,'refused');
  assert.deepEqual(Object.keys(modelHoleValues(h)),['holeA','holeB']);
});

test('one-shot rectangular hole array authors solved circular cuts, retains IDs through undo/archive and does not link copies',()=>{
  const h=newModelPlateSession('workbench.pattern.holes');
  const startArchive=serializeModelSession(h);
  const source=modelHoleValues(h).holeA;
  const patterned=patternModelHoles(h,{
    sourceHoleId:'holeA',rows:2,columns:2,pitchXmm:20,pitchYmm:20,
  });
  assert.equal(patterned.kind,'committed');
  if(patterned.kind!=='committed')return;
  assert.equal(patterned.history.document.revision,h.document.revision+1);
  const id=`array.${h.document.revision}:r0c1`;
  assert.deepEqual(modelHoleValues(patterned.history)[id],{x:source.x+20,y:source.y,diameter:source.diameter});
  assert.equal(Object.keys(modelHoleValues(patterned.history)).length,5);
  assert.equal(previewModelProfile(patterned.report)?.profile.holes.length,5);
  assert.deepEqual(patterned.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.equal(patterned.report.features.find(f=>f.featureId==='cut')?.status,'pending_exact_provider');
  const reopened=reopenModelSession(serializeModelSession(patterned.history));
  assert.deepEqual(modelHoleValues(reopened),modelHoleValues(patterned.history));
  const undo=undoModelSession(reopened);
  assert.deepEqual(modelHoleValues(undo),modelHoleValues(h));
  const redo=redoModelSession(undo);
  assert.deepEqual(modelHoleValues(redo),modelHoleValues(patterned.history));
  const changedSource=editModelHole(patterned.history,'holeA','diameter',10);
  assert.equal(changedSource.kind,'committed');
  if(changedSource.kind!=='committed')return;
  assert.equal(modelHoleValues(changedSource.history).holeA.diameter,10);
  assert.equal(modelHoleValues(changedSource.history)[id].diameter,source.diameter,
    'array copies must not misrepresent themselves as associative');
  const refused=patternModelHoles(h,{
    sourceHoleId:'holeA',rows:2,columns:2,pitchXmm:4,pitchYmm:20,
  });
  assert.equal(refused.kind,'refused');
  assert.equal(serializeModelSession(h),startArchive);
  assert.throws(()=>patternModelHoles(h,{
    sourceHoleId:'holeA',rows:9,columns:2,pitchXmm:20,pitchYmm:20,
  }),/Array requires/);
});

test('Make Independent bakes resolved 12 mm and permits later direct edits, undo, replay and reopen',()=>{
  const start=newModelPlateSession('workbench.freeze.plate');
  assert.equal(modelThicknessBinding(start),'named_parameter');
  assert.equal(modelDimensionValues(start).thickness,10);
  const changed=editModelDimension(start,'thickness',12);
  assert.equal(modelDimensionValues(changed).thickness,12);
  const baselineArchive=serializeModelSession(changed);
  const before=inspectModelSession(changed);
  const frozen=makeModelThicknessIndependent(changed);
  assert.equal(modelThicknessBinding(frozen.history),'independent');
  assert.equal(modelDimensionValues(frozen.history).thickness,12,'must bake resolved value, not old 8 mm fallback');
  assert.equal(previewModelProfile(inspectModelSession(frozen.history))?.thickness,12);
  assert.deepEqual(frozen.invalidatedFeatureIds.includes('plate'),true);
  assert.equal(frozen.history.undoStack.length,changed.undoStack.length+1,'single undo frame');
  assert.equal(frozen.history.document.journal.some(e=>e.type==='feature.remove'&&e.featureId==='parameter.t'),true);
  assert.equal(inspectModelSession(frozen.history).features.find(f=>f.featureId==='cut')?.status,'pending_exact_provider');
  const edited=editModelDimension(frozen.history,'thickness',15);
  assert.equal(modelDimensionValues(edited).thickness,15);
  assert.equal(previewModelProfile(inspectModelSession(edited))?.thickness,15);
  assert.equal(modelThicknessBinding(edited),'independent');
  const reopened=reopenModelSession(serializeModelSession(edited));
  assert.equal(modelDimensionValues(reopened).thickness,15);
  assert.equal(modelThicknessBinding(reopened),'independent');
  const undoDirect=undoModelSession(reopened);
  assert.equal(modelDimensionValues(undoDirect).thickness,12);
  assert.equal(modelThicknessBinding(undoDirect),'independent');
  const undoFreeze=undoModelSession(undoDirect);
  assert.equal(modelDimensionValues(undoFreeze).thickness,12);
  assert.equal(modelThicknessBinding(undoFreeze),'named_parameter');
  assert.deepEqual(inspectModelSession(undoFreeze).features.map(f=>[f.featureId,f.status,f.thicknessMm]),
    inspectModelSession(changed).features.map(f=>[f.featureId,f.status,f.thicknessMm]),
    'undo restores equivalent live features but retains the append-only journal');
  assert.ok(undoFreeze.document.revision>changed.document.revision,'undo never truncates the event journal');
  const redone=redoModelSession(redoModelSession(undoFreeze));
  assert.equal(modelThicknessBinding(redone),'independent');
  assert.equal(modelDimensionValues(redone).thickness,15);
  assert.deepEqual(inspectModelSession(redone).features.map(x=>x.featureId),
    inspectModelSession(edited).features.map(x=>x.featureId));
  assert.equal(before.exactGeometryAvailable,false);
  assert.equal(inspectModelSession(redone).exactGeometryAvailable,false);
  assert.throws(()=>makeModelThicknessIndependent(redone),/already independent/);
  assert.equal(serializeModelSession(changed),baselineArchive,'refused/detached edits never mutate source');
});


test('selected retrospective hole-layout resize is one admitted journal event and invalidates plate/cut',()=>{
  const original=newModelPlateSession('workbench.layout.resize');
  const before=modelHoleValues(original);
  const result=resizeModelHoleLayout(original,{
    holeIds:['holeA','holeB'],scaleX:1.2,scaleY:1,radiusScale:1.25,
  });
  assert.equal(result.kind,'committed');
  if(result.kind!=='committed')return;
  assert.deepEqual(modelHoleValues(result.history),{
    holeA:{x:30,y:40,diameter:15},holeB:{x:90,y:40,diameter:15},
  });
  assert.deepEqual(result.invalidation.invalidatedFeatureIds,['sketch.plate','plate','cut']);
  assert.equal(result.invalidation.exactReuseAllowed,false);
  assert.equal(result.report.features.find(f=>f.featureId==='cut')?.status,'pending_exact_provider');
  const reopened=reopenModelSession(serializeModelSession(result.history));
  assert.deepEqual(modelHoleValues(reopened),modelHoleValues(result.history));
  const undone=undoModelSession(reopened);
  assert.deepEqual(modelHoleValues(undone),before);
  assert.deepEqual(modelHoleValues(redoModelSession(undone)),modelHoleValues(result.history));
  const refused=resizeModelHoleLayout(original,{
    holeIds:['holeA','holeB'],scaleX:0.1,scaleY:1,radiusScale:1,
  });
  assert.equal(refused.kind,'refused','overlapping bores must not be committed');
  assert.deepEqual(modelHoleValues(original),before,'refusal must preserve authored source');
  assert.throws(()=>resizeModelHoleLayout(original,{
    holeIds:['holeA','missing'],scaleX:1.2,scaleY:1,radiusScale:1,
  }),/Unknown authored hole/);
  assert.throws(()=>resizeModelHoleLayout(original,{
    holeIds:['holeA','holeA'],scaleX:1.2,scaleY:1,radiusScale:1,
  }),/distinct holes/);
  assert.throws(()=>resizeModelHoleLayout(original,{
    holeIds:['holeA','holeB'],scaleX:0,scaleY:1,radiusScale:1,
  }),/scaling must be finite/);
});

test('Ctrl-selected hole centres translate together as one admitted journal edit and survive archive/undo',()=>{
  const initial=newModelPlateSession('workbench.group-drag.test');
  const before=modelHoleValues(initial);
  const selected=['holeA','holeB'];
  const moved=moveModelHoleGroup(initial,selected,4,2);
  assert.equal(moved.kind,'committed',moved.kind==='refused'?moved.reason:'group should be admitted');
  if(moved.kind!=='committed') return;
  const after=modelHoleValues(moved.history);
  for(const id of selected){
    assert.equal(after[id].x,before[id].x+4);
    assert.equal(after[id].y,before[id].y+2);
    assert.equal(after[id].diameter,before[id].diameter);
  }
  assert.deepEqual(Object.keys(after),Object.keys(before),'stable circle identities');
  assert.equal(moved.history.undoStack.length,initial.undoStack.length+1,'exactly one undo frame');
  assert.ok(moved.invalidation.invalidatedFeatureIds.includes('plate'));
  assert.ok(moved.invalidation.invalidatedFeatureIds.includes('cut'));
  const undone=undoModelSession(moved.history);
  assert.deepEqual(modelHoleValues(undone),before);
  const redone=redoModelSession(undone);
  assert.deepEqual(modelHoleValues(redone),after);
  assert.deepEqual(modelHoleValues(reopenModelSession(serializeModelSession(redone))),after);
  const crossed=moveModelHoleGroup(initial,selected,200,0);
  assert.equal(crossed.kind,'refused','outside-plate translation must not be partially committed');
  assert.deepEqual(modelHoleValues(initial),before,'refused group move cannot corrupt source');
  assert.throws(()=>moveModelHoleGroup(initial,['holeA','holeA'],3,0),/distinct/);
});
