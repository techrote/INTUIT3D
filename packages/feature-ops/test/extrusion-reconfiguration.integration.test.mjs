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
import {authorProfileBodySet,BODY_SET_FORMAT,BODY_SET_VERSION} from '../src/body-set.mjs';
import {reconfigureProfileExtrusion,EXTRUSION_RECONFIG_FORMAT,
  EXTRUSION_RECONFIG_VERSION} from '../src/extrusion-reconfiguration.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery};
const get=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);
const state=(history,id)=>runtime.inspect(history).features.find(f=>f.featureId===id)?.status;

function profile(vertices) {
  const points=vertices.map(([x,y],i)=>({id:'p'+i,x,y}));
  const lines=points.map((p,i)=>({id:'e'+i,start:p.id,
    end:points[(i+1)%points.length].id}));
  return sketch.validateSketch({
    version:1,units:'mm',points,lines,circles:[],
    constraints:points.map(p=>({id:'fixed.'+p.id,kind:'fixed',
      point:p.id,x:p.x,y:p.y}))
  });
}
function setup(cutSource='sketch.old') {
  const docs={
    'sketch.old':profile([[-70,-40],[70,-40],[70,-10],[15,-10],[15,45],[-70,45]]),
    'sketch.new':profile([[-90,-45],[90,-45],[65,-5],[5,45],[-90,45]]),
    'sketch.spacer':profile([[-15,-10],[15,-10],[15,10],[-15,10]]),
    'sketch.cut':profile([[-10,-8],[10,-8],[10,8],[-10,8]])
  };
  let history=transactions.startUndoHistory(model.newProject('reconfigure.profile.bracket'));
  history=runtime.commit(history,Object.entries(docs).map(([id,doc])=>({
    eventId:'create.'+id,type:'feature.create',
    feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:doc}}
  })),history.document.revision);
  const candidates=Object.fromEntries(Object.entries(docs).map(([id,doc])=>{
    const found=discovery.discoverPlateProfiles(doc);
    assert.equal(found.status,'ready',JSON.stringify(found.rejected));
    assert.equal(found.candidates.length,1);
    return [id,found.candidates[0].id];
  }));
  const authored=authorProfileBodySet(history,{
    format:BODY_SET_FORMAT,version:BODY_SET_VERSION,expectedRevision:history.document.revision,
    units:'mm',frame:'local_xy',bodies:[
      {sourceSketchId:'sketch.old',profileCandidateId:candidates['sketch.old'],
        extrudeFeatureId:'extrude.bracket',outputBodyId:'body.bracket',
        eventId:'create.extrude.bracket',depthMm:8,
        cut:{sourceSketchId:cutSource,profileCandidateId:candidates[cutSource],
          cutFeatureId:'cut.bracket',eventId:'create.cut.bracket'}},
      {sourceSketchId:'sketch.spacer',profileCandidateId:candidates['sketch.spacer'],
        extrudeFeatureId:'extrude.spacer',outputBodyId:'body.spacer',
        eventId:'create.extrude.spacer',depthMm:5,cut:null}
    ]
  },services);
  return {history:authored.history,candidates};
}
function request(history,candidates,values={}) {
  return {
    format:EXTRUSION_RECONFIG_FORMAT,version:EXTRUSION_RECONFIG_VERSION,
    eventId:'reconfigure.bracket',expectedRevision:history.document.revision,
    units:'mm',frame:'local_xy',extrudeFeatureId:'extrude.bracket',
    outputBodyId:'body.bracket',
    from:{sourceSketchId:'sketch.old',depthMm:8},
    to:{sourceSketchId:'sketch.new',
      profileCandidateId:candidates['sketch.new'],depthMm:14},
    ...values
  };
}
test('actual SKETCH/INTENT/RUNTIME L-bracket re-source and 8→14 mm, cut DAG repair, undo/redo/archive',()=>{
  const {history,candidates}=setup();
  assert.equal(state(history,'extrude.bracket'),'preview_only');
  assert.equal(state(history,'cut.bracket'),'pending_exact_provider');
  assert.deepEqual(get(history,'cut.bracket').dependsOn,['extrude.bracket']);
  const edited=reconfigureProfileExtrusion(history,request(history,candidates),services);
  assert.equal(edited.kind,'committed');
  assert.equal(edited.status,'preview_only');
  assert.equal(edited.exactAuthority,false);
  assert.equal(edited.nativeHandoff,null);
  assert.equal(edited.reboundCutId,'cut.bracket');
  assert.deepEqual(edited.cutDependencies,['extrude.bracket','sketch.old']);
  assert.equal(edited.history.document.revision,history.document.revision+2);
  assert.equal(edited.history.undoStack.length,history.undoStack.length+1);
  assert.deepEqual(get(edited.history,'extrude.bracket').dependsOn,['sketch.new']);
  assert.equal(get(edited.history,'extrude.bracket').payload.thicknessMm,14);
  assert.deepEqual(get(edited.history,'extrude.bracket').writeTargets,['body.bracket']);
  assert.deepEqual(get(edited.history,'cut.bracket').dependsOn,
    ['extrude.bracket','sketch.old']);
  assert.equal(get(edited.history,'cut.bracket').payload.sourceSketchId,'sketch.old');
  assert.equal(state(edited.history,'cut.bracket'),'pending_exact_provider');
  assert.equal(edited.report.features.find(f=>f.featureId==='extrude.bracket').profile.outer.length,5);
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes('cut.bracket'));
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes('extrude.bracket'));
  assert.ok(!edited.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
  assert.ok(!edited.invalidation.invalidatedFeatureIds.includes('sketch.spacer'));
  const undone=runtime.undo(edited.history,['undo.profile','undo.cut.dependencies']);
  assert.equal(get(undone,'extrude.bracket').payload.thicknessMm,8);
  assert.deepEqual(get(undone,'cut.bracket').dependsOn,['extrude.bracket']);
  const redone=runtime.redo(undone,['redo.profile','redo.cut.dependencies']);
  const reopened=runtime.reopen(runtime.save(redone));
  assert.equal(get(reopened,'extrude.bracket').payload.thicknessMm,14);
  assert.equal(get(reopened,'extrude.bracket').payload.sourceSketchId,'sketch.new');
  assert.deepEqual(get(reopened,'cut.bracket').dependsOn,['extrude.bracket','sketch.old']);
  assert.equal(get(reopened,'extrude.spacer').payload.thicknessMm,5);
  assert.equal(state(reopened,'cut.bracket'),'pending_exact_provider');
});

