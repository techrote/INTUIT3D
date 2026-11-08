/**
 * Real semantic INTENT -> solved SKETCH -> RUNTIME plate/extrude/cut flow.
 * Two spreadsheet windows edit concurrently. The stale formula would resolve
 * to a DIFFERENT scalar thickness after B changes its upstream parameter.
 * A must examine/acknowledge the exact conflict before one undoable commit.
 * This does not attest physical OCCT B-rep or independent STEP exactness.
 *
 * node --experimental-strip-types packages/model/examples/parameter-sheet-conflict-plate.mjs
 */
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {
  PARAMETER_FORMULA_TABLE_FORMAT,commitUndoableParameterFormulaTableEdit,
} from '@intuit3d/model/parameter-formula-table';
import {rebaseParameterSheetEdit} from '@intuit3d/model/parameter-sheet-rebase';
import {
  PARAMETER_SHEET_RESOLUTION_FORMAT,resolveParameterSheetConflict,
} from '@intuit3d/model/parameter-sheet-resolution';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const literal=value=>({op:'literal',value,unit:'mm'});
const ref=featureId=>({op:'ref',featureId});
const observed=(state,id)=>runtime.inspect(state).features.find(row=>row.featureId===id);
function edit(doc,eventId,featureId,formula) {
  return {format:PARAMETER_FORMULA_TABLE_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    admission:'require_admissible',rows:[{eventId,featureId,formula}]};
}

export function runParameterSheetConflictPlate() {
  let base=transactions.startUndoHistory(model.newProject('demo.parameter.sheet.conflict'));
  base=runtime.commit(base,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',
      dependsOn:[],writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    create('create.extrude',{id:'extrude.plate',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.cut',{id:'cut.holes',kind:'cut',
      dependsOn:['extrude.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate',
        holeOffsetMm:16}}),
    create('create.spacer',{id:'extrude.spacer',kind:'extrude',
      dependsOn:[],writeTargets:['body.spacer'],payload:{thicknessMm:3}}),
    create('create.thickness',{id:'parameter.thickness',kind:'parameter',
      dependsOn:[],writeTargets:[],payload:{parameter:{
        name:'plateThickness',unit:'mm',expression:literal(8)}}}),
    create('create.offset',{id:'parameter.offset',kind:'parameter',
      dependsOn:[],writeTargets:[],payload:{parameter:{
        name:'holeOffset',unit:'mm',expression:literal(16)}}}),
  ]);
  base=runtime.editDimensions(base,{
    format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,version:1,
    expectedRevision:base.document.revision,admission:'require_admissible',
    edits:[
      {eventId:'bind.thickness',featureId:'extrude.plate',field:'thicknessMm',
        binding:{unit:'mm',expression:ref('parameter.thickness')}},
      {eventId:'bind.offset',featureId:'cut.holes',field:'holeOffsetMm',
        binding:{unit:'mm',expression:ref('parameter.offset')}},
    ],
  });

  // A's draft value is 12 mm at base, but B's edit changes the referenced
  // holeOffset 16 -> 20 mm, so the same formula would become 16 mm.
  const draft=edit(base.document,'draft.thickness','parameter.thickness',
    'holeOffset - 4 mm');
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,'edit.offset','parameter.offset','20'));
  const first=rebaseParameterSheetEdit(base.document,current.document,draft,
    current.document.revision);
  assert.equal(first.status,'conflicted');
  assert.equal(first.conflicts[0].code,'referenced_parameter_changed');

  // Only after explicit review of the exact current conflict is the candidate
  // admitted for display. The UI must still obtain final commit confirmation.
  const resolved=resolveParameterSheetConflict(base.document,current.document,
    draft,{format:PARAMETER_SHEET_RESOLUTION_FORMAT,version:1,
      expectedProjectId:base.document.projectId,
      expectedBaseRevision:base.document.revision,
      expectedCurrentRevision:current.document.revision,
      approvals:[{code:'referenced_parameter_changed',
        featureId:'parameter.thickness',relatedId:'parameter.offset'}],
      eventReplacements:[]});
  assert.equal(resolved.status,'ready');
  assert.equal(resolved.valueComparisons[0].baseDraftValue,12);
  assert.equal(resolved.valueComparisons[0].currentDraftValue,16);
  assert.ok(resolved.preview.invalidation.invalidatedFeatureIds.includes('extrude.plate'));
  assert.ok(resolved.preview.invalidation.invalidatedFeatureIds.includes('cut.holes'));
  assert.ok(resolved.preview.invalidation.unchangedReady.includes('extrude.spacer'));
  const applied=commitUndoableParameterFormulaTableEdit(current,resolved.resolvedRequest);
  assert.equal(observed(applied,'extrude.plate').thicknessMm,16);
  assert.equal(observed(applied,'cut.holes').status,'pending_exact_provider');
  assert.equal(bindings.evaluateDimensionBindingPlan(model.planProject(applied.document))
    .featureGates.find(row=>row.featureId==='cut.holes')
    .resolvedPayload.holeOffsetMm,20);
  assert.equal(model.featuresOf(applied.document).find(f=>f.id==='cut.holes')
    .payload.targetBodyId,'body.plate');
  const reopened=runtime.reopen(runtime.save(applied));
  const undone=runtime.undo(reopened,['undo.conflict']);
  assert.equal(observed(undone,'extrude.plate').thicknessMm,8);
  const redone=runtime.redo(undone,['redo.conflict']);
  assert.equal(observed(redone,'extrude.plate').thicknessMm,16);
  return {
    draftThicknessAtBaseMm:12,draftThicknessAfterConcurrentChangeMm:16,
    changedHoleOffsetMm:20,bodyId:'body.plate',
    invalidated:resolved.preview.invalidation.invalidatedFeatureIds,
    unaffected:resolved.preview.invalidation.unchangedReady,
    archiveUndoRedo:true,nativeExact:false,independentSTEP:false,
  };
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(runParameterSheetConflictPlate(),null,2)+'\n');
}
