import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject, featuresOf, planProject} from '../src/index.ts';
import {startUndoHistory,commitUndoableTransaction,undoTransaction,redoTransaction} from '../src/transactions.ts';
import {commitUndoableDimensionEdit} from '../src/dimension-edit.ts';
import {evaluateDimensionBindingPlan} from '../src/dimension-bindings.ts';
import {createModelArchive,serializeModelArchive,deserializeModelArchive} from '../src/archive.ts';
import {
  DIMENSION_VALUE_EDIT_FORMAT, DIMENSION_VALUE_EDIT_VERSION,
  inspectDimensionValue,previewDimensionValueEdit,commitUndoableDimensionValueEdit,
} from '../src/dimension-value-edit.ts';

const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const value=(doc,id,field)=>evaluateDimensionBindingPlan(planProject(doc))
  .featureGates.find(row=>row.featureId===id)?.resolvedPayload?.[field];
const read=(doc,id)=>featuresOf(doc).find(f=>f.id===id);
const makeRequest=(history,{eventId='edit.inspector',featureId='extrude.plate',
  field='thicknessMm',unit='mm',expectedValue=8,value:nextValue=12,
  mode='literal_parameter',admission='require_admissible'}={})=>({
  format:DIMENSION_VALUE_EDIT_FORMAT,version:DIMENSION_VALUE_EDIT_VERSION,
  expectedProjectId:history.document.projectId,
  expectedRevision:history.document.revision,
  eventId,featureId,field,unit,expectedValue,value:nextValue,mode,admission,
});

function plate() {
  let history=startUndoHistory(newProject('project.inspector.plate'));
  history=commitUndoableTransaction(history,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',
      dependsOn:[],writeTargets:[],payload:{roles:['outline','hole.a','hole.b']}}),
    create('create.plate',{id:'extrude.plate',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.cut',{id:'cut.holes',kind:'cut',
      dependsOn:['extrude.plate','sketch.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate',throughAll:true}}),
    create('create.shared',{id:'extrude.shared',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.shared'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.independent',{id:'extrude.independent',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.independent'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:5}}),
    create('create.parameter',{id:'parameter.thickness',kind:'parameter',
      dependsOn:[],writeTargets:[],payload:{parameter:{name:'thickness',
        unit:'mm',expression:{op:'literal',value:8,unit:'mm'}}}}),
  ]);
  for(const id of ['extrude.plate','extrude.shared']) {
    history=commitUndoableDimensionEdit(history,{
      format:'intuit3d.dimension-edit',version:1,eventId:'bind.'+id,
      featureId:id,field:'thicknessMm',
      binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.thickness'}},
      expectedRevision:history.document.revision,admission:'require_admissible',
    });
  }
  return history;
}

test('inspector edits the authoritative shared parameter, never stale authored geometry fallback',()=>{
  const before=plate();
  const shown=inspectDimensionValue(before.document,'extrude.plate','thicknessMm','mm');
  assert.equal(shown.availability,'literal_parameter');
  assert.equal(shown.parameterFeatureId,'parameter.thickness');
  assert.equal(shown.currentValue,8);
  assert.equal(shown.exactGeometryAuthority,false);
  const request=makeRequest(before);
  const preview=previewDimensionValueEdit(before.document,request);
  assert.equal(preview.mode,'literal_parameter');
  assert.equal(preview.changedSourceFeatureId,'parameter.thickness');
  assert.equal(preview.event.type,'feature.edit');
  assert.equal(preview.event.featureId,'parameter.thickness');
  assert.equal(preview.nextValue,12);
  assert.equal(preview.requiresNativeRebuild,true);
  assert.equal(preview.exactGeometryAuthority,false);
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('cut.holes'));
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('extrude.shared'));
  assert.ok(!preview.invalidation.invalidatedFeatureIds.includes('extrude.independent'));
  assert.equal(value(preview.document,'extrude.shared','thicknessMm'),12);
  assert.equal(read(preview.document,'extrude.plate').payload.thicknessMm,8);
  assert.equal(read(preview.document,'extrude.plate').id,'extrude.plate');
  assert.equal(read(preview.document,'cut.holes').writeTargets[0],'body.plate');
  assert.equal(JSON.stringify(before.document),before.documentFence);
});

