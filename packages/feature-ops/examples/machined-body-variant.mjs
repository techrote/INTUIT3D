/**
 * Real INTENT/SKETCH/RUNTIME assembly: one user action creates a new
 * extruded rail and two independently machined pockets as ONE undo frame.
 * This does not execute native C++ Booleans or STEP.
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT}
  from '@intuit3d/feature-ops/ordered-cut/v1';
import {editExtrudeThickness} from '@intuit3d/feature-ops';
import {MACHINED_VARIANT_FORMAT,inspectMachinedBodyVariant,
  createMachinedBodyVariant}
  from '@intuit3d/feature-ops/machined-body-variant/v1';
import {makeAssembly,polygon,runtime,services} from './coordinated-pockets.mjs';
const get=(h,id)=>model.featuresOf(h.document).find(f=>f.id===id);
const candidate=sketch=>{
  const p=discovery.discoverPlateProfiles(sketch);
  assert.equal(p.status,'ready');
  assert.equal(p.candidates.length,1);
  return p.candidates[0].id;
};
function addSketch(h,id,sketch){
  return runtime.commit(h,[{
    eventId:'make.'+id,type:'feature.create',
    feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch}}
  }],h.document.revision);
}
function addGuardCut(h,id,sketchId,profileId,after,extent){
  return appendOrderedProfileCut(h,{
    format:ORDERED_CUT_FORMAT,version:1,
    expectedProjectId:h.document.projectId,
    expectedRevision:h.document.revision,units:'mm',frame:'local_xy',
    eventId:'make.'+id,targetBodyId:'body.guard',cutFeatureId:id,
    afterBodyWriterId:after,sourceSketchId:sketchId,
    profileCandidateId:profileId,extent
  },services).history;
}
const selection=(h,prefix,sourceCuts,baseSketchId,baseProfileCandidateId)=>({
  format:MACHINED_VARIANT_FORMAT,version:1,
  expectedProjectId:h.document.projectId,
  expectedRevision:h.document.revision,
  expectedDocumentFence:model.serializeProject(h.document),
  units:'mm',frame:'local_xy',sourceBodyId:'body.guard',
  sourceCutFeatureIds:sourceCuts,
  baseSketchId,baseProfileCandidateId,depthMm:7,
  newExtrudeFeatureId:'extrude.'+prefix,newBodyId:'body.'+prefix,
  newExtrudeEventId:'make.extrude.'+prefix
});
export function runMachinedBodyVariant(){
  let {history,candidates}=makeAssembly();
  const originalVent=polygon('originalvent',[[72,5],[85,5],[85,14],[72,14]]);
  const variantBase=polygon('variantbase',[[0,0],[95,0],[95,30],[0,30]]);
  const variantRelief=polygon('variantrelief',[[8,7],[22,7],[22,17],[8,17]]);
  const variantVent=polygon('variantvent',[[66,8],[80,8],[80,19],[66,19]]);
  for(const [id,sketch] of [
    ['sketch.original.vent',originalVent],
    ['sketch.variant.base',variantBase],
    ['sketch.variant.relief',variantRelief],
    ['sketch.variant.vent',variantVent]
  ])history=addSketch(history,id,sketch);
  history=addGuardCut(history,'cut.guard.relief','sketch.relief',
    candidates['sketch.relief'],'extrude.guard',{kind:'blind',depthMm:3});
  history=addGuardCut(history,'cut.guard.vent','sketch.original.vent',
    candidate(originalVent),'cut.guard.relief',{kind:'through_all'});
  const before=history,sourceCuts=['cut.guard.relief','cut.guard.vent'];
  const selected=selection(before,'variant.adapted',sourceCuts,
    'sketch.variant.base',candidate(variantBase));
  const preview=inspectMachinedBodyVariant(before,selected,services);
  assert.equal(preview.sourceCuts.length,2);
  const targetCuts=[
    {sourceCutFeatureId:sourceCuts[0],sourceSketchId:'sketch.variant.relief',
      profileCandidateId:candidate(variantRelief),extent:{kind:'blind',depthMm:4}},
    {sourceCutFeatureId:sourceCuts[1],sourceSketchId:'sketch.variant.vent',
      profileCandidateId:candidate(variantVent),extent:{kind:'through_all'}}
  ];
  const request={...selected,expectedSourceCuts:preview.sourceCuts,
    targetCuts,newCutFeatureIds:['cut.variant.relief','cut.variant.vent'],
    cutEventIds:['make.variant.relief','make.variant.vent']};
  const saved=model.serializeProject(before.document);
  const invalid=[
    {...request,expectedRevision:request.expectedRevision-1},
    {...request,expectedDocumentFence:request.expectedDocumentFence+' '},
    {...request,expectedProjectId:'other.project'},
    {...request,newBodyId:'body.guard'},
    {...request,newBodyId:'body.backer'},
    {...request,baseSketchId:'sketch.unknown'},
    {...request,baseProfileCandidateId:'cycle:invalid'},
    {...request,depthMm:-7},
    {...request,newExtrudeFeatureId:'extrude.guard'},
    {...request,newExtrudeEventId:'make.sketch.variant.base'},
    {...request,newCutFeatureIds:['cut.variant.relief','cut.variant.relief']},
    {...request,newCutFeatureIds:['cut.variant.relief','extrude.variant.adapted']},
    {...request,cutEventIds:['make.variant.relief','make.variant.relief']},
    {...request,sourceCutFeatureIds:[...sourceCuts].reverse()},
    {...request,expectedSourceCuts:[...preview.sourceCuts].reverse()},
    {...request,targetCuts:[...targetCuts].reverse()},
    {...request,targetCuts:[targetCuts[0],{...targetCuts[1],
      sourceSketchId:'sketch.unknown'}]},
    {...request,targetCuts:[targetCuts[0],{...targetCuts[1],
      profileCandidateId:'cycle:bogus'}]},
    {...request,targetCuts:[targetCuts[0],{...targetCuts[1],
      extent:{kind:'blind',depthMm:-2}}]},
    {...request,targetCuts:[targetCuts[0]]},
    {...request,frame:'world_xy'}
  ];
  for(const bad of invalid){
    assert.throws(()=>createMachinedBodyVariant(before,bad,services));
    assert.equal(model.serializeProject(before.document),saved);
  }
  const made=createMachinedBodyVariant(before,request,services);
  assert.equal(made.oneUndoFrame,true);
  assert.equal(made.history.undoStack.length,before.undoStack.length+1);
  assert.equal(made.history.document.revision,before.document.revision+3);
  assert.equal(made.sourceSketchSemantics,'explicit_per_cut_source_selection');
  assert.equal(get(made.history,'extrude.variant.adapted').payload.thicknessMm,7);
  assert.equal(get(made.history,'cut.variant.relief').payload.depthMm,4);
  assert.equal(get(made.history,'cut.variant.vent').payload.throughAll,true);
  assert.ok(!made.invalidation.invalidatedFeatureIds.includes('extrude.guard'));
  assert.ok(!made.invalidation.invalidatedFeatureIds.includes('extrude.shim'));
  assert.ok(made.invalidation.invalidatedFeatureIds.includes('cut.variant.vent'));
  const undo=runtime.undo(made.history,
    ['undo.variant.base','undo.variant.relief','undo.variant.vent']);
  assert.equal(get(undo,'extrude.variant.adapted'),undefined);
  assert.equal(get(undo,'cut.variant.vent'),undefined);
  const redo=runtime.redo(undo,
    ['redo.variant.base','redo.variant.relief','redo.variant.vent']);
  const reopened=runtime.reopen(runtime.save(redo));
  assert.equal(get(reopened,'cut.variant.relief').payload.depthMm,4);

  // A second variant proves that exact source profiles can deliberately be
  // shared rather than adapted, without losing the atomic body+recipe UX.
  const sharedSelection=selection(reopened,'variant.shared',sourceCuts,
    'sketch.backer',candidates['sketch.backer']);
  const sharedPreview=inspectMachinedBodyVariant(reopened,sharedSelection,services);
  const shared=createMachinedBodyVariant(reopened,{
    ...sharedSelection,expectedSourceCuts:sharedPreview.sourceCuts,
    targetCuts:sharedPreview.sourceCuts.map(x=>({...x,extent:{...x.extent}})),
    newCutFeatureIds:['cut.shared.relief','cut.shared.vent'],
    cutEventIds:['make.shared.relief','make.shared.vent']
  },services);
  assert.equal(shared.sourceSketchSemantics,'shared_source_profiles');
  assert.equal(shared.history.undoStack.length,reopened.undoStack.length+1);
  assert.equal(get(shared.history,'cut.shared.vent').payload.throughAll,true);
  const edited=editExtrudeThickness(shared.history,{
    eventId:'edit.guard.depth',featureId:'extrude.guard',
    expectedRevision:shared.history.document.revision,thicknessMm:14
  },services);
  const guardImpact=edited.invalidation.invalidatedFeatureIds;
  assert.ok(guardImpact.includes('cut.guard.vent'));
  assert.ok(!guardImpact.includes('cut.variant.vent'));
  assert.ok(!guardImpact.includes('cut.shared.vent'));
  const resized=polygon('variantvent',[[67,8],[77,8],[77,19],[67,19]]);
  const current=get(edited.history,'sketch.variant.vent');
  const updated=runtime.commit(edited.history,[{
    eventId:'edit.variant.vent',type:'feature.edit',featureId:'sketch.variant.vent',
    patch:{payload:{...current.payload,sketch:resized}}
  }],edited.history.document.revision);
  const variantImpact=runtime.diff(edited.history,updated).invalidatedFeatureIds;
  assert.ok(variantImpact.includes('cut.variant.vent'));
  assert.ok(!variantImpact.includes('cut.guard.vent'));
  assert.ok(!variantImpact.includes('cut.shared.vent'));
  assert.ok(!variantImpact.includes('extrude.shim'));
  const final=runtime.reopen(runtime.save(updated));
  assert.equal(get(final,'extrude.guard').payload.thicknessMm,14);
  assert.equal(get(final,'extrude.variant.adapted').payload.thicknessMm,7);
  assert.equal(get(final,'extrude.shim').payload.thicknessMm,3);
  return {kind:'real_INTENT_SKETCH_RUNTIME_machined_body_variant',
    createdVariantBodies:['body.variant.adapted','body.variant.shared'],
    machinedCutIds:made.copiedCuts.map(x=>x.cutFeatureId),
    machiningStatuses:made.copiedCuts.map(x=>x.status),
    atomicBodyAndTwoCuts:made.oneUndoFrame,
    negativeSelectionsRefused:invalid.length,
    undoRedoAndArchive:true,
    independentVariantSketchInvalidation:true,
    unchangedShimDepthMm:3,guardAfterRetrospectiveDepthMm:14,
    exactAuthority:false,nativeSTEP:'not_executed'};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  process.stdout.write(JSON.stringify(runMachinedBodyVariant(),null,2)+'\n');
