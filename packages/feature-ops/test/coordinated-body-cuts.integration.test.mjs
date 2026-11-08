import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import {authorCoordinatedBodyCuts,reconfigureCoordinatedBodyCutExtents}
  from '@intuit3d/feature-ops/coordinated-body-cuts/v1';
import {makeAssembly,authorRequest,editRequest,runDemo,services,runtime}
  from '../examples/coordinated-pockets.mjs';
const byId=(h,id)=>model.featuresOf(h.document).find(x=>x.id===id);
const status=(h,id)=>runtime.inspect(h).features.find(x=>x.featureId===id)?.status;
function fixture(){
  const {history,candidates}=makeAssembly();
  const request=authorRequest(history,candidates);
  return {history,candidates,request};
}
test('real two-body common-profile pocket creates separate explicit body writers in ONE undo frame',()=>{
  const {history,request}=fixture();
  const before=history.document.revision;
  const response=authorCoordinatedBodyCuts(history,request,services);
  assert.equal(response.kind,'committed');
  assert.equal(response.history.document.revision,before+2);
  assert.equal(response.history.undoStack.length,history.undoStack.length+1);
  assert.equal(response.cuts.length,2);
  assert.deepEqual(response.cuts.map(x=>x.status),
    ['pending_exact_provider','pending_exact_provider']);
  assert.deepEqual(response.cuts.map(x=>x.extent),
    [{kind:'blind',depthMm:3},{kind:'through_all'}]);
  assert.equal(response.cuts[0].nativeHandoff.compatibility,
    'not_claimed_ask_RUNTIME_provider');
  assert.equal(response.exactAuthority,false);
  assert.equal(response.independentInteroperability,false);
  assert.deepEqual(byId(response.history,'cut.guard.relief').dependsOn,
    ['extrude.guard','sketch.relief']);
  assert.deepEqual(byId(response.history,'cut.backer.relief').dependsOn,
    ['extrude.backer','sketch.relief']);
  assert.deepEqual(byId(response.history,'cut.guard.relief').writeTargets,['body.guard']);
  assert.deepEqual(byId(response.history,'cut.backer.relief').writeTargets,['body.backer']);
  assert.equal(byId(response.history,'cut.guard.relief').payload.depthMm,3);
  assert.equal(byId(response.history,'cut.backer.relief').payload.throughAll,true);
  assert.equal(byId(response.history,'cut.backer.relief').payload.depthMm,undefined);
  assert.equal(status(response.history,'extrude.shim'),'preview_only');
  assert.ok(!response.invalidation.invalidatedFeatureIds.includes('extrude.shim'));
  const undone=runtime.undo(response.history,['undo.pocket.guard','undo.pocket.backer']);
  assert.equal(byId(undone,'cut.guard.relief'),undefined);
  assert.equal(byId(undone,'cut.backer.relief'),undefined);
  const redone=runtime.redo(undone,['redo.pocket.guard','redo.pocket.backer']);
  const reopen=runtime.reopen(runtime.save(redone));
  assert.equal(status(reopen,'cut.guard.relief'),'pending_exact_provider');
  assert.equal(status(reopen,'cut.backer.relief'),'pending_exact_provider');
  assert.equal(byId(reopen,'cut.guard.relief').id,'cut.guard.relief');
});
test('one retrospective edit changes two extents without replacing feature/body identities',()=>{
  const {history,candidates,request}=fixture();
  const created=authorCoordinatedBodyCuts(history,request,services);
  const edited=reconfigureCoordinatedBodyCutExtents(created.history,
    editRequest(created.history,candidates),services);
  assert.equal(edited.history.document.revision,created.history.document.revision+2);
  assert.equal(edited.history.undoStack.length,created.history.undoStack.length+1);
  assert.deepEqual(edited.previousExtents.map(x=>x.extent),[
    {kind:'blind',depthMm:3},{kind:'through_all'}]);
  assert.deepEqual(edited.cuts.map(x=>x.extent),[
    {kind:'through_all'},{kind:'blind',depthMm:2}]);
  assert.equal(byId(edited.history,'cut.guard.relief').payload.throughAll,true);
  assert.equal(byId(edited.history,'cut.guard.relief').payload.depthMm,undefined);
  assert.equal(byId(edited.history,'cut.backer.relief').payload.depthMm,2);
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes('cut.guard.relief'));
  assert.ok(edited.invalidation.invalidatedFeatureIds.includes('cut.backer.relief'));
  assert.ok(!edited.invalidation.invalidatedFeatureIds.includes('extrude.shim'));
  const undone=runtime.undo(edited.history,['undo.edit.guard','undo.edit.backer']);
  assert.equal(byId(undone,'cut.guard.relief').payload.depthMm,3);
  assert.equal(byId(undone,'cut.backer.relief').payload.throughAll,true);
  const redo=runtime.redo(undone,['redo.edit.guard','redo.edit.backer']);
  const reopened=runtime.reopen(runtime.save(redo));
  assert.equal(byId(reopened,'cut.guard.relief').payload.throughAll,true);
  assert.equal(byId(reopened,'cut.backer.relief').payload.depthMm,2);
  assert.equal(status(reopened,'cut.guard.relief'),'pending_exact_provider');
});
test('preflight rejects stale and invalid second body without altering first or history',()=>{
  const {history,request}=fixture();
  const previous=JSON.stringify(history);
  const wrong=patch=>({...request,cuts:[request.cuts[0],{...request.cuts[1],...patch}]});
  for(const malformed of [
    {...request,expectedRevision:request.expectedRevision-1},
    {...request,expectedProjectId:'different.project'},
    {...request,units:'cm'}, {...request,frame:'world_xy'},
    {...request,profileCandidateId:'cycle:stale'},
    {...request,cuts:request.cuts.slice(0,1)},
    wrong({targetBodyId:'body.missing'}),
    wrong({targetBodyId:'body.guard'}),
    wrong({afterBodyWriterId:'extrude.guard'}),
    wrong({afterBodyWriterId:'extrude.shim'}),
    wrong({cutFeatureId:'cut.guard.relief'}),
    wrong({cutFeatureId:'extrude.backer'}),
    wrong({eventId:'pocket.guard'}),
    wrong({extent:{kind:'blind',depthMm:0}}),
    wrong({extent:{kind:'blind',depthMm:Infinity}}),
    wrong({extent:{kind:'through_all',depthMm:2}})
  ]){
    assert.throws(()=>authorCoordinatedBodyCuts(history,malformed,services));
    assert.equal(JSON.stringify(history),previous);
  }
  assert.equal(byId(history,'cut.guard.relief'),undefined);
  assert.equal(byId(history,'cut.backer.relief'),undefined);
});
test('retrospective edit refuses wrong original extent, mismatched target and stale revision atomically',()=>{
  const {history,request,candidates}=fixture();
  const created=authorCoordinatedBodyCuts(history,request,services);
  const edit=editRequest(created.history,candidates);
  const previous=JSON.stringify(created.history);
  const wrong=patch=>({...edit,cuts:[edit.cuts[0],{...edit.cuts[1],...patch}]});
  for(const malformed of [
    {...edit,expectedRevision:edit.expectedRevision-1},
    {...edit,profileCandidateId:'cycle:other'},
    wrong({fromExtent:{kind:'blind',depthMm:2}}),
    wrong({targetBodyId:'body.shim'}),
    wrong({afterBodyWriterId:'extrude.shim'}),
    wrong({cutFeatureId:'cut.guard.relief'}),
    wrong({eventId:'edit.guard.relief'}),
    wrong({toExtent:{kind:'through_all'}}),
    wrong({toExtent:{kind:'blind',depthMm:0}})
  ]){
    assert.throws(()=>reconfigureCoordinatedBodyCutExtents(created.history,malformed,services));
    assert.equal(JSON.stringify(created.history),previous);
  }
  const edited=reconfigureCoordinatedBodyCutExtents(created.history,edit,services);
  // Even at the new revision, an obsolete original selection is not enough.
  assert.throws(()=>reconfigureCoordinatedBodyCutExtents(edited.history,
    {...edit,expectedRevision:edited.history.document.revision},services));
});
test('independent body isolation and shared source edit invalidate only the actual dependents',()=>{
  const output=runDemo();
  assert.equal(output.status,'semantic_only_pending_native');
  assert.equal(output.guardDepthMm,14);
  assert.equal(output.unchangedShimDepthMm,3);
  assert.deepEqual(output.preservedCutIds,['cut.backer.relief','cut.guard.relief']);
  assert.equal(output.undoFramesForInitialCut,1);
  assert.equal(output.undoFramesForRetrospectiveEdit,1);
  assert.ok(output.affectedByGuardEdit.includes('cut.guard.relief'));
  assert.ok(!output.affectedByGuardEdit.includes('cut.backer.relief'));
  assert.ok(!output.affectedByGuardEdit.includes('extrude.shim'));
  assert.ok(output.affectedBySharedSketch.includes('cut.guard.relief'));
  assert.ok(output.affectedBySharedSketch.includes('cut.backer.relief'));
  assert.ok(!output.affectedBySharedSketch.includes('extrude.shim'));
  assert.deepEqual(output.reopenedStatuses.map(x=>x.status),
    ['pending_exact_provider','pending_exact_provider']);
  assert.equal(output.exactAuthority,false);
});
test('public consumer example runs using accepted packages rather than injected mocks',()=>{
  const file=fileURLToPath(new URL('../examples/coordinated-pockets.mjs',import.meta.url));
  const result=spawnSync(process.execPath,['--experimental-strip-types',file],
    {encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
  assert.equal(result.status,0,result.stderr||String(result.error));
  const output=JSON.parse(result.stdout);
  assert.equal(output.status,'semantic_only_pending_native');
  assert.equal(output.preservedCutIds.length,2);
  assert.equal(output.guardDepthMm,14);
  assert.equal(output.exactAuthority,false);
});
test('requires authentic INTENT chain authority, not inferred writer ordering',()=>{
  const {history,request}=fixture();
  assert.throws(()=>authorCoordinatedBodyCuts(history,request,
    {...services,cutChain:null}),/accepted INTENT/);
});
