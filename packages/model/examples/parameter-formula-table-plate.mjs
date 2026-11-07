/**
 * Real INTENT + solved SKETCH + RUNTIME public-contract example.
 * Run: node --experimental-strip-types packages/model/examples/parameter-formula-table-plate.mjs
 * Analytic/model authority only: no new OCCT8/STEP or browser claim.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import { createWorkflowRuntime } from '@intuit3d/workflow-runtime';
import {
  PARAMETER_FORMULA_TABLE_FORMAT,
  previewParameterFormulaTableEdit, commitUndoableParameterFormulaTableEdit,
} from '@intuit3d/model/parameter-formula-table';
import { formatParameterFormula } from '@intuit3d/model/parameter-formula';
import { parameterSheetRequest, inspectParameterSheet, previewParameterSheetEdit } from '@intuit3d/model/parameter-sheet';

const runtime = createWorkflowRuntime({
  model, transactions, bindings, dimensions, archive, sketch, discovery,
});
const create = (eventId, feature) => ({ eventId, type:'feature.create', feature });
const literal = value => ({ op:'literal',value,unit:'mm' });
const ref = featureId => ({ op:'ref',featureId });
const observed = (report,id) => report.features.find(row=>row.featureId===id);
const feature = (document,id) => model.featuresOf(document).find(row=>row.id===id);

export function runParameterFormulaTablePlate() {
  let h=transactions.startUndoHistory(model.newProject('demo.formula.table.plate'));
  h=runtime.commit(h,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    create('create.extrude',{id:'extrude.plate',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.cut',{id:'cut.holes',kind:'cut',
      dependsOn:['extrude.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate',
        holeOffsetMm:16}}),
    create('create.spacer',{id:'extrude.spacer',kind:'extrude',
      dependsOn:[],writeTargets:['body.spacer'],payload:{thicknessMm:3}}),
    ...[
      ['parameter.thickness','plateThickness',8],
      ['parameter.offset','holeOffset',16],
      ['parameter.allowance','holeAllowance',4],
    ].map(([id,name,value])=>create('create.'+id,{id,kind:'parameter',
      dependsOn:[],writeTargets:[],payload:{parameter:{
        name,unit:'mm',expression:literal(value),
      }}})),
  ]);
  h=runtime.editDimensions(h,{
    format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,version:1,
    expectedRevision:h.document.revision,admission:'require_admissible',
    edits:[
      {eventId:'bind.thickness',featureId:'extrude.plate',field:'thicknessMm',
        binding:{unit:'mm',expression:ref('parameter.thickness')}},
      {eventId:'bind.offset',featureId:'cut.holes',field:'holeOffsetMm',
        binding:{unit:'mm',expression:ref('parameter.offset')}},
    ],
  });
  assert.equal(observed(runtime.inspect(h),'extrude.plate').thicknessMm,8);
  const req={
    format:PARAMETER_FORMULA_TABLE_FORMAT,version:1,
    expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
    admission:'require_admissible',
    rows:[
      {eventId:'edit.web',featureId:'parameter.thickness',
        name:'webThickness',formula:'holePitch - margin'},
      {eventId:'edit.pitch',featureId:'parameter.offset',
        name:'holePitch',formula:'20'},
      {eventId:'edit.margin',featureId:'parameter.allowance',
        name:'margin',formula:'8'},
    ],
  };
  const sheetBefore=inspectParameterSheet(h.document,parameterSheetRequest(h.document));
  const sheetEdit=previewParameterSheetEdit(h.document,req);
  const preview=previewParameterFormulaTableEdit(h.document,req);
  assert.equal(sheetBefore.rows.find(r=>r.featureId==='parameter.thickness').value,8);
  assert.equal(sheetEdit.after.rows.find(r=>r.featureId==='parameter.thickness').value,12);
  assert.ok(sheetEdit.invalidatedFeatureIds.includes('cut.holes'));
  assert.ok(sheetEdit.unaffectedReadyFeatureIds.includes('extrude.spacer'));
  assert.equal(sheetEdit.exactGeometryAuthority,false);
  const edited=commitUndoableParameterFormulaTableEdit(h,req);
  assert.equal(edited.undoStack.length,h.undoStack.length+1);
  assert.equal(edited.undoStack.at(-1).length,3);
  const report=runtime.inspect(edited);
  assert.equal(observed(report,'extrude.plate').thicknessMm,12);
  assert.equal(observed(report,'cut.holes').status,'pending_exact_provider');
  const resolved=bindings.evaluateDimensionBindingPlan(model.planProject(edited.document));
  assert.equal(resolved.featureGates.find(g=>g.featureId==='cut.holes')
    .resolvedPayload.holeOffsetMm,20);
  assert.deepEqual(preview.formulaReferences[0].referencedParameterIds,
    ['parameter.offset','parameter.allowance']);
  assert.equal(formatParameterFormula(edited.document,'parameter.thickness',
    feature(edited.document,'parameter.thickness').payload.parameter.expression),
    '(holePitch - margin)');
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('extrude.plate'));
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('cut.holes'));
  assert.ok(preview.invalidation.unchangedReady.includes('extrude.spacer'));
  const saved=runtime.save(edited);
  const reopened=runtime.reopen(saved);
  const reopenedSheet=inspectParameterSheet(reopened.document,
    parameterSheetRequest(reopened.document));
  assert.equal(reopenedSheet.rows.find(r=>r.featureId==='parameter.thickness').formulaText,
    '(holePitch - margin)');
  const undone=runtime.undo(reopened,['undo.web','undo.pitch','undo.margin']);
  assert.equal(observed(runtime.inspect(undone),'extrude.plate').thicknessMm,8);
  const redone=runtime.redo(undone,['redo.web','redo.pitch','redo.margin']);
  assert.equal(observed(runtime.inspect(redone),'extrude.plate').thicknessMm,12);
  assert.equal(feature(redone.document,'cut.holes').payload.targetBodyId,'body.plate');
  return {
    thicknessBeforeMm:8,thicknessAfterMm:12,
    holePitchBeforeMm:16,holePitchAfterMm:20,
    renamed:['webThickness','holePitch','margin'],
    invalidated:preview.invalidation.invalidatedFeatureIds,
    unchanged:preview.invalidation.unchangedReady,
    oneUndoFrame:true,archiveUndoRedo:true,
    bodyId:'body.plate',nativeExact:false,independentSTEP:false,
  };
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(runParameterFormulaTablePlate(),null,2)+'\n');
}