test('cut with separately authored sketch collapses redundant dependency when sketch becomes extrusion source',()=>{
  const {history,candidates}=setup('sketch.new');
  assert.deepEqual(get(history,'cut.bracket').dependsOn,
    ['extrude.bracket','sketch.new']);
  const edited=reconfigureProfileExtrusion(history,request(history,candidates),services);
  assert.deepEqual(get(edited.history,'cut.bracket').dependsOn,['extrude.bracket']);
  assert.equal(get(edited.history,'cut.bracket').payload.sourceSketchId,'sketch.new');
  assert.equal(state(edited.history,'cut.bracket'),'pending_exact_provider');
  assert.equal(edited.reboundCutId,'cut.bracket');
});

test('depth-only edit remains single-event and preserves already separate cut dependency',()=>{
  const {history,candidates}=setup('sketch.cut');
  const edited=reconfigureProfileExtrusion(history,request(history,candidates,{
    to:{sourceSketchId:'sketch.old',
      profileCandidateId:candidates['sketch.old'],depthMm:12}
  }),services);
  assert.equal(edited.reboundCutId,null);
  assert.equal(edited.history.document.revision,history.document.revision+1);
  assert.deepEqual(get(edited.history,'cut.bracket').dependsOn,
    ['extrude.bracket','sketch.cut']);
  assert.equal(state(edited.history,'cut.bracket'),'pending_exact_provider');
});

