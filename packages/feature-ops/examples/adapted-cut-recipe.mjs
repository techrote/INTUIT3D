/** Actual SKETCH/INTENT/RUNTIME machining recipe adaptation, not native STEP. */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {BODY_REBUILD_MANIFEST_FORMAT,planBodyRebuildManifest}
  from '@intuit3d/model/body-rebuild-manifest';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT}
  from '@intuit3d/feature-ops/ordered-cut/v1';
import {editExtrudeThickness} from '@intuit3d/feature-ops';
import {ADAPTED_RECIPE_FORMAT,inspectAdaptableCutRecipe,applyAdaptedCutRecipe}
  from '@intuit3d/feature-ops/adapted-cut-recipe/v1';
import {makeAssembly,polygon,runtime,services} from './coordinated-pockets.mjs';
const get=(h,id)=>model.featuresOf(h.document).find(f=>f.id===id);
const profile=s=>{
  const p=discovery.discoverPlateProfiles(s);
  assert.equal(p.status,'ready');assert.equal(p.candidates.length,1);
  return p.candidates[0].id;
};
function addSketch(h,id,s){
  return runtime.commit(h,[{eventId:'make.'+id,type:'feature.create',
    feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:s}}}],h.document.revision);
}
function addCut(h,id,sketchId,candidate,previous,extent){
  return appendOrderedProfileCut(h,{
    format:ORDERED_CUT_FORMAT,version:1,
    expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
    units:'mm',frame:'local_xy',eventId:'make.'+id,
    targetBodyId:'body.guard',cutFeatureId:id,afterBodyWriterId:previous,
    sourceSketchId:sketchId,profileCandidateId:candidate,extent},services).history;
}
const actions=(a,b)=>planBodyRebuildManifest(a.document,b.document,{
  format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
  expectedProjectId:a.document.projectId,
  expectedFromRevision:a.document.revision,expectedToRevision:b.document.revision,
  bodyIds:['body.guard','body.backer','body.shim']
}).bodies.map(x=>x.action);
export function runAdaptedCutRecipe(){
  let {history,candidates}=makeAssembly();
  const sourceVent=polygon('sourcevent',[[72,5],[85,5],[85,14],[72,14]]);
  const sourceFinish=polygon('sourcefinish',[[27,7],[39,7],[39,15],[27,15]]);
  const targetRelief=polygon('targetrelief',[[12,6],[24,6],[24,14],[12,14]]);
  const targetVent=polygon('targetvent',[[75,6],[84,6],[84,15],[75,15]]);
  history=addSketch(history,'sketch.source.vent',sourceVent);
  history=addSketch(history,'sketch.source.finish',sourceFinish);
  history=addSketch(history,'sketch.target.relief',targetRelief);
  history=addSketch(history,'sketch.target.vent',targetVent);
  history=addCut(history,'cut.guard.relief','sketch.relief',
    candidates['sketch.relief'],'extrude.guard',{kind:'blind',depthMm:3});
  history=addCut(history,'cut.guard.vent','sketch.source.vent',
    profile(sourceVent),'cut.guard.relief',{kind:'through_all'});
  history=addCut(history,'cut.guard.finish','sketch.source.finish',
    profile(sourceFinish),'cut.guard.vent',{kind:'blind',depthMm:1});
  const before=history;
  const selected={format:ADAPTED_RECIPE_FORMAT,version:1,
    expectedProjectId:before.document.projectId,
    expectedRevision:before.document.revision,
    expectedDocumentFence:model.serializeProject(before.document),
    units:'mm',frame:'local_xy',
    sourceBodyId:'body.guard',targetBodyId:'body.backer',
    sourceCutFeatureIds:['cut.guard.relief','cut.guard.vent'],
    targetAfterBodyWriterId:'extrude.backer'};
  const inventory=inspectAdaptableCutRecipe(before,selected,services);
  assert.deepEqual(inventory.sourceWriterOrder,[
    'extrude.guard','cut.guard.relief','cut.guard.vent','cut.guard.finish']);
  const targetCuts=[
    {sourceCutFeatureId:'cut.guard.relief',sourceSketchId:'sketch.target.relief',
      profileCandidateId:profile(targetRelief),extent:{kind:'blind',depthMm:4}},
    {sourceCutFeatureId:'cut.guard.vent',sourceSketchId:'sketch.target.vent',
      profileCandidateId:profile(targetVent),extent:{kind:'blind',depthMm:2}}
  ];
  const request={...selected,expectedSourceCuts:inventory.sourceCuts,
    targetCuts,newCutFeatureIds:['cut.backer.relief.adapted','cut.backer.vent.adapted'],
    eventIds:['adapt.backer.relief','adapt.backer.vent']};
  const saved=model.serializeProject(before.document);
  const bad=[
    {...request,expectedRevision:request.expectedRevision-1},
    {...request,expectedDocumentFence:request.expectedDocumentFence+' '},
    {...request,targetBodyId:'body.guard'},
    {...request,targetBodyId:'body.shim'},
    {...request,sourceCutFeatureIds:[...request.sourceCutFeatureIds].reverse()},
    {...request,sourceCutFeatureIds:['cut.guard.relief','cut.guard.finish']},
    {...request,expectedSourceCuts:[...inventory.sourceCuts].reverse()},
    {...request,targetCuts:[...targetCuts].reverse()},
    {...request,targetCuts:[targetCuts[0],{...targetCuts[1],
      sourceSketchId:'sketch.unknown'}]},
    {...request,targetCuts:[targetCuts[0],{...targetCuts[1],
      profileCandidateId:'cycle:invalid'}]},
    {...request,targetCuts:[targetCuts[0],{...targetCuts[1],
      extent:{kind:'blind',depthMm:-2}}]},
    {...request,targetCuts:[...inventory.sourceCuts]},
    {...request,newCutFeatureIds:['cut.backer.a','cut.backer.a']},
    {...request,newCutFeatureIds:['cut.backer.a','extrude.guard']},
    {...request,eventIds:['adapt.backer.a','adapt.backer.a']},
    {...request,eventIds:['make.sketch.target.vent','adapt.backer.vent']},
    {...request,frame:'world_xy'}
  ];
  for(const invalid of bad){
    assert.throws(()=>applyAdaptedCutRecipe(before,invalid,services));
    assert.equal(model.serializeProject(before.document),saved);
  }
  const changed=applyAdaptedCutRecipe(before,request,services);
  assert.equal(get(changed.history,'cut.guard.finish').payload.depthMm,1);
  assert.equal(changed.oneUndoFrame,true);
  assert.equal(changed.history.undoStack.length,before.undoStack.length+1);
  assert.deepEqual(changed.copiedCuts.map(x=>x.status),
    ['pending_exact_provider','blocked_dependency']);
  assert.deepEqual(actions(before,changed.history),
    ['preserve_candidate','rebuild','preserve_candidate']);
  assert.equal(get(changed.history,'cut.guard.vent').payload.throughAll,true);
  assert.equal(get(changed.history,'cut.backer.relief.adapted').payload.depthMm,4);
  assert.equal(get(changed.history,'cut.backer.vent.adapted').payload.depthMm,2);
  const undone=runtime.undo(changed.history,['undo.adapt.relief','undo.adapt.vent']);
  assert.equal(get(undone,'cut.backer.relief.adapted'),undefined);
  const redone=runtime.redo(undone,['redo.adapt.relief','redo.adapt.vent']);
  const reopened=runtime.reopen(runtime.save(redone));
  assert.equal(get(reopened,'cut.backer.vent.adapted').payload.depthMm,2);
  const thick=editExtrudeThickness(reopened,{
    eventId:'edit.guard.depth',featureId:'extrude.guard',
    expectedRevision:reopened.document.revision,thicknessMm:14
  },services);
  const guardImpact=runtime.diff(reopened,thick.history).invalidatedFeatureIds;
  assert.ok(guardImpact.includes('cut.guard.vent'));
  assert.ok(!guardImpact.includes('cut.backer.vent.adapted'));
  const revisedVent=polygon('targetvent',[[76,6],[83,6],[83,15],[76,15]]);
  const resized=runtime.commit(thick.history,[{
    eventId:'edit.target.vent',type:'feature.edit',featureId:'sketch.target.vent',
    patch:{payload:{...get(thick.history,'sketch.target.vent').payload,sketch:revisedVent}}
  }],thick.history.document.revision);
  const targetImpact=runtime.diff(thick.history,resized).invalidatedFeatureIds;
  assert.ok(targetImpact.includes('cut.backer.vent.adapted'));
  assert.ok(!targetImpact.includes('cut.guard.vent'));
  assert.ok(!targetImpact.includes('extrude.shim'));
  const final=runtime.reopen(runtime.save(resized));
  assert.equal(get(final,'extrude.guard').payload.thicknessMm,14);
  assert.equal(get(final,'extrude.shim').payload.thicknessMm,3);
  assert.equal(get(final,'cut.backer.vent.adapted').payload.depthMm,2);
  return {kind:'real_INTENT_SKETCH_RUNTIME_adapted_recipe',
    adaptedCutIds:changed.copiedCuts.map(x=>x.cutFeatureId),
    adaptedStatuses:changed.copiedCuts.map(x=>x.status),
    oneUndoFrame:changed.oneUndoFrame,bodyActions:actions(before,changed.history),
    negativeSelectionsRefused:bad.length,archiveUndoRedo:true,
    sourceBlockNonTerminal:true,
    sourceTailPreserved:get(final,'cut.guard.finish')?.payload.depthMm===1,
    guardDepthMm:get(final,'extrude.guard').payload.thicknessMm,
    unaffectedShimDepthMm:get(final,'extrude.shim').payload.thicknessMm,
    exactAuthority:false,nativeSTEP:'not_executed'};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  process.stdout.write(JSON.stringify(runAdaptedCutRecipe(),null,2)+'\n');
