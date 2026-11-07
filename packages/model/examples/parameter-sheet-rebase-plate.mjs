/**
 * Typed INTENT → solved SKETCH → RUNTIME plate/cut workflow, rebasing a stale
 * spreadsheet edit across a second saved parameter transaction. The workflow
 * is semantically executable but is NOT physical OCCT8 or independent STEP.
 *
 * node --experimental-strip-types packages/model/examples/parameter-sheet-rebase-plate.mjs
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
  PARAMETER_FORMULA_TABLE_FORMAT, commitUndoableParameterFormulaTableEdit,
} from '@intuit3d/model/parameter-formula-table';
import { rebaseParameterSheetEdit } from '@intuit3d/model/parameter-sheet-rebase';

const runtime = createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const literal=value=>({op:'literal',value,unit:'mm'});
const ref=featureId=>({op:'ref',featureId});
const observed=(report,id)=>report.features.find(row=>row.featureId===id);

function request(doc,eventId,featureId,formula) {
  return {format:PARAMETER_FORMULA_TABLE_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    admission:'require_admissible',
    rows:[{eventId,featureId,formula}]};
}

export function runParameterSheetRebasePlate() {
  let base=transactions.startUndoHistory(
    model.newProject('demo.parameter.sheet.rebase'));
  base=runtime.commit(base,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',
      dependsOn:[],writeTargets:[],
      payload:{sketch:sketch.plateSketchFixture()}}),
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
  assert.equal(observed(runtime.inspect(base),'extrude.plate').thicknessMm,8);

  // Window A drafts a thickness change; Window B publishes an independent
  // hole offset edit before A can Save. A's stale original request is never
  // committed directly. The model proves the single-row draft is rebase-safe.
  const staleThickness=request(base.document,'edit.thickness',
    'parameter.thickness','12');
  const current=commitUndoableParameterFormulaTableEdit(base,
    request(base.document,'edit.offset','parameter.offset','20'));
  const reconciliation=rebaseParameterSheetEdit(base.document,
    current.document,staleThickness,current.document.revision);
  assert.equal(reconciliation.status,'ready');
  assert.ok(reconciliation.preview.invalidation.invalidatedFeatureIds
    .includes('extrude.plate'));
  assert.ok(reconciliation.preview.invalidation.invalidatedFeatureIds
    .includes('cut.holes'));
  assert.ok(reconciliation.preview.invalidation.unchangedReady
    .includes('extrude.spacer'));

  const applied=commitUndoableParameterFormulaTableEdit(
    current,reconciliation.rebasedRequest);
  assert.equal(observed(runtime.inspect(applied),'extrude.plate').thicknessMm,12);
  assert.equal(observed(runtime.inspect(applied),'cut.holes').status,
    'pending_exact_provider');
  const dimensionPlan=bindings.evaluateDimensionBindingPlan(
    model.planProject(applied.document));
  assert.equal(dimensionPlan.featureGates.find(row=>
    row.featureId==='cut.holes').resolvedPayload.holeOffsetMm,20);
  assert.equal(model.featuresOf(applied.document).find(row=>
    row.id==='cut.holes').payload.targetBodyId,'body.plate');

  const reopened=runtime.reopen(runtime.save(applied));
  const undone=runtime.undo(reopened,['undo.thickness']);
  assert.equal(observed(runtime.inspect(undone),'extrude.plate').thicknessMm,8);
  const redone=runtime.redo(undone,['redo.thickness']);
  assert.equal(observed(runtime.inspect(redone),'extrude.plate').thicknessMm,12);
  return {
    thicknessBeforeMm:8,thicknessAfterMm:12,
    holeOffsetBeforeMm:16,holeOffsetAfterMm:20,
    unchangedBodyId:'body.plate',
    invalidated:reconciliation.preview.invalidation.invalidatedFeatureIds,
    unaffected:reconciliation.preview.invalidation.unchangedReady,
    archiveUndoRedo:true,nativeExact:false,independentSTEP:false,
  };
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(runParameterSheetRebasePlate(),null,2)+'\n');
}
