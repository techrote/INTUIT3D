/**
 * Runnable INTENT → SKETCH → RUNTIME inspector-value consumer:
 *   node --experimental-strip-types packages/model/examples/edit-inspector-dimension.mjs
 *
 * A numeric field bound to an earlier-authored parameter cannot be edited by
 * patching the old fallback number. This demonstration changes the source
 * parameter through the selected extrusion's inspector, rebuild-plans its
 * dependent hole cut, archives, undoes and redoes the exact journal command.
 * Sketch is real analytic 2D; B-rep/STEP remain pending.
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
  inspectDimensionValue,commitUndoableDimensionValueEdit,
  DIMENSION_VALUE_EDIT_FORMAT,
} from '@intuit3d/model/dimension-value-edit';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const state=(report,id)=>report.features.find(item=>item.featureId===id);

export function runInspectorDimensionEdit() {
  let history=transactions.startUndoHistory(model.newProject('demo.inspector.plate.holes'));
  history=runtime.commit(history,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:sketch.plateSketchFixture()}}),
    create('create.extrude',{id:'extrude.plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.cut',{id:'cut.holes',kind:'cut',dependsOn:['extrude.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
    create('create.parameter',{id:'parameter.thickness',kind:'parameter',dependsOn:[],
      writeTargets:[],payload:{parameter:{name:'thickness',unit:'mm',
        expression:{op:'literal',value:8,unit:'mm'}}}}),
  ]);
  history=runtime.editDimensions(history,{
    format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,
    version:dimensions.DIMENSION_BATCH_EDIT_VERSION,
    expectedRevision:history.document.revision,admission:'require_admissible',
    edits:[{eventId:'bind.thickness',featureId:'extrude.plate',field:'thicknessMm',
      binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.thickness'}}}],
  });
  const source=history;
  const before=runtime.inspect(source);
  const inspector=inspectDimensionValue(source.document,'extrude.plate','thicknessMm','mm');
  assert.equal(inspector.currentValue,8);
  assert.equal(inspector.availability,'literal_parameter');
  history=commitUndoableDimensionValueEdit(source,{
    format:DIMENSION_VALUE_EDIT_FORMAT,version:1,
    expectedProjectId:inspector.projectId,expectedRevision:inspector.revision,
    eventId:'inspector.set.thickness.12',featureId:'extrude.plate',
    field:'thicknessMm',unit:'mm',expectedValue:inspector.currentValue,
    value:12,mode:inspector.availability,admission:'require_admissible',
  });
  const after=runtime.inspect(history);
  const invalidation=runtime.diff(source,history);
  assert.equal(state(after,'extrude.plate').thicknessMm,12);
  assert.equal(state(after,'cut.holes').status,'pending_exact_provider');
  assert.deepEqual(invalidation.changedFeatureIds,['parameter.thickness']);
  assert.ok(invalidation.invalidatedFeatureIds.includes('extrude.plate'));
  assert.ok(invalidation.invalidatedFeatureIds.includes('cut.holes'));
  assert.equal(after.exactGeometryAvailable,false);
  assert.equal(before.authoredOrder[0],after.authoredOrder[0]);
  const serialized=runtime.save(history);
  history=runtime.reopen(serialized);
  assert.equal(runtime.inspect(history).revision,after.revision);
  const undone=runtime.undo(history,['undo.inspector.thickness']);
  assert.equal(state(runtime.inspect(undone),'extrude.plate').thicknessMm,8);
  const redone=runtime.redo(undone,['redo.inspector.thickness']);
  assert.equal(state(runtime.inspect(redone),'extrude.plate').thicknessMm,12);
  assert.ok(model.featuresOf(redone.document).some(
    feature=>feature.id==='cut.holes'&&feature.writeTargets.includes('body.plate')));
  return {
    projectId:after.projectId,
    sourceRevision:before.revision,editedRevision:after.revision,
    editedFeatureId:'extrude.plate',authoritativeSourceId:'parameter.thickness',
    initialThicknessMm:8,editedThicknessMm:12,
    invalidatedFeatureIds:invalidation.invalidatedFeatureIds,
    authoredOrder:after.authoredOrder,evaluationOrder:after.executableOrder,
    sketchStatus:state(after,'sketch.plate').status,
    cutStatus:state(after,'cut.holes').status,
    exactGeometryAvailable:after.exactGeometryAvailable,
    archiveBytes:Buffer.byteLength(serialized),replayVerified:true,
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(runInspectorDimensionEdit(),null,2)+'\n');
