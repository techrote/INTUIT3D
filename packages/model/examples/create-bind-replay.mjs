/**
 * Runnable consumer proof:
 * node --experimental-strip-types packages/model/examples/create-bind-replay.mjs
 *
 * Uses accepted INTENT/SKETCH/RUNTIME contracts; preview and pending cut are
 * NOT an exact B-rep, STEP publication, or a native interchange test.
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
  PARAMETER_AUTHORING_FORMAT, commitUndoableParameterAuthoring,
  previewParameterAuthoring,
} from '@intuit3d/model/parameter-authoring';
import {commitUndoableParameterEdit} from '@intuit3d/model/parameter-edit';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const state=(report,id)=>report.features.find(f=>f.featureId===id);
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});

export function runCreateBindReplay() {
  let history=transactions.startUndoHistory(model.newProject('demo.create.bind.replay'));
  history=runtime.commit(history,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    create('create.extrude',{id:'extrude.plate',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.cut',{id:'cut.holes',kind:'cut',
      dependsOn:['extrude.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
    create('create.note',{id:'note.title',kind:'annotation',dependsOn:[],
      writeTargets:[],payload:{title:'two-hole plate'}}),
  ]);
  const authored=requestFor(history.document.revision);
  const proposal=previewParameterAuthoring(history.document,authored);
  assert.deepEqual(proposal.invalidation.unchangedReady,['sketch.plate','note.title']);
  const bound=commitUndoableParameterAuthoring(history,authored);
  assert.equal(state(runtime.inspect(bound),'extrude.plate').thicknessMm,8);

  const edited=commitUndoableParameterEdit(bound,{
    format:'intuit3d.parameter-edit',version:1,
    eventId:'edit.thickness.to12',featureId:'parameter.thickness',
    expectedRevision:bound.document.revision,
    expression:{op:'literal',value:12,unit:'mm'},
    admission:'require_admissible',
  });
  const report=runtime.inspect(edited);
  const diff=runtime.diff(bound,edited);
  assert.equal(state(report,'sketch.plate').status,'analytic_profile_only');
  assert.equal(state(report,'extrude.plate').status,'preview_only');
  assert.equal(state(report,'extrude.plate').thicknessMm,12);
  assert.equal(state(report,'cut.holes').status,'pending_exact_provider');
  assert.deepEqual(diff.invalidatedFeatureIds,
    ['extrude.plate','cut.holes','parameter.thickness']);

  const serialized=runtime.save(edited);
  const reopened=runtime.reopen(serialized);
  assert.equal(state(runtime.inspect(reopened),'extrude.plate').thicknessMm,12);
  const undoParameter=runtime.undo(reopened,['undo.parameter.change']);
  assert.equal(state(runtime.inspect(undoParameter),'extrude.plate').thicknessMm,8);
  const redoParameter=runtime.redo(undoParameter,['redo.parameter.change']);
  assert.equal(state(runtime.inspect(redoParameter),'extrude.plate').thicknessMm,12);
  assert.equal(runtime.save(reopened),serialized);

  return {
    projectId:report.projectId,
    sourceRevision:history.document.revision,
    authoredRevision:bound.document.revision,
    editedRevision:edited.document.revision,
    parameterId:'parameter.thickness',
    parameterName:'thickness',
    fromThicknessMm:8,toThicknessMm:12,
    authoritativeAuthoredOrder:report.authoredOrder,
    dependencyEvaluationOrder:report.executableOrder,
    invalidatedAfterParameterEdit:diff.invalidatedFeatureIds,
    unaffectedSketch:diff.unchangedFeatureIds.includes('sketch.plate'),
    exactGeometryAvailable:report.exactGeometryAvailable,
    cutStatus:state(report,'cut.holes').status,
    archiveRoundtrip:true,undoRedo:true,
  };
}
function requestFor(expectedRevision) {
  return {
    format:PARAMETER_AUTHORING_FORMAT,version:1,
    expectedRevision,admission:'require_admissible',
    parameter:{
      eventId:'create.parameter.thickness',featureId:'parameter.thickness',
      name:'thickness',unit:'mm',
      expression:{op:'literal',value:8,unit:'mm'},
    },
    bindings:[
      {eventId:'bind.extrude.thickness',featureId:'extrude.plate',
        field:'thicknessMm'},
    ],
  };
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(runCreateBindReplay(),null,2)+'\n');
}