test('recover prior invalid extrusion sketch without discarding pending independent cut',()=>{
  const {history,candidates}=setup('sketch.cut');
  const broken=runtime.commit(history,[{
    eventId:'invalidate.old.sketch',type:'feature.edit',featureId:'sketch.old',
    patch:{payload:{sketch:{version:1,units:'mm',points:[],
      lines:[],circles:[],constraints:[]}}}
  }],history.document.revision);
  assert.notEqual(state(broken,'extrude.bracket'),'preview_only');
  const edited=reconfigureProfileExtrusion(broken,request(broken,candidates),services);
  assert.equal(state(edited.history,'extrude.bracket'),'preview_only');
  assert.equal(state(edited.history,'cut.bracket'),'pending_exact_provider');
  assert.equal(get(edited.history,'cut.bracket').payload.sourceSketchId,'sketch.cut');
  assert.notEqual(state(edited.history,'sketch.old'),'analytic_profile_only');
});

test('refuse stale selectors, unrelated bodies, stale candidates, invalid depths and no-op',()=>{
  const {history,candidates}=setup(), req=request(history,candidates);
  const cases=[
    [{...req,expectedRevision:0},/stale/],
    [{...req,units:'inch'},/millimetre/],
    [{...req,from:{...req.from,depthMm:12}},/identity has changed/],
    [{...req,from:{...req.from,sourceSketchId:'sketch.cut'}},/identity has changed/],
    [{...req,outputBodyId:'body.spacer'},/identity has changed/],
    [{...req,to:{...req.to,depthMm:0}},/positive finite/],
    [{...req,to:{...req.to,profileCandidateId:'cycle:stale'}},/missing, unsolved, ambiguous or stale/],
    [{...req,to:{...req.to,sourceSketchId:'sketch.missing'}},/not an existing/],
    [{...req,to:{sourceSketchId:'sketch.old',depthMm:8,
      profileCandidateId:candidates['sketch.old']}},/no-op/],
    [{...req,unexpected:true},/invalid request/]
  ];
  for (const [bad,error] of cases)
    assert.throws(()=>reconfigureProfileExtrusion(history,bad,services),error);
  assert.deepEqual(get(history,'cut.bracket').dependsOn,['extrude.bracket']);
  assert.equal(history.document.revision,req.expectedRevision);
});

test('refuse second/noncommuting body writer rather than guessing Boolean order',()=>{
  const {history,candidates}=setup();
  const conflicted=runtime.commit(history,[{
    eventId:'create.rogue.cut',type:'feature.create',
    feature:{id:'cut.rogue',kind:'cut',dependsOn:['extrude.bracket'],
      writeTargets:['body.bracket'],payload:{sourceSketchId:'sketch.old',
        targetBodyId:'body.bracket',units:'mm',frame:'local_xy'}}
  }],history.document.revision);
  assert.throws(()=>reconfigureProfileExtrusion(conflicted,
    request(conflicted,candidates),services),/noncommuting body writers/);
});

test('standalone Node consumer example performs undoable source switch and retains spacer',()=>{
  const script=fileURLToPath(new URL('../examples/extrusion-reconfiguration.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',script],{
    encoding:'utf8',timeout:20000,maxBuffer:1024*1024
  });
  assert.equal(run.status,0,run.stderr || String(run.error));
  const output=JSON.parse(run.stdout);
  assert.equal(output.extrusionDepthMm,14);
  assert.equal(output.recoveredDepthMm,14);
  assert.equal(output.cutState,'pending_exact_provider');
  assert.equal(output.unchangedSpacerDepthMm,5);
  assert.deepEqual(output.cutDependencies,['extrude.bracket','sketch.old']);
  assert.equal(output.exactAuthority,false);
});
