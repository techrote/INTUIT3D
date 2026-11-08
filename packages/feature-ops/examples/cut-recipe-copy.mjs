/**
 * Guard/backer/shim: copy a two-operation machining recipe (blind relief,
 * through vent) across explicit bodies, with shared SKETCH sources.
 * Real SKETCH/INTENT/RUNTIME only; no measured native Boolean/STEP claim.
 *
 * node --experimental-strip-types packages/feature-ops/examples/cut-recipe-copy.mjs
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as cutChain from '@intuit3d/model/body-cut-chain';
import {BODY_REBUILD_MANIFEST_FORMAT,planBodyRebuildManifest}
  from '@intuit3d/model/body-rebuild-manifest';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT}
  from '@intuit3d/feature-ops/ordered-cut/v1';
import {editExtrudeThickness} from '@intuit3d/feature-ops';
import {CUT_RECIPE_COPY_FORMAT,inspectCutRecipeCopy,copyCutRecipeToBody}
  from '@intuit3d/feature-ops/cut-recipe-copy/v1';
import {makeAssembly,polygon,runtime,services}
  from './coordinated-pockets.mjs';
const feature=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);
const changed=(a,b)=>runtime.diff(a,b).invalidatedFeatureIds;
const actions=(a,b)=>planBodyRebuildManifest(a.document,b.document,{
  format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
  expectedProjectId:a.document.projectId,
  expectedFromRevision:a.document.revision,
  expectedToRevision:b.document.revision,
  bodyIds:['body.guard','body.backer','body.shim'],
}).bodies.map(b=>b.action);
function append(history,cutFeatureId,sourceSketchId,profileCandidateId,
  afterBodyWriterId,extent){
  return appendOrderedProfileCut(history,{
    format:ORDERED_CUT_FORMAT,version:1,
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    eventId:'author.'+cutFeatureId,units:'mm',frame:'local_xy',
    sourceSketchId,profileCandidateId,afterBodyWriterId,
    targetBodyId:'body.guard',cutFeatureId,extent,
  },services).history;
}
export function runCutRecipeCopy(){
  let {history,candidates}=makeAssembly();
  // Distinct cutter sources physically lie inside the overlapping local XY
  // bounds of both already-authored guard and backer. Native geometric
  // intersection and precise placement remain separate provider gates.
  const port=polygon('port',[[70,5],[83,5],[83,15],[70,15]]);
  const discovered=discovery.discoverPlateProfiles(port);
  assert.equal(discovered.status,'ready');
  assert.equal(discovered.candidates.length,1);
  history=runtime.commit(history,[{
    eventId:'author.sketch.port',type:'feature.create',
    feature:{id:'sketch.port',kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:port}},
  }],history.document.revision);
  history=append(history,'cut.guard.relief','sketch.relief',
    candidates['sketch.relief'],'extrude.guard',{kind:'blind',depthMm:3});
  history=append(history,'cut.guard.port','sketch.port',
    discovered.candidates[0].id,'cut.guard.relief',{kind:'through_all'});
  const before=history;
  const selection={format:CUT_RECIPE_COPY_FORMAT,version:1,
    expectedProjectId:before.document.projectId,
    expectedRevision:before.document.revision,
    expectedDocumentFence:model.serializeProject(before.document),
    units:'mm',frame:'local_xy',sourceBodyId:'body.guard',targetBodyId:'body.backer',
    sourceCutFeatureIds:['cut.guard.relief','cut.guard.port'],
    targetAfterBodyWriterId:'extrude.backer'};
  const inventory=inspectCutRecipeCopy(history,selection,services);
  assert.deepEqual(inventory.sourceCuts.map(c=>c.extent),[
    {kind:'blind',depthMm:3},{kind:'through_all'}]);
  assert.deepEqual(inventory.targetWriterOrder,['extrude.backer']);
  const request={...selection,expectedSourceCuts:inventory.sourceCuts,
    newCutFeatureIds:['cut.backer.relief.copy','cut.backer.port.copy'],
    eventIds:['copy.backer.relief','copy.backer.port']};
  const sourceJson=model.serializeProject(history.document);
  const badRequests=[
    {...request,expectedRevision:request.expectedRevision-1},
    {...request,expectedDocumentFence:request.expectedDocumentFence+' '},
    {...request,targetBodyId:'body.guard'},
    {...request,targetBodyId:'body.shim'},
    {...request,targetAfterBodyWriterId:'cut.guard.port'},
    {...request,sourceCutFeatureIds:['cut.guard.port','cut.guard.relief']},
    {...request,sourceCutFeatureIds:['cut.guard.relief']},
    {...request,expectedSourceCuts:[...inventory.sourceCuts].reverse()},
    {...request,newCutFeatureIds:['cut.backer.relief.copy','cut.backer.relief.copy']},
    {...request,newCutFeatureIds:['cut.backer.relief.copy','extrude.backer']},
    {...request,eventIds:['copy.backer.relief','copy.backer.relief']},
    {...request,eventIds:['copy.backer.relief']},
    {...request,frame:'world_xy'},
    {...request,units:'cm'},
  ];
  for(const invalid of badRequests){
    assert.throws(()=>copyCutRecipeToBody(history,invalid,services));
    assert.equal(model.serializeProject(history.document),sourceJson);
  }
  const copied=copyCutRecipeToBody(history,request,services);
  assert.equal(copied.history.undoStack.length,before.undoStack.length+1);
  assert.deepEqual(copied.targetWriterOrderAfter,[
    'extrude.backer','cut.backer.relief.copy','cut.backer.port.copy']);
  assert.deepEqual(copied.copiedCuts.map(c=>c.status),[
    'pending_exact_provider','blocked_dependency']);
  const after=copied.history;
  assert.deepEqual(actions(before,after),[
    'preserve_candidate','rebuild','preserve_candidate']);
  for(const [src,dst] of [
    ['cut.guard.relief','cut.backer.relief.copy'],
    ['cut.guard.port','cut.backer.port.copy'],
  ]) {
    assert.notEqual(feature(after,src).id,feature(after,dst).id);
    assert.equal(feature(after,src).payload.sourceSketchId,
      feature(after,dst).payload.sourceSketchId);
    assert.equal(feature(after,dst).payload.targetBodyId,'body.backer');
  }
  const undone=runtime.undo(after,['undo.copy.backer.relief','undo.copy.backer.port']);
  assert.equal(feature(undone,'cut.backer.relief.copy'),undefined);
  assert.equal(feature(undone,'cut.backer.port.copy'),undefined);
  const redone=runtime.redo(undone,['redo.copy.backer.relief','redo.copy.backer.port']);
  const reopened=runtime.reopen(runtime.save(redone));
  assert.equal(feature(reopened,'cut.backer.relief.copy').payload.depthMm,3);
  assert.equal(feature(reopened,'cut.backer.port.copy').payload.throughAll,true);
  const thickness=editExtrudeThickness(reopened,{
    eventId:'edit.guard.depth',featureId:'extrude.guard',
    expectedRevision:reopened.document.revision,thicknessMm:14,
  },services);
  assert.ok(thickness.invalidation.invalidatedFeatureIds.includes('cut.guard.port'));
  assert.ok(!thickness.invalidation.invalidatedFeatureIds.includes('cut.backer.port.copy'));
  const editedPort=polygon('port',[[72,5],[82,5],[82,15],[72,15]]);
  const shared=runtime.commit(thickness.history,[{
    eventId:'edit.shared.port',type:'feature.edit',featureId:'sketch.port',
    patch:{payload:{...feature(thickness.history,'sketch.port').payload,
      sketch:editedPort}},
  }],thickness.history.document.revision);
  const affected=changed(thickness.history,shared);
  assert.ok(affected.includes('cut.guard.port'));
  assert.ok(affected.includes('cut.backer.port.copy'));
  assert.ok(!affected.includes('extrude.shim'));
  const final=runtime.reopen(runtime.save(shared));
  assert.equal(feature(final,'extrude.guard').payload.thicknessMm,14);
  assert.equal(feature(final,'extrude.shim').payload.thicknessMm,3);
  return {kind:'real_INTENT_SKETCH_RUNTIME_mechanical_consumer',
    capability:'one_gesture_cross_body_cut_recipe_copy',
    sourceCutIds:inventory.sourceCuts.map(x=>x.sourceCutFeatureId),
    copiedCutIds:copied.copiedCuts.map(x=>x.cutFeatureId),
    copiedExtents:copied.copiedCuts.map(x=>x.extent),
    copiedStatuses:copied.copiedCuts.map(x=>x.status),
    authoringEvents:copied.eventIds.length,oneUndoFrame:copied.oneUndoFrame,
    bodyActions:actions(before,after),
    sharedSketchAffects:[...affected],
    guardThicknessMm:feature(final,'extrude.guard').payload.thicknessMm,
    independentShimThicknessMm:feature(final,'extrude.shim').payload.thicknessMm,
    negativeSelectionsRefused:badRequests.length,
    archiveUndoRedo:true,exactAuthority:false,nativeSTEP:'not_executed'};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  process.stdout.write(JSON.stringify(runCutRecipeCopy(),null,2)+'\n');