test('parametric thickness edit survives archived undo/redo and preserves IDs and authored chronology',()=>{
  const source=plate();
  const edited=commitUndoableDimensionValueEdit(source,makeRequest(source));
  const archived=serializeModelArchive(createModelArchive(edited));
  const reopened=deserializeModelArchive(archived).history;
  assert.equal(value(reopened.document,'extrude.plate','thicknessMm'),12);
  assert.equal(value(reopened.document,'extrude.shared','thicknessMm'),12);
  const undone=undoTransaction(reopened,['undo.dimension']);
  assert.equal(value(undone.document,'extrude.plate','thicknessMm'),8);
  assert.equal(value(undone.document,'extrude.shared','thicknessMm'),8);
  const redone=redoTransaction(undone,['redo.dimension']);
  assert.equal(value(redone.document,'extrude.plate','thicknessMm'),12);
  assert.equal(value(redone.document,'extrude.shared','thicknessMm'),12);
  assert.equal(value(redone.document,'extrude.independent','thicknessMm'),5);
  assert.deepEqual(planProject(redone.document).authoredOrder,
    planProject(source.document).authoredOrder);
  assert.equal(read(redone.document,'parameter.thickness').id,'parameter.thickness');
});

test('plain scalar edit changes one feature, leaves shared parameters and independent bodies alone',()=>{
  const before=plate();
  const inspection=inspectDimensionValue(before.document,
    'extrude.independent','thicknessMm','mm');
  assert.equal(inspection.availability,'authored_scalar');
  assert.equal(inspection.currentValue,5);
  const request=makeRequest(before,{
    eventId:'edit.independent',featureId:'extrude.independent',expectedValue:5,
    value:7,mode:'authored_scalar',
  });
  const preview=previewDimensionValueEdit(before.document,request);
  assert.deepEqual(preview.invalidation.changedFeatureIds,['extrude.independent']);
  assert.deepEqual(preview.invalidation.invalidatedFeatureIds,['extrude.independent']);
  const after=commitUndoableDimensionValueEdit(before,request);
  assert.equal(read(after.document,'extrude.independent').payload.thicknessMm,7);
  assert.equal(value(after.document,'extrude.plate','thicknessMm'),8);
  assert.equal(read(after.document,'parameter.thickness').payload.parameter.expression.value,8);
});

test('formula-bound dimension refuses invented inverse, and scalar mode cannot bypass a binding',()=>{
  let history=plate();
  history=commitUndoableDimensionEdit(history,{
    format:'intuit3d.dimension-edit',version:1,eventId:'bind.computed',
    featureId:'extrude.plate',field:'thicknessMm',expectedRevision:history.document.revision,
    binding:{unit:'mm',expression:{op:'multiply',
      left:{op:'ref',featureId:'parameter.thickness'},
      right:{op:'literal',value:2,unit:'unitless'}}},
    admission:'require_admissible',
  });
  const shown=inspectDimensionValue(history.document,'extrude.plate','thicknessMm','mm');
  assert.equal(shown.currentValue,16);
  assert.equal(shown.availability,'formula_requires_parameter_edit');
  assert.equal(shown.parameterFeatureId,null);
  assert.throws(()=>previewDimensionValueEdit(history.document,
    makeRequest(history,{expectedValue:16,value:20,mode:'literal_parameter'})),
    /without explicit source repair/);
  assert.throws(()=>previewDimensionValueEdit(history.document,
    makeRequest(history,{expectedValue:16,value:20,mode:'authored_scalar'})),
    /without explicit source repair/);
  assert.equal(value(history.document,'extrude.plate','thicknessMm'),16);
});

test('stale revision, project mismatch, wrong units, wrong source and unchanged edits fail atomically',()=>{
  const before=plate();
  const request=makeRequest(before);
  const original=JSON.stringify(before);
  for(const bad of [
    {...request,expectedRevision:before.document.revision-1},
    {...request,expectedProjectId:'project.other'},
    {...request,expectedValue:7},
    {...request,unit:'deg'},
    {...request,mode:'authored_scalar'},
    {...request,value:8},
    {...request,value:Infinity},
    {...request,eventId:'bind.extrude.plate'},
    {...request,version:2},
    {...request,unexpected:true},
  ]) {
    assert.throws(()=>commitUndoableDimensionValueEdit(before,bad));
  }
  assert.equal(JSON.stringify(before),original);
});

test('unresolved binding never falls back to authored numeric scalar',()=>{
  let history=plate();
  history=commitUndoableTransaction(history,[{
    eventId:'remove.parameter',type:'feature.remove',featureId:'parameter.thickness',
  }]);
  const inspection=inspectDimensionValue(history.document,'extrude.plate','thicknessMm','mm');
  assert.equal(inspection.availability,'unavailable');
  assert.equal(inspection.currentValue,null);
  assert.equal(inspection.authoredValue,8);
  assert.throws(()=>previewDimensionValueEdit(history.document,
    makeRequest(history)),/without explicit source repair/);
});
