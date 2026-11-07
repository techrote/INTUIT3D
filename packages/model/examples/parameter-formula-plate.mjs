/**
 * Public INTENT/SKETCH/RUNTIME formula input: plate, holes, cut, edit, replay.
 * Run: node --experimental-strip-types packages/model/examples/parameter-formula-plate.mjs
 * Semantic + solved-analytic only, NOT pinned native OCCT8 or independent STEP.
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
  PARAMETER_FORMULA_FORMAT, previewParameterFormulaEdit,
  commitUndoableParameterFormulaEdit, formatParameterFormula,
} from '@intuit3d/model/parameter-formula';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const ref=featureId=>({op:'ref',featureId});
const scalar=value=>({op:'literal',value,unit:'mm'});
const row=(report,id)=>report.features.find(entry=>entry.featureId===id);

export function runParameterFormulaPlate() {
  let session=transactions.startUndoHistory(model.newProject('demo.parameter.formula.plate'));
  session=runtime.commit(session,[
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
    create('create.thickness',{id:'parameter.thickness',kind:'parameter',
      dependsOn:[],writeTargets:[],payload:{parameter:{
        name:'plateThickness',unit:'mm',expression:scalar(8)}}}),
    create('create.offset',{id:'parameter.offset',kind:'parameter',
      dependsOn:[],writeTargets:[],payload:{parameter:{
        name:'holeOffset',unit:'mm',expression:scalar(16)}}}),
  ]);
  session=runtime.editDimensions(session,{
    format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,version:1,
    expectedRevision:session.document.revision,admission:'require_admissible',
    edits:[
      {eventId:'bind.thickness',featureId:'extrude.plate',
        field:'thicknessMm',binding:{unit:'mm',expression:ref('parameter.thickness')}},
      {eventId:'bind.offset',featureId:'cut.holes',field:'holeOffsetMm',
        binding:{unit:'mm',expression:ref('parameter.offset')}},
    ],
  });
  const before=runtime.inspect(session);
  assert.equal(row(before,'extrude.plate').thicknessMm,8);
  const request={
    format:PARAMETER_FORMULA_FORMAT,version:1,
    expectedProjectId:session.document.projectId,
    expectedRevision:session.document.revision,
    eventId:'formula.change.thickness',featureId:'parameter.thickness',
    formula:'holeOffset - 4 mm',admission:'require_admissible',
  };
  const preview=previewParameterFormulaEdit(session.document,request);
  const edited=commitUndoableParameterFormulaEdit(session,request);
  const after=runtime.inspect(edited);
  const gates=bindings.evaluateDimensionBindingPlan(model.planProject(edited.document));
  assert.equal(row(after,'extrude.plate').thicknessMm,12);
  assert.equal(gates.featureGates.find(g=>g.featureId==='cut.holes')
    .resolvedPayload.holeOffsetMm,16);
  assert.equal(row(after,'cut.holes').status,'pending_exact_provider');
  assert.equal(after.exactGeometryAvailable,false);
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('extrude.plate'));
  assert.ok(preview.invalidation.unchangedReady.includes('extrude.spacer'));
  assert.equal(formatParameterFormula(edited.document,'parameter.thickness',
    model.featuresOf(edited.document)
      .find(f=>f.id==='parameter.thickness').payload.parameter.expression),
    '(holeOffset - 4 mm)');
  const saved=runtime.save(edited);
  const reopened=runtime.reopen(saved);
  const undone=runtime.undo(reopened,['undo.formula']);
  assert.equal(row(runtime.inspect(undone),'extrude.plate').thicknessMm,8);
  const redone=runtime.redo(undone,['redo.formula']);
  assert.equal(row(runtime.inspect(redone),'extrude.plate').thicknessMm,12);
  assert.equal(model.featuresOf(redone.document).find(f=>f.id==='cut.holes')
    .payload.targetBodyId,'body.plate');
  return {
    thicknessBeforeMm:8,thicknessAfterMm:12,formula:'holeOffset - 4 mm',
    invalidated:preview.invalidation.invalidatedFeatureIds,
    unchanged:preview.invalidation.unchangedReady,
    extrudeId:'extrude.plate',bodyId:'body.plate',archiveUndoRedo:true,
    nativeExact:false,independentSTEP:false,
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(runParameterFormulaPlate(),null,2)+'\n');
}
