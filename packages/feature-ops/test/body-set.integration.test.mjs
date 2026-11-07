import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {editExtrudeThickness} from '../src/index.mjs';
import {authorProfileBodySet,BODY_SET_FORMAT,BODY_SET_VERSION} from '../src/body-set.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery};
function profile(lShape=false,withHole=false) {
  const coordinates=lShape?
    [[-75,-50],[75,-50],[75,-15],[15,-15],[15,50],[-75,50]]:
    [[-20,-10],[20,-10],[20,10],[-20,10]];
  const points=coordinates.map(([x,y],n)=>({id:'p'+n,x,y}));
  const lines=coordinates.map((_,n)=>({id:'e'+n,start:'p'+n,
    end:'p'+((n+1)%coordinates.length)}));
  const circles=withHole?[{id:'hole',center:'hole.center',radius:5}]:[];
  if(withHole) points.push({id:'hole.center',x:-45,y:0});
  const constraints=points.map(p=>({id:'fixed.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}));
  if(withHole) constraints.push({id:'radius.hole',kind:'radius',circle:'hole',value:5});
  return sketch.validateSketch({version:1,units:'mm',points,lines,circles,constraints});
}
function project() {
  let h=transactions.startUndoHistory(model.newProject('two-body-bracket-and-spacer'));
  const sketches=[['sketch.bracket',profile(true,true)],
    ['sketch.spacer',profile(false)],['sketch.cut',profile(false)]];
  // Batch pre-existing, authoritative sketches, not synthetic provider shapes.
  h=runtime.commit(h,sketches.map(([id,doc])=>({
    eventId:'create.'+id,type:'feature.create',feature:{id,kind:'sketch',
      dependsOn:[],writeTargets:[],payload:{sketch:doc}}
  })),h.document.revision);
  const selected=Object.fromEntries(sketches.map(([id,doc])=>{
    const response=discovery.discoverPlateProfiles(doc);
    assert.equal(response.status,'ready',JSON.stringify(response.rejected));
    assert.equal(response.candidates.length,1);
    return [id,response.candidates[0].id];
  }));
  return {h,selected};
}
const protocol={format:BODY_SET_FORMAT,version:BODY_SET_VERSION,units:'mm',frame:'local_xy'};
function request(h,selected) {
  return {...protocol,expectedRevision:h.document.revision,bodies:[
    {sourceSketchId:'sketch.bracket',profileCandidateId:selected['sketch.bracket'],
      extrudeFeatureId:'extrude.bracket',outputBodyId:'body.bracket',
      depthMm:8,eventId:'make.bracket',cut:{
        sourceSketchId:'sketch.cut',profileCandidateId:selected['sketch.cut'],
        cutFeatureId:'cut.bracket',eventId:'make.bracket.cut'}},
    {sourceSketchId:'sketch.spacer',profileCandidateId:selected['sketch.spacer'],
      extrudeFeatureId:'extrude.spacer',outputBodyId:'body.spacer',
      depthMm:5,eventId:'make.spacer',cut:null}
  ]};
}

test('real SKETCH multi-body transaction, selected cut, isolated rebuild, undo/redo/archive',()=>{
  const {h,selected}=project();
  const operation=authorProfileBodySet(h,request(h,selected),services);
  assert.equal(operation.kind,'committed');
  assert.equal(operation.history.document.revision,h.document.revision+3);
  // Three journal events, but exactly one undoable frame, not three edits.
  assert.equal(operation.history.undoStack.length,h.undoStack.length+1);
  assert.equal(operation.bodies.length,2);
  assert.equal(operation.bodies[0].status,'pending_exact_provider');
  assert.equal(operation.bodies[0].nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
  assert.equal(operation.bodies[1].status,'preview_only');
  assert.equal(operation.bodies[1].nativeHandoff,null);
  assert.equal(operation.exactAuthority,false);
  assert.equal(operation.independentInteroperability,false);
  const features=model.featuresOf(operation.history.document);
  const cut=features.find(f=>f.id==='cut.bracket');
  assert.deepEqual(cut.dependsOn,['extrude.bracket','sketch.cut']);
  assert.deepEqual(cut.writeTargets,['body.bracket']);
  assert.equal(cut.payload.sourceSketchId,'sketch.cut');
  assert.deepEqual(features.find(f=>f.id==='extrude.spacer').writeTargets,['body.spacer']);
  assert.equal(operation.report.features.find(f=>f.featureId==='extrude.bracket').profile.outer.length,6);
  assert.equal(operation.report.features.find(f=>f.featureId==='cut.bracket').status,'pending_exact_provider');
  const edited=editExtrudeThickness(operation.history,{
    eventId:'edit.bracket.depth',featureId:'extrude.bracket',
    expectedRevision:operation.history.document.revision,thicknessMm:14
  },services);
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes('extrude.bracket'));
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes('cut.bracket'));
  assert.ok(!edited.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
  assert.ok(!edited.invalidation.invalidatedFeatureIds.includes('sketch.spacer'));
  const undone=runtime.undo(edited.history,['undo.bracket.depth']);
  assert.equal(model.featuresOf(undone.document).find(f=>f.id==='extrude.bracket').payload.thicknessMm,8);
  const redone=runtime.redo(undone,['redo.bracket.depth']);
  const reopened=runtime.reopen(runtime.save(redone));
  assert.equal(model.featuresOf(reopened.document).find(f=>f.id==='extrude.bracket').payload.thicknessMm,14);
  assert.equal(model.featuresOf(reopened.document).find(f=>f.id==='extrude.spacer').payload.thicknessMm,5);
  assert.equal(runtime.inspect(reopened).features.find(f=>f.featureId==='cut.bracket').status,
    'pending_exact_provider');
  const undoneCreation=runtime.undo(operation.history,['undo.make.1','undo.make.2','undo.make.3']);
  assert.ok(!model.featuresOf(undoneCreation.document).some(f=>f.id==='extrude.spacer'));
  assert.ok(!model.featuresOf(undoneCreation.document).some(f=>f.id==='cut.bracket'));
});

test('fail-closed transaction prevents stale/foreign profile, missing target and aliasing',()=>{
  const {h,selected}=project(), valid=request(h,selected);
  const operation=authorProfileBodySet(h,valid,services);
  assert.throws(()=>authorProfileBodySet(h,{...valid,units:'cm'},services),/protocol/);
  assert.throws(()=>authorProfileBodySet(h,{...valid,expectedRevision:0},services),/stale/);
  assert.throws(()=>authorProfileBodySet(h,{...valid,bodies:valid.bodies.slice(0,1)},services),/2–8/);
  assert.throws(()=>authorProfileBodySet(h,{...valid,bodies:[
    {...valid.bodies[0],profileCandidateId:'cycle:missing'},valid.bodies[1]
  ]},services),/missing, stale or ambiguous/);
  assert.throws(()=>authorProfileBodySet(h,{...valid,bodies:[
    {...valid.bodies[0],depthMm:0},valid.bodies[1]
  ]},services),/positive finite/);
  assert.throws(()=>authorProfileBodySet(h,{...valid,bodies:[
    valid.bodies[0],{...valid.bodies[1],outputBodyId:'body.bracket'}
  ]},services),/repeated/);
  assert.throws(()=>authorProfileBodySet(h,{...valid,bodies:[
    valid.bodies[0],{...valid.bodies[1],eventId:'make.bracket'}
  ]},services),/repeated eventId/);
  assert.throws(()=>authorProfileBodySet(h,{...valid,bodies:[
    valid.bodies[0],{...valid.bodies[1],extrudeFeatureId:'sketch.spacer'}
  ]},services),/occupied/);
  assert.throws(()=>authorProfileBodySet(h,{...valid,bodies:[
    {...valid.bodies[0],cut:{...valid.bodies[0].cut,sourceSketchId:'sketch.unknown'}},
    valid.bodies[1]
  ]},services),/authored SKETCH/);
  assert.throws(()=>authorProfileBodySet(operation.history,{
    ...valid,expectedRevision:operation.history.document.revision
  },services),/occupied/);
  assert.equal(h.document.revision,3);
  assert.equal(model.featuresOf(h.document).filter(f=>f.kind==='extrude').length,0);
});

test('separate Node demonstration authors two bodies and rebuilds only selected bracket',()=>{
  const script=fileURLToPath(new URL('../examples/multi-body-assembly.mjs',import.meta.url));
  const result=spawnSync(process.execPath,['--experimental-strip-types',script],{
    encoding:'utf8',timeout:20000,maxBuffer:1024*1024
  });
  assert.equal(result.status,0,result.stderr || String(result.error));
  const output=JSON.parse(result.stdout);
  assert.equal(output.kind,'committed');
  assert.equal(output.bodies.length,2);
  assert.equal(output.editedDepthMm,14);
  assert.equal(output.unchangedSpacerDepthMm,5);
  assert.ok(output.affected.includes('cut.bracket'));
  assert.ok(!output.affected.includes('extrude.spacer'));
  assert.equal(output.reopenedCutStatus,'pending_exact_provider');
  assert.equal(output.exactAuthority,false);
});
