/**
 * Runnable real mechanical workflow: place a guard's relief/counterbore recipe
 * BETWEEN the pilot and finishing operations of an existing backing rail.
 * The independent shim and source guard are not changed by the insertion.
 *
 * Semantic CAD with recoverable pending Booleans, NOT native STEP acceptance.
 * node --experimental-strip-types packages/feature-ops/examples/interior-recipe-insert.mjs
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as block from '@intuit3d/model/body-cut-block-relocate';
import {BODY_REBUILD_MANIFEST_FORMAT,planBodyRebuildManifest}
  from '@intuit3d/model/body-rebuild-manifest';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT}
  from '@intuit3d/feature-ops/ordered-cut/v1';
import {editExtrudeThickness} from '@intuit3d/feature-ops';
import {
  INTERIOR_RECIPE_INSERT_FORMAT,inspectInteriorRecipeInsertion,
  applyInteriorRecipeInsertion,
} from '@intuit3d/feature-ops/interior-recipe-insert/v1';
import {makeAssembly,polygon,runtime,services as basicServices}
  from './coordinated-pockets.mjs';

const services={...basicServices,block};
const lookup=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);
function sketchSource(history,id,vertices){
  const authored=polygon(id,vertices);
  const found=discovery.discoverPlateProfiles(authored);
  assert.equal(found.status,'ready');
  assert.equal(found.candidates.length,1);
  history=runtime.commit(history,[{
    eventId:'create.'+id,type:'feature.create',
    feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:authored}},
  }],history.document.revision);
  return {history,profileId:found.candidates[0].id};
}
function append(history,bodyId,cutId,sketchId,profileId,after,extent){
  return appendOrderedProfileCut(history,{
    format:ORDERED_CUT_FORMAT,version:1,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    eventId:'create.'+cutId,
    units:'mm',frame:'local_xy',
    sourceSketchId:sketchId,profileCandidateId:profileId,
    afterBodyWriterId:after,targetBodyId:bodyId,cutFeatureId:cutId,extent,
  },basicServices).history;
}
function manifest(before,after){
  return planBodyRebuildManifest(before.document,after.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:before.document.projectId,
    expectedFromRevision:before.document.revision,
    expectedToRevision:after.document.revision,
    bodyIds:['body.guard','body.backer','body.shim'],
  }).bodies.map(b=>b.action);
}
export function runInteriorRecipeInsertion(){
  let {history,candidates}=makeAssembly();
  const bore=sketchSource(history,'sketch.guard.bore',
    [[12,5],[20,5],[20,11],[12,11]]);
  history=bore.history;
  const guardFinish=sketchSource(history,'sketch.guard.finish',
    [[65,5],[76,5],[76,12],[65,12]]);
  history=guardFinish.history;
  const pilot=sketchSource(history,'sketch.backer.pilot',
    [[34,4],[42,4],[42,10],[34,10]]);
  history=pilot.history;
  const backerFinish=sketchSource(history,'sketch.backer.finish',
    [[75,5],[88,5],[88,15],[75,15]]);
  history=backerFinish.history;
  history=append(history,'body.guard','cut.guard.relief','sketch.relief',
    candidates['sketch.relief'],'extrude.guard',{kind:'blind',depthMm:3});
  history=append(history,'body.guard','cut.guard.bore','sketch.guard.bore',
    bore.profileId,'cut.guard.relief',{kind:'through_all'});
  history=append(history,'body.guard','cut.guard.finish','sketch.guard.finish',
    guardFinish.profileId,'cut.guard.bore',{kind:'blind',depthMm:1});
  history=append(history,'body.backer','cut.backer.pilot','sketch.backer.pilot',
    pilot.profileId,'extrude.backer',{kind:'through_all'});
  history=append(history,'body.backer','cut.backer.finish','sketch.backer.finish',
    backerFinish.profileId,'cut.backer.pilot',{kind:'blind',depthMm:1});
  const before=history,canonical=model.serializeProject(before.document);
  const selection={
    format:INTERIOR_RECIPE_INSERT_FORMAT,version:1,
    expectedProjectId:before.document.projectId,
    expectedRevision:before.document.revision,
    expectedDocumentFence:canonical,units:'mm',frame:'local_xy',
    sourceBodyId:'body.guard',
    sourceCutFeatureIds:['cut.guard.relief','cut.guard.bore'],
    targetBodyId:'body.backer',targetAfterBodyWriterId:'cut.backer.finish',
    newCutFeatureIds:['cut.backer.relief.insert','cut.backer.bore.insert'],
    copyEventIds:['insert.copy.relief','insert.copy.bore'],
  };
  const inventory=inspectInteriorRecipeInsertion(before,selection,services);
  assert.deepEqual(inventory.targetWriterOrder,[
    'extrude.backer','cut.backer.pilot','cut.backer.finish']);
  assert.deepEqual(inventory.sourceWriterOrder,[
    'extrude.guard','cut.guard.relief','cut.guard.bore','cut.guard.finish']);
  const anchor=inventory.insertionDestinations.find(x=>
    x.afterBodyWriterId==='cut.backer.pilot');
  assert.equal(anchor?.eligibility,'available');
  assert.ok([2,3].includes(anchor.requiredEventIds));
  const request={...selection,
    expectedSourceCuts:inventory.sourceCuts,
    expectedTargetWriterOrder:inventory.targetWriterOrder,
    insertAfterBodyWriterId:'cut.backer.pilot',
    moveEventIds:['insert.move.one','insert.move.two','insert.move.three']
      .slice(0,anchor.requiredEventIds),
  };
  const invalid=[
    {...request,expectedRevision:request.expectedRevision-1},
    {...request,expectedDocumentFence:canonical+'!'},
    {...request,units:'cm'},
    {...request,frame:'global_xy'},
    {...request,targetBodyId:'body.guard'},
    {...request,targetAfterBodyWriterId:'extrude.backer'},
    {...request,sourceCutFeatureIds:['cut.guard.bore','cut.guard.relief']},
    {...request,expectedSourceCuts:[...inventory.sourceCuts].reverse()},
    {...request,expectedTargetWriterOrder:[...inventory.targetWriterOrder].reverse()},
    {...request,insertAfterBodyWriterId:'cut.backer.finish'},
    {...request,insertAfterBodyWriterId:'cut.guard.relief'},
    {...request,insertAfterBodyWriterId:'absent.cut'},
    {...request,newCutFeatureIds:['cut.backer.relief.insert','cut.backer.relief.insert']},
    {...request,copyEventIds:['insert.copy.relief','insert.copy.relief']},
    {...request,moveEventIds:[...request.moveEventIds,'extra.event']},
    {...request,moveEventIds:request.moveEventIds.slice(1)},
    {...request,moveEventIds:request.moveEventIds.map(()=>'duplicate.move')},
    {...request,moveEventIds:[...request.moveEventIds.slice(0,-1),'create.cut.guard.relief']},
    {...request,copyEventIds:['create.cut.guard.relief','insert.copy.bore']},
  ];
  for(const bad of invalid){
    assert.throws(()=>applyInteriorRecipeInsertion(before,bad,services));
    assert.equal(model.serializeProject(before.document),canonical);
  }
  const result=applyInteriorRecipeInsertion(before,request,services);
  const after=result.history;
  assert.equal(result.oneUndoFrame,true);
  assert.equal(after.undoStack.length,before.undoStack.length+1);
  assert.equal(after.document.revision,before.document.revision+result.eventIds.length);
  assert.deepEqual(result.writerOrderAfter,[
    'extrude.backer','cut.backer.pilot',
    'cut.backer.relief.insert','cut.backer.bore.insert','cut.backer.finish']);
  assert.equal(lookup(after,'cut.guard.finish').payload.depthMm,1);
  assert.deepEqual(result.insertedCuts.map(x=>x.sourceCutFeatureId),
    ['cut.guard.relief','cut.guard.bore']);
  assert.deepEqual(result.insertedCuts.map(x=>x.cutFeatureId),
    ['cut.backer.relief.insert','cut.backer.bore.insert']);
  assert.equal(lookup(after,'cut.backer.relief.insert').payload.depthMm,3);
  assert.equal(lookup(after,'cut.backer.bore.insert').payload.throughAll,true);
  assert.deepEqual(manifest(before,after),
    ['preserve_candidate','rebuild','preserve_candidate']);
  assert.ok(result.invalidation.invalidatedFeatureIds.includes('cut.backer.finish'));
  assert.ok(!result.invalidation.invalidatedFeatureIds.includes('cut.guard.bore'));
  const undone=runtime.undo(after,result.eventIds.map(e=>'undo.'+e));
  assert.equal(lookup(undone,'cut.backer.relief.insert'),undefined);
  assert.deepEqual(lookup(undone,'cut.backer.finish').dependsOn,
    lookup(before,'cut.backer.finish').dependsOn);
  const redone=runtime.redo(undone,result.eventIds.map(e=>'redo.'+e));
  const reopened=runtime.reopen(runtime.save(redone));
  assert.deepEqual(lookup(reopened,'cut.backer.finish').dependsOn,
    lookup(after,'cut.backer.finish').dependsOn);
  const thickened=editExtrudeThickness(reopened,{
    eventId:'edit.guard.base.insertion',featureId:'extrude.guard',
    expectedRevision:reopened.document.revision,thicknessMm:14,
  },basicServices);
  assert.ok(thickened.invalidation.invalidatedFeatureIds.includes('cut.guard.bore'));
  assert.ok(!thickened.invalidation.invalidatedFeatureIds.includes(
    'cut.backer.bore.insert'));
  const oldSketch=lookup(thickened.history,'sketch.relief');
  const shared=runtime.commit(thickened.history,[{
    eventId:'edit.shared.relief.insertion',type:'feature.edit',
    featureId:'sketch.relief',
    patch:{payload:{...oldSketch.payload,
      sketch:polygon('relief',[[11,5],[27,5],[27,14],[11,14]])}},
  }],thickened.history.document.revision);
  const touched=runtime.diff(thickened.history,shared).invalidatedFeatureIds;
  assert.ok(touched.includes('cut.guard.relief'));
  assert.ok(touched.includes('cut.backer.relief.insert'));
  assert.ok(!touched.includes('extrude.shim'));
  const final=runtime.reopen(runtime.save(shared));
  assert.equal(lookup(final,'extrude.guard').payload.thicknessMm,14);
  return {
    kind:'real_SKETCH_INTENT_RUNTIME_interior_recipe_insertion',
    sourceBody:'body.guard',targetBody:'body.backer',
    targetWriterOrder:result.writerOrderAfter,
    insertedCuts:result.insertedCuts.map(x=>x.cutFeatureId),
    rewiredWriterIds:result.rewiredWriterIds,
    events:result.eventIds.length,oneUndoFrame:result.oneUndoFrame,
    negativeSelectionsRefused:invalid.length,
    bodyActions:manifest(before,after),
    sourceTailPreserved:true,archiveUndoRedo:true,
    retrospectiveSourceInvalidation:touched,
    exactAuthority:false,nativeSTEP:'not_executed',
  };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  process.stdout.write(JSON.stringify(runInteriorRecipeInsertion(),null,2)+'\n');
