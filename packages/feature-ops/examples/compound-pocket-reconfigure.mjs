/**
 * Real SKETCH/INTENT/RUNTIME consumer: one Apply changes the profile source
 * AND the pocket depth/mode on two independent bodies, with one undo frame.
 * This is semantic CAD; no native Boolean, B-rep or STEP is executed.
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as cutSource from '@intuit3d/model/cut-profile-source';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {makeAssembly,authorRequest,polygon,runtime,services as base}
  from './coordinated-pockets.mjs';
import {authorCoordinatedBodyCuts}
  from '@intuit3d/feature-ops/coordinated-body-cuts/v1';
import {editExtrudeThickness} from '@intuit3d/feature-ops';
import {
  reconfigureCompoundPockets,COMPOUND_POCKET_FORMAT,COMPOUND_POCKET_VERSION
} from '@intuit3d/feature-ops/compound-pocket-reconfigure/v1';

const services={...base,transactions,cutSource};
const get=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);

export function runDemo(){
  const start=makeAssembly();
  let history=authorCoordinatedBodyCuts(
    start.history,authorRequest(start.history,start.candidates),services).history;
  const replacement=polygon('compound.relief',
    [[13,6],[31,6],[31,16],[13,16]]);
  const found=discovery.discoverPlateProfiles(replacement);
  assert.equal(found.status,'ready');
  assert.equal(found.candidates.length,1);
  const newCandidate=found.candidates[0].id;
  history=runtime.commit(history,[{
    eventId:'create.sketch.compound.relief',type:'feature.create',
    feature:{id:'sketch.compound.relief',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:replacement}}
  }],history.document.revision);

  const oldRevision=history.document.revision;
  const request={
    format:COMPOUND_POCKET_FORMAT,version:COMPOUND_POCKET_VERSION,
    expectedProjectId:history.document.projectId,
    expectedRevision:oldRevision,units:'mm',frame:'local_xy',
    edits:[
      {
        sourceEventId:'source.guard.relief',extentEventId:'extent.guard.relief',
        cutFeatureId:'cut.guard.relief',targetBodyId:'body.guard',
        afterBodyWriterId:'extrude.guard',
        expectedSourceSketchId:'sketch.relief',
        expectedProfileCandidateId:start.candidates['sketch.relief'],
        sourceSketchId:'sketch.compound.relief',profileCandidateId:newCandidate,
        releasePreviousSketchDependency:true,
        fromExtent:{kind:'blind',depthMm:3},
        toExtent:{kind:'through_all'}
      },{
        sourceEventId:'source.backer.relief',extentEventId:'extent.backer.relief',
        cutFeatureId:'cut.backer.relief',targetBodyId:'body.backer',
        afterBodyWriterId:'extrude.backer',
        expectedSourceSketchId:'sketch.relief',
        expectedProfileCandidateId:start.candidates['sketch.relief'],
        sourceSketchId:'sketch.compound.relief',profileCandidateId:newCandidate,
        releasePreviousSketchDependency:true,
        fromExtent:{kind:'through_all'},
        toExtent:{kind:'blind',depthMm:2.5}
      }
    ],
    retireSketch:{eventId:'retire.sketch.relief',featureId:'sketch.relief'}
  };
  const badRequests=[
    {...request,expectedRevision:oldRevision-1},
    {...request,expectedProjectId:'foreign.project'},
    {...request,units:'in'},
    {...request,frame:'world'},
    {...request,edits:[request.edits[0]]},
    {...request,edits:[request.edits[0],request.edits[0]]},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,targetBodyId:'body.shim'}:e)},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,afterBodyWriterId:'extrude.shim'}:e)},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,expectedProfileCandidateId:'cycle:stale'}:e)},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,profileCandidateId:'cycle:stale'}:e)},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,fromExtent:{kind:'blind',depthMm:99}}:e)},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,toExtent:e.fromExtent}:e)},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,extentEventId:request.edits[0].sourceEventId}:e)},
    {...request,retireSketch:{eventId:'retire.wrong',featureId:'sketch.guard'}}
  ];
  for(const bad of badRequests){
    assert.throws(()=>reconfigureCompoundPockets(history,bad,services));
    assert.equal(history.document.revision,oldRevision);
    assert.equal(get(history,'cut.guard.relief').payload.sourceSketchId,'sketch.relief');
    assert.equal(get(history,'cut.backer.relief').payload.throughAll,true);
  }

  const result=reconfigureCompoundPockets(history,request,services);
  assert.equal(result.kind,'committed');
  assert.equal(result.history.document.revision,oldRevision+5);
  assert.equal(result.history.undoStack.length,history.undoStack.length+1);
  assert.equal(result.undoFramesAdded,1);
  assert.deepEqual(result.editedCutIds,
    ['cut.guard.relief','cut.backer.relief']);
  assert.equal(result.retiredSketchId,'sketch.relief');
  assert.equal(get(result.history,'sketch.relief'),undefined);
  for(const e of request.edits){
    const cut=get(result.history,e.cutFeatureId);
    assert.equal(cut.payload.targetBodyId,e.targetBodyId);
    assert.equal(cut.payload.sourceSketchId,e.sourceSketchId);
    assert.equal(cut.payload.profileCandidateId,e.profileCandidateId);
    assert.ok(!cut.dependsOn.includes('sketch.relief'));
    assert.ok(result.invalidation.invalidatedFeatureIds.includes(e.cutFeatureId));
  }
  assert.equal(get(result.history,'cut.guard.relief').payload.throughAll,true);
  assert.equal(Object.hasOwn(get(result.history,'cut.guard.relief').payload,
    'depthMm'),false);
  assert.equal(get(result.history,'cut.backer.relief').payload.throughAll,false);
  assert.equal(get(result.history,'cut.backer.relief').payload.depthMm,2.5);
  assert.ok(!result.invalidation.invalidatedFeatureIds.includes('extrude.shim'));
  assert.deepEqual(result.cuts.map(x=>x.status),
    ['pending_exact_provider','pending_exact_provider']);

  const undo=runtime.undo(result.history,[
    'undo.backer.extent','undo.guard.extent','undo.relief.retire',
    'undo.backer.source','undo.guard.source'
  ]);
  assert.ok(get(undo,'sketch.relief'));
  assert.equal(get(undo,'cut.guard.relief').payload.sourceSketchId,'sketch.relief');
  assert.equal(get(undo,'cut.guard.relief').payload.depthMm,3);
  assert.equal(get(undo,'cut.backer.relief').payload.throughAll,true);
  const redo=runtime.redo(undo,[
    'redo.guard.source','redo.backer.source','redo.relief.retire',
    'redo.guard.extent','redo.backer.extent'
  ]);
  assert.equal(get(redo,'sketch.relief'),undefined);
  assert.equal(get(redo,'cut.backer.relief').payload.depthMm,2.5);
  history=runtime.reopen(runtime.save(redo));
  assert.equal(get(history,'cut.guard.relief').payload.sourceSketchId,
    'sketch.compound.relief');

  const thickened=editExtrudeThickness(history,{
    eventId:'thicken.compound.guard',featureId:'extrude.guard',
    expectedRevision:history.document.revision,thicknessMm:14},services);
  assert.ok(thickened.invalidation.invalidatedFeatureIds.includes('cut.guard.relief'));
  assert.ok(!thickened.invalidation.invalidatedFeatureIds.includes('cut.backer.relief'));
  assert.ok(!thickened.invalidation.invalidatedFeatureIds.includes('extrude.shim'));
  const existing=get(thickened.history,'sketch.compound.relief');
  const resized=polygon('compound.relief',
    [[14,5],[33,5],[33,15],[14,15]]);
  const changed=runtime.commit(thickened.history,[{
    eventId:'resize.compound.relief',type:'feature.edit',
    featureId:'sketch.compound.relief',
    patch:{payload:{...existing.payload,sketch:resized}}
  }],thickened.history.document.revision);
  const affected=runtime.diff(thickened.history,changed).invalidatedFeatureIds;
  assert.ok(affected.includes('cut.guard.relief'));
  assert.ok(affected.includes('cut.backer.relief'));
  assert.ok(!affected.includes('extrude.shim'));
  history=runtime.reopen(runtime.save(changed));
  assert.equal(get(history,'extrude.guard').payload.thicknessMm,14);
  assert.equal(get(history,'extrude.shim').payload.thicknessMm,3);
  assert.equal(get(history,'cut.backer.relief').payload.depthMm,2.5);
  return {
    consumer:'real_SKETCH_INTENT_RUNTIME',
    assembly:'L-guard, backing rail and independent shim',
    selectedCutIds:result.editedCutIds,
    newExtents:result.cuts.map(x=>x.extent),
    retiredSketchId:result.retiredSketchId,
    undoFrames:result.undoFramesAdded,
    undoRedoArchive:'passed',invalidTargets:'rejected_before_commit',
    depthEditedMm:14,unchangedShimMm:3,
    sketchInvalidation:affected,
    statuses:result.cuts.map(x=>x.status),
    nativeBrep:'not_executed',step:'not_executed',
    exactAuthority:false,independentInteroperability:false
  };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  console.log(JSON.stringify(runDemo(),null,2));
