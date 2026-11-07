/**
 * Demonstration: edit a real two-hole plate's historic parameter, then freeze
 * that current 12 mm value into authored intent and retire the parameter.
 *
 * node --experimental-strip-types packages/model/examples/freeze-parametric-plate.mjs
 * This is real RUNTIME+SKETCH scalar intent, not exact/STEP qualification.
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
import {commitUndoableParameterAuthoring} from '@intuit3d/model/parameter-authoring';
import {commitUndoableParameterEdit} from '@intuit3d/model/parameter-edit';
import {commitUndoableParameterFreeze,previewParameterFreeze} from '@intuit3d/model/parameter-freeze';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const state=(h,id)=>runtime.inspect(h).features.find(x=>x.featureId===id);
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});

export function runFreezeParametricPlate(){
  let history=transactions.startUndoHistory(model.newProject('demo.plate.parameter.freeze'));
  history=runtime.commit(history,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:sketch.plateSketchFixture()}}),
    create('create.extrude',{id:'extrude.plate',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.cut',{id:'cut.holes',kind:'cut',
      dependsOn:['extrude.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]);
  history=commitUndoableParameterAuthoring(history,{
    format:'intuit3d.parameter-authoring',version:1,
    expectedRevision:history.document.revision,admission:'require_admissible',
    parameter:{eventId:'parameter.create',featureId:'parameter.thickness',
      name:'thickness',unit:'mm',
      expression:{op:'literal',value:8,unit:'mm'}},
    bindings:[{eventId:'parameter.bind',featureId:'extrude.plate',field:'thicknessMm'}],
  });
  history=commitUndoableParameterEdit(history,{
    format:'intuit3d.parameter-edit',version:1,
    expectedRevision:history.document.revision,eventId:'parameter.edit.12',
    featureId:'parameter.thickness',admission:'require_admissible',
    expression:{op:'literal',value:12,unit:'mm'},
  });
  assert.equal(state(history,'extrude.plate').thicknessMm,12);
  const revisionBefore=history.document.revision;
  const request={
    format:'intuit3d.parameter-freeze',version:1,
    expectedRevision:revisionBefore,admission:'require_admissible',
    edits:[{eventId:'freeze.bake',featureId:'extrude.plate',field:'thicknessMm'}],
    release:[{eventId:'freeze.release',featureId:'extrude.plate',
      dependencies:['parameter.thickness']}],
    confirmIndependentIntentReviewed:true,
    retire:{eventId:'freeze.retire',parameterId:'parameter.thickness'},
  };
  const preview=previewParameterFreeze(history.document,request);
  assert.deepEqual(preview.baked,[{featureId:'extrude.plate',field:'thicknessMm',value:12}]);
  const frozen=commitUndoableParameterFreeze(history,request);
  assert.equal(state(frozen,'sketch.plate').status,'analytic_profile_only');
  assert.equal(state(frozen,'extrude.plate').thicknessMm,12);
  assert.equal(state(frozen,'cut.holes').status,'pending_exact_provider');
  assert.equal(model.featuresOf(frozen.document).some(f=>f.id==='parameter.thickness'),false);
  assert.deepEqual(model.featuresOf(frozen.document).find(f=>f.id==='extrude.plate').dependsOn,['sketch.plate']);
  const exported=runtime.save(frozen);
  const reopened=runtime.reopen(exported);
  assert.equal(state(reopened,'extrude.plate').thicknessMm,12);
  const undone=runtime.undo(reopened,['undo.retire','undo.release','undo.bake']);
  assert.equal(state(undone,'extrude.plate').thicknessMm,12);
  assert.ok(model.featuresOf(undone.document).some(f=>f.id==='parameter.thickness'));
  const redone=runtime.redo(undone,['redo.bake','redo.release','redo.retire']);
  assert.equal(state(redone,'extrude.plate').thicknessMm,12);
  return {
    projectId:redone.document.projectId,
    revisionBefore,revisionAfterFreeze:frozen.document.revision,
    frozenThicknessMm:12,stableBodyId:'body.plate',
    parameterRetired:true,bindingDependencyReleased:true,
    sketchStatus:state(redone,'sketch.plate').status,
    extrudeStatus:state(redone,'extrude.plate').status,
    cutStatus:state(redone,'cut.holes').status,
    exactGeometryAvailable:runtime.inspect(redone).exactGeometryAvailable,
    archiveBytes:exported.length,archiveReopened:true,undoRedo:true,
    invalidated:preview.invalidation.invalidatedFeatureIds,
  };
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  process.stdout.write(JSON.stringify(runFreezeParametricPlate(),null,2)+'\n');
}
