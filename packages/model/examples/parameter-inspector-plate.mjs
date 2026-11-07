/**
 * Actual public-package INTENT + SKETCH + RUNTIME consumer demonstration.
 * Execute from repository root:
 *   node --experimental-strip-types packages/model/examples/parameter-inspector-plate.mjs
 *
 * This is authoritative semantic/analytic evidence, NOT native B-rep/STEP.
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
  PARAMETER_INSPECTOR_FORMAT, commitUndoableParameterInspectorEdit,
} from '@intuit3d/model/parameter-inspector';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const feature=(report,id)=>report.features.find(x=>x.featureId===id);

export function runParameterInspectorPlate(){
  let history=transactions.startUndoHistory(model.newProject('demo.parameter.inspector.plate'));
  history=runtime.commit(history,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',
      dependsOn:[],writeTargets:[],
      payload:{sketch:sketch.plateSketchFixture()}}),
    create('create.extrude',{id:'extrude.plate',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.holes',{id:'cut.holes',kind:'cut',
      dependsOn:['extrude.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
    create('create.parameter',{id:'parameter.thickness',kind:'parameter',
      dependsOn:[],writeTargets:[],payload:{parameter:{
        name:'thickness',unit:'mm',expression:{op:'literal',value:8,unit:'mm'},
      }}}),
  ]);
  history=runtime.editDimensions(history,{
    format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,version:1,
    expectedRevision:history.document.revision,admission:'require_admissible',
    edits:[{eventId:'bind.thickness',featureId:'extrude.plate',
      field:'thicknessMm',binding:{unit:'mm',
        expression:{op:'ref',featureId:'parameter.thickness'}}}],
  });
  const before=runtime.inspect(history);
  assert.equal(feature(before,'extrude.plate').thicknessMm,8);
  const edited=commitUndoableParameterInspectorEdit(history,{
    format:PARAMETER_INSPECTOR_FORMAT,version:1,
    eventId:'edit.thickness.and.name',featureId:'parameter.thickness',
    expectedProjectId:history.document.projectId,
    expectedRevision:history.document.revision,
    name:'plateThickness',
    expression:{op:'literal',value:12,unit:'mm'},
    admission:'require_admissible',
  });
  const after=runtime.inspect(edited);
  assert.equal(feature(after,'extrude.plate').thicknessMm,12);
  assert.equal(feature(after,'cut.holes').status,'pending_exact_provider');
  assert.equal(after.exactGeometryAvailable,false);
  const changed=runtime.diff(history,edited);
  assert.deepEqual(changed.invalidatedFeatureIds,
    ['extrude.plate','cut.holes','parameter.thickness']);
  const bytes=runtime.save(edited);
  const reopened=runtime.reopen(bytes);
  const undone=runtime.undo(reopened,['undo.parameter.inspector']);
  assert.equal(feature(runtime.inspect(undone),'extrude.plate').thicknessMm,8);
  const redone=runtime.redo(undone,['redo.parameter.inspector']);
  assert.equal(feature(runtime.inspect(redone),'extrude.plate').thicknessMm,12);
  const parameter=model.featuresOf(redone.document).find(f=>f.id==='parameter.thickness');
  assert.equal(parameter.payload.parameter.name,'plateThickness');
  return {
    beforeThicknessMm:8,afterThicknessMm:12,
    retainedParameterId:parameter.id,parameterLabel:parameter.payload.parameter.name,
    invalidated:changed.invalidatedFeatureIds,
    unaffectedSketch:feature(after,'sketch.plate').status,
    cutStatus:feature(after,'cut.holes').status,
    reopened:true,undoRedo:true,exactGeometryAvailable:false,
    independentInteroperability:false,
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  process.stdout.write(JSON.stringify(runParameterInspectorPlate(),null,2)+'\n');
}
