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
import {rectanglePlateFromProfile} from '@intuit3d/workflow-runtime/experimental-plate';
import {authorProfileExtrusion,authorProfileBodyCut,PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '../src/index.mjs';
import {editExtrudeThickness} from '../src/index.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery};
const protocol={format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION};

/** A real fully constrained SIX-sided L-profile — not a rectangular plate. */
function sketchFixture(lShape=true) {
  const vertices=lShape ?
    [[-80,-50],[80,-50],[80,-10],[10,-10],[10,50],[-80,50]] :
    [[-80,-50],[80,-50],[80,50],[-80,50]];
  const points=vertices.map(([x,y],i)=>({id:'outer.p'+i,x,y}));
  const lines=points.map((p,i)=>({
    id:'outer.e'+i,start:p.id,end:points[(i+1)%points.length].id
  }));
  const hole={id:'clearance',center:'hole.center',radius:6};
  points.push({id:'hole.center',x:-50,y:0});
  const constraints=points.map(p=>({
    id:'fix.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y
  }));
  constraints.push({id:'radius.clearance',kind:'radius',circle:hole.id,value:6});
  return sketch.validateSketch({
    version:1,units:'mm',points,lines,circles:[hole],constraints
  });
}
function withSketch(history,featureId,source) {
  return runtime.commit(history,[{eventId:'create.'+featureId,type:'feature.create',
    feature:{id:featureId,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:source}}
  }],history.document.revision);
}
const candidate=(source)=>{
  const result=discovery.discoverPlateProfiles(source);
  assert.equal(result.status,'ready',JSON.stringify(result.rejected));
  assert.equal(result.candidates.length,1);
  return result.candidates[0].id;
};
const extrusion=(history,sourceSketchId,profileCandidateId,extra={})=>({
  ...protocol,eventId:'make.extrude',expectedRevision:history.document.revision,
  sourceSketchId,profileCandidateId,extrudeFeatureId:'extrude.l',
  outputBodyId:'body.l',depthMm:8,...extra
});
const cutRequest=(history,sourceSketchId,profileCandidateId,extra={})=>({
  ...protocol,eventId:'make.cut',expectedRevision:history.document.revision,
  sourceSketchId,profileCandidateId,extrudeFeatureId:'extrude.l',
  cutFeatureId:'cut.l',targetBodyId:'body.l',...extra
});

