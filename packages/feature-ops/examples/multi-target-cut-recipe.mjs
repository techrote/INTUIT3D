/**
 * One user action machines a backing rail AND a thin shim with the selected
 * interior relief/bore recipe from a source guard; one destination uses
 * independently selected pocket depth. Real accepted MODEL/SKETCH/RUNTIME.
 * No native Boolean, physical intersection measurement or STEP claim.
 *
 * node --experimental-strip-types packages/feature-ops/examples/multi-target-cut-recipe.mjs
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {BODY_REBUILD_MANIFEST_FORMAT,planBodyRebuildManifest}
  from '@intuit3d/model/body-rebuild-manifest';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT}
  from '@intuit3d/feature-ops/ordered-cut/v1';
import {editExtrudeThickness} from '@intuit3d/feature-ops';
import {MULTI_TARGET_CUT_RECIPE_FORMAT,
  inspectMultiTargetCutRecipe,applyMultiTargetCutRecipe}
  from '@intuit3d/feature-ops/multi-target-cut-recipe/v1';
import {makeAssembly,polygon,runtime,services} from './coordinated-pockets.mjs';

const lookup=(history,featureId)=>
  model.featuresOf(history.document).find(f=>f.id===featureId);
function authorSketch(history,featureId,polygonName,vertices){
  const sk=polygon(polygonName,vertices);
  const found=discovery.discoverPlateProfiles(sk);
  assert.equal(found.status,'ready');
  assert.equal(found.candidates.length,1);
  return {
    history:runtime.commit(history,[{
      eventId:'create.'+featureId,type:'feature.create',
      feature:{id:featureId,kind:'sketch',dependsOn:[],writeTargets:[],
        payload:{sketch:sk}}
    }],history.document.revision),
    profileId:found.candidates[0].id
  };
}
function append(history,cutFeatureId,sourceSketchId,profileCandidateId,
  afterBodyWriterId,extent){
  return appendOrderedProfileCut(history,{
    format:ORDERED_CUT_FORMAT,version:1,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    eventId:'create.'+cutFeatureId,units:'mm',frame:'local_xy',
    sourceSketchId,profileCandidateId,afterBodyWriterId,
    targetBodyId:'body.guard',cutFeatureId,extent
  },services).history;
}
export function runMultiTargetRecipe(){
  let {history,candidates}=makeAssembly();
  const bore=authorSketch(history,'sketch.bore','bore',
    [[13,7],[21,7],[21,11],[13,11]]);
  history=bore.history;
  const finish=authorSketch(history,'sketch.finish','finish',
    [[70,5],[83,5],[83,15],[70,15]]);
  history=finish.history;
  history=append(history,'cut.guard.relief','sketch.relief',
    candidates['sketch.relief'],'extrude.guard',{kind:'blind',depthMm:3});
  history=append(history,'cut.guard.bore','sketch.bore',
    bore.profileId,'cut.guard.relief',{kind:'through_all'});
  history=append(history,'cut.guard.finish','sketch.finish',
    finish.profileId,'cut.guard.bore',{kind:'blind',depthMm:1});
  const before=history;
  const select={
    format:MULTI_TARGET_CUT_RECIPE_FORMAT,version:1,
    expectedProjectId:before.document.projectId,
    expectedRevision:before.document.revision,
    expectedDocumentFence:model.serializeProject(before.document),
    units:'mm',frame:'local_xy',sourceBodyId:'body.guard',
    sourceCutFeatureIds:['cut.guard.relief','cut.guard.bore'],
    targets:[
      {targetBodyId:'body.backer',targetAfterBodyWriterId:'extrude.backer'},
      {targetBodyId:'body.shim',targetAfterBodyWriterId:'extrude.shim'}
    ]
  };
  const view=inspectMultiTargetCutRecipe(before,select,services);
  assert.equal(view.totalNewCuts,4);
  assert.deepEqual(view.sourceWriterOrder,[
    'extrude.guard','cut.guard.relief','cut.guard.bore','cut.guard.finish']);
  assert.deepEqual(view.targets.map(t=>t.targetWriterOrder),[
    ['extrude.backer'],['extrude.shim']]);
  const request={...select,expectedSourceCuts:view.sourceCuts,targetPlans:[
    {mode:'copy',targetBodyId:'body.backer',
      targetAfterBodyWriterId:'extrude.backer',
      newCutFeatureIds:['cut.backer.relief.batch','cut.backer.bore.batch'],
      eventIds:['batch.backer.relief','batch.backer.bore']},
    {mode:'adapt',targetBodyId:'body.shim',
      targetAfterBodyWriterId:'extrude.shim',
      targetCuts:view.sourceCuts.map((cut,i)=>({
        sourceCutFeatureId:cut.sourceCutFeatureId,
        sourceSketchId:cut.sourceSketchId,
        profileCandidateId:cut.profileCandidateId,
        extent:i===0?{kind:'blind',depthMm:1.5}:cut.extent
      })),
      newCutFeatureIds:['cut.shim.relief.batch','cut.shim.bore.batch'],
      eventIds:['batch.shim.relief','batch.shim.bore']}
  ]};
  const bad=[
    {...request,expectedRevision:select.expectedRevision-1},
    {...request,expectedDocumentFence:select.expectedDocumentFence+' '},
    {...request,units:'cm'},
    {...request,frame:'world_xy'},
    {...request,targets:[select.targets[0],select.targets[0]]},
    {...request,targets:[select.targets[0],{targetBodyId:'body.guard',
      targetAfterBodyWriterId:'cut.guard.finish'}]},
    {...request,sourceCutFeatureIds:['cut.guard.bore','cut.guard.relief']},
    {...request,sourceCutFeatureIds:['cut.guard.relief','cut.guard.finish']},
    {...request,expectedSourceCuts:[...view.sourceCuts].reverse()},
    {...request,targetPlans:[request.targetPlans[0],{
      ...request.targetPlans[1],newCutFeatureIds:[
        request.targetPlans[0].newCutFeatureIds[0],'cut.shim.bore.batch']}]},
    {...request,targetPlans:[request.targetPlans[0],{
      ...request.targetPlans[1],eventIds:[
        request.targetPlans[0].eventIds[0],'batch.shim.bore']}]},
    {...request,targetPlans:[request.targetPlans[0],{
      ...request.targetPlans[1],targetBodyId:'body.missing'}]},
    {...request,targetPlans:[request.targetPlans[0],{
      ...request.targetPlans[1],targetCuts:[
        {...request.targetPlans[1].targetCuts[0],sourceSketchId:'sketch.missing'},
        request.targetPlans[1].targetCuts[1]]}]},
    {...request,targetPlans:[request.targetPlans[0],{
      ...request.targetPlans[1],targetCuts:[
        {...request.targetPlans[1].targetCuts[0],
          extent:{kind:'blind',depthMm:-1}},request.targetPlans[1].targetCuts[1]]}]},
  ];
  for(const invalid of bad){
    assert.throws(()=>applyMultiTargetCutRecipe(before,invalid,services));
    assert.equal(model.serializeProject(before.document),select.expectedDocumentFence);
  }
  const committed=applyMultiTargetCutRecipe(before,request,services);
  const after=committed.history;
  assert.equal(committed.oneUndoFrame,true);
  assert.equal(after.undoStack.length,before.undoStack.length+1);
  assert.equal(after.document.revision,before.document.revision+4);
  assert.deepEqual(committed.nativeHandoff.bodyIds,['body.backer','body.shim']);
  assert.equal(lookup(after,'cut.guard.finish').payload.depthMm,1);
  const bodyActions=planBodyRebuildManifest(before.document,after.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:before.document.projectId,
    expectedFromRevision:before.document.revision,
    expectedToRevision:after.document.revision,
    bodyIds:['body.guard','body.backer','body.shim'],
  }).bodies.map(body=>body.action);
  assert.deepEqual(bodyActions,['preserve_candidate','rebuild','rebuild']);
  for(const target of ['backer','shim']){
    for(const name of ['relief','bore']){
      const f=lookup(after,'cut.'+target+'.'+name+'.batch');
      assert.equal(f.kind,'cut');
      assert.equal(f.payload.targetBodyId,'body.'+target);
    }
  }
  assert.equal(lookup(after,'cut.backer.relief.batch').payload.depthMm,3);
  assert.equal(lookup(after,'cut.shim.relief.batch').payload.depthMm,1.5);
  assert.equal(lookup(after,'cut.shim.bore.batch').payload.throughAll,true);
  const changed=committed.invalidation.invalidatedFeatureIds;
  assert.ok(changed.includes('cut.backer.bore.batch'));
  assert.ok(changed.includes('cut.shim.bore.batch'));
  assert.ok(!changed.includes('cut.guard.bore'));
  const undo=runtime.undo(after,request.targetPlans.flatMap(p=>
    p.eventIds.map(id=>'undo.'+id)));
  for(const target of ['backer','shim'])
    assert.equal(lookup(undo,'cut.'+target+'.relief.batch'),undefined);
  const redo=runtime.redo(undo,request.targetPlans.flatMap(p=>
    p.eventIds.map(id=>'redo.'+id)));
  const reopened=runtime.reopen(runtime.save(redo));
  assert.equal(lookup(reopened,'cut.shim.relief.batch').payload.depthMm,1.5);
  assert.equal(lookup(reopened,'cut.guard.finish').payload.depthMm,1);
  const edited=editExtrudeThickness(reopened,{
    eventId:'edit.guard.depth.batch',featureId:'extrude.guard',
    expectedRevision:reopened.document.revision,thicknessMm:14
  },services);
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes('cut.guard.bore'));
  assert.ok(!edited.invalidation.invalidatedFeatureIds.includes('cut.backer.bore.batch'));
  assert.ok(!edited.invalidation.invalidatedFeatureIds.includes('cut.shim.bore.batch'));
  const src=lookup(edited.history,'sketch.relief');
  const updated=polygon('relief',[[11,5],[25,5],[25,13],[11,13]]);
  const shared=runtime.commit(edited.history,[{
    eventId:'edit.shared.relief.batch',type:'feature.edit',
    featureId:'sketch.relief',patch:{payload:{...src.payload,sketch:updated}}
  }],edited.history.document.revision);
  const affected=runtime.diff(edited.history,shared).invalidatedFeatureIds;
  for(const name of ['cut.guard.relief','cut.backer.relief.batch',
    'cut.shim.relief.batch'])assert.ok(affected.includes(name));
  assert.ok(!affected.includes('extrude.backer'));
  const final=runtime.reopen(runtime.save(shared));
  assert.equal(lookup(final,'extrude.guard').payload.thicknessMm,14);
  return {
    kind:'real_INTENT_SKETCH_RUNTIME_multi_target_recipe',
    copiedCuts:committed.destinations.map(x=>x.copiedCuts.map(c=>c.cutFeatureId)),
    targetModes:committed.destinations.map(x=>x.mode),
    targetStatuses:committed.destinations.map(x=>x.copiedCuts.map(c=>c.status)),
    oneUndoFrame:committed.oneUndoFrame,
    events:committed.allEventIds.length,
    negativeSelectionsRefused:bad.length,
    sourceTailPreserved:true,
    bodyActions,crossBodyInvalidation:changed,
    sharedProfileInvalidation:affected,
    archiveUndoRedo:true,guardThicknessMm:14,
    exactAuthority:false,nativeSTEP:'not_executed',
  };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  process.stdout.write(JSON.stringify(runMultiTargetRecipe(),null,2)+'\n');
