import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileBodySet,BODY_SET_FORMAT,BODY_SET_VERSION} from '../src/body-set.mjs';
import {reassignProfileCut,CUT_REASSIGN_FORMAT,CUT_REASSIGN_VERSION} from '../src/cut-reassignment.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery};
const status=(history,id)=>runtime.inspect(history).features.find(f=>f.featureId===id)?.status;
const feature=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);
function profile(points,withCircle=false) {
  const pts=points.map(([x,y],i)=>({id:'p'+i,x,y}));
  const lines=points.map((_,i)=>({id:'e'+i,start:'p'+i,
    end:'p'+((i+1)%points.length)}));
  const circles=withCircle?[{id:'hole',center:'hole.center',radius:4}]:[];
  if(withCircle) pts.push({id:'hole.center',x:-30,y:0});
  const constraints=pts.map(p=>({id:'fixed.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}));
  if(withCircle) constraints.push({id:'hole.radius',kind:'radius',circle:'hole',value:4});
  return sketch.validateSketch({version:1,units:'mm',points:pts,lines,circles,constraints});
}
function setup() {
  const profiles={
    bracket:profile([[-60,-40],[60,-40],[60,-12],[12,-12],[12,40],[-60,40]],true),
    spacer:profile([[-20,-10],[20,-10],[20,10],[-20,10]]),
    bore:profile([[-12,-8],[12,-8],[12,8],[-12,8]]),
    relief:profile([[-18,-5],[18,-5],[18,5],[-18,5]])
  };
  let history=transactions.startUndoHistory(model.newProject('reassign-cut-mechanical-assembly'));
  history=runtime.commit(history,Object.entries(profiles).map(([name,sketchDocument])=>({
    eventId:'sketch.create.'+name,type:'feature.create',
    feature:{id:'sketch.'+name,kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:sketchDocument}}
  })),history.document.revision);
  const selected=Object.fromEntries(Object.entries(profiles).map(([name,doc])=>{
    const result=discovery.discoverPlateProfiles(doc);
    assert.equal(result.status,'ready',JSON.stringify(result.rejected));
    assert.equal(result.candidates.length,1);
    return [name,result.candidates[0].id];
  }));
  const made=authorProfileBodySet(history,{
    format:BODY_SET_FORMAT,version:BODY_SET_VERSION,
    expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
    bodies:[
      {sourceSketchId:'sketch.bracket',profileCandidateId:selected.bracket,
        extrudeFeatureId:'extrude.bracket',outputBodyId:'body.bracket',
        depthMm:8,eventId:'body.create.bracket',
        cut:{sourceSketchId:'sketch.bore',profileCandidateId:selected.bore,
          cutFeatureId:'cut.clearance',eventId:'cut.create.clearance'}},
      {sourceSketchId:'sketch.spacer',profileCandidateId:selected.spacer,
        extrudeFeatureId:'extrude.spacer',outputBodyId:'body.spacer',
        depthMm:5,eventId:'body.create.spacer',cut:null}
    ]
  },services);
  return {history:made.history,selected};
}
function request(history,selected) {
  return {
    format:CUT_REASSIGN_FORMAT,version:CUT_REASSIGN_VERSION,
    eventId:'cut.retarget.1',expectedRevision:history.document.revision,
    units:'mm',frame:'local_xy',cutFeatureId:'cut.clearance',
    from:{extrudeFeatureId:'extrude.bracket',bodyId:'body.bracket',
      sourceSketchId:'sketch.bore'},
    to:{extrudeFeatureId:'extrude.spacer',bodyId:'body.spacer',
      sourceSketchId:'sketch.bore',profileCandidateId:selected.bore}
  };
}

test('real two-body source-to-target reassignment, dependency-aware rebuild, undo/redo and archive',()=>{
  const {history,selected}=setup(), before=runtime.inspect(history);
  assert.equal(status(history,'cut.clearance'),'pending_exact_provider');
  const result=reassignProfileCut(history,request(history,selected),services);
  assert.equal(result.kind,'committed');
  assert.equal(result.history.document.revision,history.document.revision+1);
  assert.equal(result.history.undoStack.length,history.undoStack.length+1);
  assert.equal(result.status,'pending_exact_provider');
  assert.equal(result.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  assert.equal(result.nativeHandoff.sourceRevision,result.history.document.revision);
  const cut=feature(result.history,'cut.clearance');
  assert.deepEqual(cut.dependsOn,['extrude.spacer','sketch.bore']);
  assert.deepEqual(cut.writeTargets,['body.spacer']);
  assert.equal(cut.payload.targetBodyId,'body.spacer');
  assert.equal(cut.payload.sourceSketchId,'sketch.bore');
  assert.equal(status(result.history,'cut.clearance'),'pending_exact_provider');
  assert.equal(status(result.history,'extrude.bracket'),'preview_only');
  assert.equal(status(result.history,'extrude.spacer'),'preview_only');
  assert.ok(result.invalidation.invalidatedFeatureIds.includes('cut.clearance'));
  assert.ok(!result.invalidation.invalidatedFeatureIds.includes('extrude.bracket'));
  assert.ok(!result.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
  assert.equal(before.revision,history.document.revision);
  // A user-edit of the original bracket no longer depends on the relocated cut.
  const afterEdit=runtime.commit(result.history,[{
    eventId:'bracket.depth.14',type:'feature.edit',featureId:'extrude.bracket',
    patch:{payload:{...feature(result.history,'extrude.bracket').payload,thicknessMm:14}}
  }],result.history.document.revision);
  const delta=runtime.diff(result.history,afterEdit);
  assert.ok(delta.invalidatedFeatureIds.includes('extrude.bracket'));
  assert.ok(!delta.invalidatedFeatureIds.includes('cut.clearance'));
  assert.equal(status(afterEdit,'cut.clearance'),'pending_exact_provider');
  const undone=runtime.undo(result.history,['undo.cut.retarget']);
  assert.deepEqual(feature(undone,'cut.clearance').writeTargets,['body.bracket']);
  assert.deepEqual(feature(undone,'cut.clearance').dependsOn,['extrude.bracket','sketch.bore']);
  const redone=runtime.redo(undone,['redo.cut.retarget']);
  const reopened=runtime.reopen(runtime.save(redone));
  assert.deepEqual(feature(reopened,'cut.clearance').writeTargets,['body.spacer']);
  assert.deepEqual(feature(reopened,'cut.clearance').dependsOn,['extrude.spacer','sketch.bore']);
  assert.equal(status(reopened,'cut.clearance'),'pending_exact_provider');
});

test('edit existing cut profile on same body without changing cut identity',()=>{
  const {history,selected}=setup();
  const req=request(history,selected);
  const result=reassignProfileCut(history,{
    ...req,eventId:'cut.profile.replace',
    to:{extrudeFeatureId:'extrude.bracket',bodyId:'body.bracket',
      sourceSketchId:'sketch.relief',profileCandidateId:selected.relief}
  },services);
  assert.deepEqual(feature(result.history,'cut.clearance').dependsOn,
    ['extrude.bracket','sketch.relief']);
  assert.equal(feature(result.history,'cut.clearance').payload.sourceSketchId,'sketch.relief');
  assert.equal(result.previousBodyId,result.targetBodyId);
  assert.equal(result.status,'pending_exact_provider');
  const undo=runtime.undo(result.history,['undo.cut.profile']);
  assert.equal(feature(undo,'cut.clearance').payload.sourceSketchId,'sketch.bore');
});

test('fences stale revisions, altered original identity, no-op, bad target and ambiguous writers',()=>{
  const {history,selected}=setup(),req=request(history,selected);
  assert.throws(()=>reassignProfileCut(history,{...req,expectedRevision:0},services),/stale/);
  assert.throws(()=>reassignProfileCut(history,{...req,units:'cm'},services),/frame/);
  assert.throws(()=>reassignProfileCut(history,{...req,to:{...req.to,bodyId:'body.missing'}},services),/target is unavailable/);
  assert.throws(()=>reassignProfileCut(history,{...req,from:{...req.from,bodyId:'body.spacer'}},services),/changed/);
  assert.throws(()=>reassignProfileCut(history,{...req,from:{...req.from,sourceSketchId:'sketch.relief'}},services),/changed/);
  assert.throws(()=>reassignProfileCut(history,{...req,to:{...req.to,profileCandidateId:'cycle:stale'}},services),/missing, unsolved, ambiguous or stale/);
  assert.throws(()=>reassignProfileCut(history,{...req,to:{
    extrudeFeatureId:'extrude.bracket',bodyId:'body.bracket',
    sourceSketchId:'sketch.bore',profileCandidateId:selected.bore
  }},services),/no-op/);
  const conflicted=runtime.commit(history,[{
    eventId:'foreign.cut',type:'feature.create',feature:{
      id:'cut.foreign',kind:'cut',dependsOn:['extrude.spacer'],
      writeTargets:['body.spacer'],
      payload:{sourceSketchId:'sketch.spacer',targetBodyId:'body.spacer',
        units:'mm',frame:'local_xy'}
    }
  }],history.document.revision);
  assert.throws(()=>reassignProfileCut(conflicted,{
    ...req,expectedRevision:conflicted.document.revision
  },services),/additional or ambiguous writer/);
  assert.deepEqual(feature(history,'cut.clearance').writeTargets,['body.bracket']);
});

test('bad old cut sketch remains recoverable through valid replacement profile',()=>{
  const {history,selected}=setup();
  // Valid INTENT journal edit; no fabricated solved sketch or dropped cut.
  const corrupted=runtime.commit(history,[{
    eventId:'sketch.bore.unsolved',type:'feature.edit',featureId:'sketch.bore',
    patch:{payload:{sketch:{version:1,units:'mm',points:[],lines:[],
      circles:[],constraints:[]}}}
  }],history.document.revision);
  assert.notEqual(status(corrupted,'sketch.bore'),'analytic_profile_only');
  assert.notEqual(status(corrupted,'cut.clearance'),'pending_exact_provider');
  const req=request(corrupted,selected);
  const repaired=reassignProfileCut(corrupted,{
    ...req,eventId:'cut.repair.unsolved',
    to:{extrudeFeatureId:'extrude.bracket',bodyId:'body.bracket',
      sourceSketchId:'sketch.relief',profileCandidateId:selected.relief}
  },services);
  assert.equal(status(repaired.history,'cut.clearance'),'pending_exact_provider');
  assert.equal(feature(repaired.history,'cut.clearance').payload.sourceSketchId,'sketch.relief');
  assert.equal(status(repaired.history,'sketch.bore'),'invalid_profile');
});