test('real SKETCH L-profile -> INTENT extrusion -> targeted pending cut -> edit, undo, redo and archive',()=>{
  const l=sketchFixture();
  const empty=transactions.startUndoHistory(model.newProject('general.l.bracket'));
  const saved=withSketch(empty,'sketch.l',l);
  const selection=candidate(l);
  const extruded=authorProfileExtrusion(saved,extrusion(saved,'sketch.l',selection),services);
  assert.equal(extruded.kind,'committed');
  assert.equal(extruded.status,'preview_only');
  assert.equal(extruded.nativeHandoff,null);
  assert.equal(extruded.report.features.find(f=>f.featureId==='extrude.l').profile.outer.length,6);
  const cut=authorProfileBodyCut(extruded.history,cutRequest(extruded.history,'sketch.l',selection),services);
  assert.equal(cut.kind,'committed');
  assert.equal(cut.status,'pending_exact_provider');
  assert.equal(cut.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
  assert.deepEqual(model.featuresOf(cut.history.document).find(f=>f.id==='cut.l').writeTargets,['body.l']);
  assert.deepEqual(model.featuresOf(cut.history.document).find(f=>f.id==='cut.l').dependsOn,['extrude.l']);
  const profile=cut.report.features.find(f=>f.featureId==='extrude.l').profile;
  assert.equal(profile.holes.length,1);
  assert.throws(()=>rectanglePlateFromProfile(profile,8),/rectangular/);
  const modified=editExtrudeThickness(cut.history,{eventId:'edit.depth',featureId:'extrude.l',
    expectedRevision:cut.history.document.revision,thicknessMm:14},services);
  assert.ok(modified.invalidation.invalidatedFeatureIds.includes('cut.l'));
  assert.ok(modified.invalidation.invalidatedFeatureIds.includes('extrude.l'));
  assert.ok(!modified.invalidation.invalidatedFeatureIds.includes('sketch.l'));
  assert.equal(runtime.inspect(modified.history).features.find(f=>f.featureId==='cut.l').status,
    'pending_exact_provider');
  const undone=runtime.undo(modified.history,['undo.depth']);
  assert.equal(model.featuresOf(undone.document).find(f=>f.id==='extrude.l').payload.thicknessMm,8);
  const redone=runtime.redo(undone,['redo.depth']);
  const reopened=runtime.reopen(runtime.save(redone));
  assert.equal(model.featuresOf(reopened.document).find(f=>f.id==='extrude.l').payload.thicknessMm,14);
  assert.equal(runtime.inspect(reopened).features.find(f=>f.featureId==='cut.l').status,
    'pending_exact_provider');
  assert.equal(model.featuresOf(reopened.document).find(f=>f.id==='cut.l').payload.targetBodyId,'body.l');
});

test('real rectangular profile can be separately selected and mapped by RUNTIME plate adapter',()=>{
  const rectangle=sketchFixture(false);
  const empty=transactions.startUndoHistory(model.newProject('profile.rect.cut'));
  const saved=withSketch(empty,'sketch.l',rectangle);
  const selection=candidate(rectangle);
  const extruded=authorProfileExtrusion(saved,extrusion(saved,'sketch.l',selection),services);
  const cut=authorProfileBodyCut(extruded.history,cutRequest(extruded.history,'sketch.l',selection),services);
  const profile=cut.report.features.find(f=>f.featureId==='extrude.l').profile;
  const mapped=rectanglePlateFromProfile(profile,8);
  assert.equal(mapped.width,160);
  assert.equal(mapped.depth,100);
  assert.equal(mapped.thickness,8);
  assert.deepEqual(mapped.holes,[{x:-50,y:0,radius:6}]);
  assert.equal(cut.exactAuthority,false);
  assert.equal(cut.nativeHandoff.kind,'runtime_evaluation_required');
});

test('separate admitted cut sketch retains an explicit two-sketch DAG and native compatibility is unclaimed',()=>{
  const initial=transactions.startUndoHistory(model.newProject('profile.two.sketches'));
  const l=sketchFixture(), rectangle=sketchFixture(false);
  const first=withSketch(initial,'sketch.l',l);
  const both=withSketch(first,'sketch.cut',rectangle);
  const extruded=authorProfileExtrusion(both,extrusion(both,'sketch.l',candidate(l)),services);
  const cut=authorProfileBodyCut(extruded.history,cutRequest(extruded.history,
    'sketch.cut',candidate(rectangle)),services);
  const authored=model.featuresOf(cut.history.document).find(f=>f.id==='cut.l');
  assert.deepEqual(authored.dependsOn,['extrude.l','sketch.cut']);
  assert.equal(authored.payload.sourceSketchId,'sketch.cut');
  assert.equal(runtime.inspect(cut.history).features.find(f=>f.featureId==='cut.l').status,
    'pending_exact_provider');
  assert.equal(cut.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
  assert.equal(runtime.inspect(runtime.reopen(runtime.save(cut.history))).features.find(
    f=>f.featureId==='cut.l').status,'pending_exact_provider');
});

test('fail-closed source selection, body writer ambiguity, stale revision and invalid depth',()=>{
  const l=sketchFixture();
  const empty=transactions.startUndoHistory(model.newProject('profile.refusal'));
  const saved=withSketch(empty,'sketch.l',l);
  const selection=candidate(l);
  const ex=extrusion(saved,'sketch.l',selection);
  assert.throws(()=>authorProfileExtrusion(saved,{...ex,profileCandidateId:'cycle:foreign'},services),
    /ambiguous, missing or stale/);
  assert.throws(()=>authorProfileExtrusion(saved,{...ex,depthMm:0},services),/positive finite/);
  assert.throws(()=>authorProfileExtrusion(saved,{...ex,expectedRevision:0},services),/stale/);
  assert.throws(()=>authorProfileExtrusion(saved,{...ex,outputBodyId:'sketch.l'},services),/duplicate/);
  const extruded=authorProfileExtrusion(saved,ex,services);
  assert.throws(()=>authorProfileExtrusion(extruded.history,{
    ...extrusion(extruded.history,'sketch.l',selection),extrudeFeatureId:'extrude.other'
  },services),/already has a writer/);
  assert.throws(()=>authorProfileBodyCut(extruded.history,{
    ...cutRequest(extruded.history,'sketch.l',selection),targetBodyId:'body.other'
  },services),/target body required/);
  assert.throws(()=>authorProfileBodyCut(extruded.history,{
    ...cutRequest(extruded.history,'sketch.l',selection),profileCandidateId:'cycle:unknown'
  },services),/ambiguous, missing or stale/);
  const cut=authorProfileBodyCut(extruded.history,cutRequest(extruded.history,'sketch.l',selection),services);
  assert.throws(()=>authorProfileBodyCut(cut.history,{
    ...cutRequest(cut.history,'sketch.l',selection),cutFeatureId:'cut.second'
  },services),/additional body writer/);
  assert.equal(saved.document.revision,1);
  assert.equal(extruded.history.document.revision,2);
  assert.equal(cut.history.document.revision,3);
});
