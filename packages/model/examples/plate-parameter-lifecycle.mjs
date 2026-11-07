/**
 * Executable consumer example:
 *   node --experimental-strip-types packages/model/examples/plate-parameter-lifecycle.mjs
 *
 * Real accepted INTENT + SKETCH + RUNTIME public contracts. No native B-rep,
 * Boolean or STEP is created; a cut must remain pending_exact_provider.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import { commitUndoableParameterEdit, PARAMETER_EDIT_FORMAT } from '@intuit3d/model/parameter-edit';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import { createWorkflowRuntime } from '@intuit3d/workflow-runtime';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const status=(report,id)=>report.features.find(feature=>feature.featureId===id);

export function runPlateParameterLifecycle() {
  const initial=transactions.startUndoHistory(model.newProject('demo.plate.holes.retrospective'));
  let history=runtime.commit(initial,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:sketch.plateSketchFixture()}}),
    create('create.extrude',{id:'extrude.plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.cut',{id:'cut.holes',kind:'cut',dependsOn:['extrude.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
    create('create.parameter',{id:'parameter.thickness',kind:'parameter',dependsOn:[],writeTargets:[],
      payload:{parameter:{name:'thickness',unit:'mm',
        expression:{op:'literal',value:8,unit:'mm'}}}}),
  ]);
  // Retrospective binding: authored feature chronology stays sketch/extrude/
  // cut/parameter; dependency order evaluates the parameter before extrusion.
  history=runtime.editDimensions(history,{
    format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,
    version:dimensions.DIMENSION_BATCH_EDIT_VERSION,
    expectedRevision:history.document.revision,admission:'require_admissible',
    edits:[{eventId:'bind.extrude.thickness',featureId:'extrude.plate',field:'thicknessMm',
      binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.thickness'}}}],
  });
  const before=runtime.inspect(history);
  assert.equal(status(before,'sketch.plate').status,'analytic_profile_only');
  assert.equal(status(before,'extrude.plate').status,'preview_only');
  assert.equal(status(before,'extrude.plate').thicknessMm,8);
  assert.equal(status(before,'cut.holes').status,'pending_exact_provider');
  assert.equal(before.exactGeometryAvailable,false);

  const edited=commitUndoableParameterEdit(history,{
    format:PARAMETER_EDIT_FORMAT,version:1,eventId:'edit.parameter.thickness',
    featureId:'parameter.thickness',expectedRevision:history.document.revision,
    expression:{op:'literal',value:12,unit:'mm'},admission:'require_admissible',
  });
  const after=runtime.inspect(edited);
  const diff=runtime.diff(history,edited);
  assert.equal(status(after,'extrude.plate').thicknessMm,12);
  assert.deepEqual(diff.changedFeatureIds,['parameter.thickness']);
  assert.deepEqual(diff.invalidatedFeatureIds,
    ['extrude.plate','cut.holes','parameter.thickness']);
  assert.equal(status(after,'cut.holes').status,'pending_exact_provider');
  assert.equal(after.exactGeometryAvailable,false);

  const serialized=runtime.save(edited);
  const reopened=runtime.reopen(serialized);
  assert.equal(runtime.save(reopened),serialized);
  assert.deepEqual(runtime.inspect(reopened),after);
  const undone=runtime.undo(reopened,['undo.parameter.thickness']);
  assert.equal(status(runtime.inspect(undone),'extrude.plate').thicknessMm,8);
  const redone=runtime.redo(undone,['redo.parameter.thickness']);
  assert.equal(status(runtime.inspect(redone),'extrude.plate').thicknessMm,12);
  assert.equal(redone.document.projectId,history.document.projectId);
  assert.deepEqual(model.planProject(redone.document).authoredOrder,
    ['sketch.plate','extrude.plate','cut.holes','parameter.thickness']);

  return {
    projectId:after.projectId,
    beforeRevision:before.revision,
    afterRevision:after.revision,
    authoredOrder:after.authoredOrder,
    evaluationOrder:after.executableOrder,
    initialThicknessMm:status(before,'extrude.plate').thicknessMm,
    editedThicknessMm:status(after,'extrude.plate').thicknessMm,
    invalidatedFeatureIds:diff.invalidatedFeatureIds,
    sketchStatus:status(after,'sketch.plate').status,
    extrudeStatus:status(after,'extrude.plate').status,
    cutStatus:status(after,'cut.holes').status,
    exactGeometryAvailable:after.exactGeometryAvailable,
    archiveBytes:Buffer.byteLength(serialized,'utf8'),
    replayVerified:true,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(runPlateParameterLifecycle(),null,2)+'\n');
}
