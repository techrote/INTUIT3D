import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, featuresOf, planProject, commitEvent } from '../src/index.ts';
import { startUndoHistory, commitUndoableTransaction, undoTransaction, redoTransaction } from '../src/transactions.ts';
import { createModelArchive, serializeModelArchive, deserializeModelArchive } from '../src/archive.ts';
import { evaluateDimensionBindingPlan } from '../src/dimension-bindings.ts';
import { commitUndoableDimensionEdit } from '../src/dimension-edit.ts';
import {
  PARAMETER_INSPECTOR_FORMAT, PARAMETER_INSPECTOR_VERSION,
  previewParameterInspectorEdit, commitUndoableParameterInspectorEdit,
} from '../src/parameter-inspector.ts';

const literal = (value,unit='mm') => ({op:'literal',value,unit});
const ref = (featureId) => ({op:'ref',featureId});
const create = (eventId,feature) => ({eventId,type:'feature.create',feature});
const param = (id,name,expression=literal(8),unit='mm',dependsOn=[]) => ({
  id,kind:'parameter',dependsOn,writeTargets:[],
  payload:{parameter:{name,unit,expression}},
});
const row = (document,id) => featuresOf(document).find(f=>f.id===id);
const value = (document,id,field) => evaluateDimensionBindingPlan(planProject(document))
  .featureGates.find(g=>g.featureId===id)?.resolvedPayload?.[field];
const request = (h,eventId='edit.inspector',overrides={}) => ({
  format:PARAMETER_INSPECTOR_FORMAT,version:PARAMETER_INSPECTOR_VERSION,
  eventId,featureId:'parameter.thickness',expectedProjectId:h.document.projectId,
  expectedRevision:h.document.revision,name:'plateThickness',
  admission:'require_admissible',...overrides,
});
function fixture(){
  let h=startUndoHistory(newProject('project.parameter.inspector'));
  h=commitUndoableTransaction(h,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],payload:{}}),
    create('create.plate',{id:'extrude.plate',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.plate'],
      payload:{thicknessMm:8,widthMm:120}}),
    create('create.cut',{id:'cut.holes',kind:'cut',
      dependsOn:['extrude.plate'],writeTargets:['body.plate'],
      payload:{targetBodyId:'body.plate'}}),
    create('create.independent',{id:'extrude.spacer',kind:'extrude',
      dependsOn:[],writeTargets:['body.spacer'],payload:{thicknessMm:4}}),
    create('create.parameter',param('parameter.thickness','thickness')),
    create('create.other',param('parameter.offset','offset',literal(35))),
  ]);
  h=commitUndoableDimensionEdit(h,{
    format:'intuit3d.dimension-edit',version:1,eventId:'bind.thickness',
    featureId:'extrude.plate',field:'thicknessMm',
    binding:{unit:'mm',expression:ref('parameter.thickness')},
    expectedRevision:h.document.revision,admission:'require_admissible',
  });
  return h;
}

test('rename is an actual one-event journal edit, stable expression, no geometric-input change',()=>{
  const h=fixture(), snapshot=JSON.stringify(h);
  const p=previewParameterInspectorEdit(h.document,request(h));
  assert.equal(p.previousName,'thickness');
  assert.equal(p.nextName,'plateThickness');
  assert.equal(p.expressionChanged,false);
  assert.equal(p.changesGeometricInputs,false);
  assert.equal(p.exactGeometryAuthority,false);
  assert.equal(p.event.type,'feature.edit');
  assert.equal(p.event.featureId,'parameter.thickness');
  assert.equal(p.document.revision,h.document.revision+1);
  assert.deepEqual(p.invalidation.changedFeatureIds,['parameter.thickness']);
  assert.equal(value(p.document,'extrude.plate','thicknessMm'),8);
  assert.equal(value(p.document,'extrude.spacer','thicknessMm'),4);
  assert.deepEqual(row(p.document,'parameter.thickness').dependsOn,[]);
  assert.equal(row(p.document,'parameter.thickness').payload.parameter.name,'plateThickness');
  assert.equal(JSON.stringify(h),snapshot);
});

test('rename and 8→12 mm expression update are atomic, selectively invalidate, archive and undo/redo',()=>{
  const before=fixture();
  const p=previewParameterInspectorEdit(before.document,
    request(before,'edit.name.and.value',{expression:literal(12)}));
  assert.equal(p.expressionChanged,true);
  assert.equal(p.changesGeometricInputs,true);
  assert.equal(p.event.type,'feature.edit');
  assert.deepEqual(p.invalidation.invalidatedFeatureIds,
    ['extrude.plate','cut.holes','parameter.thickness']);
  assert.deepEqual(p.invalidation.unchangedReady,
    ['sketch.plate','extrude.spacer','parameter.offset']);
  const edited=commitUndoableParameterInspectorEdit(before,
    request(before,'edit.name.and.value',{expression:literal(12)}));
  assert.equal(edited.document.revision,before.document.revision+1);
  assert.equal(edited.undoStack.length,before.undoStack.length+1);
  assert.equal(value(edited.document,'extrude.plate','thicknessMm'),12);
  assert.equal(value(edited.document,'extrude.spacer','thicknessMm'),4);
  assert.equal(row(edited.document,'parameter.thickness').id,'parameter.thickness');
  assert.deepEqual(planProject(edited.document).authoredOrder,
    planProject(before.document).authoredOrder);

  const reopened=deserializeModelArchive(
    serializeModelArchive(createModelArchive(edited))).history;
  assert.equal(row(reopened.document,'parameter.thickness').payload.parameter.name,
    'plateThickness');
  const undo=undoTransaction(reopened,['undo.inspector']);
  assert.equal(value(undo.document,'extrude.plate','thicknessMm'),8);
  assert.equal(row(undo.document,'parameter.thickness').payload.parameter.name,
    'thickness');
  const redo=redoTransaction(undo,['redo.inspector']);
  assert.equal(value(redo.document,'extrude.plate','thicknessMm'),12);
  assert.equal(row(redo.document,'parameter.thickness').payload.parameter.name,
    'plateThickness');
  assert.equal(row(redo.document,'cut.holes').payload.targetBodyId,'body.plate');
});

test('an inspector formula edit retains semantic dependencies and original output IDs',()=>{
  let h=fixture();
  h=commitUndoableParameterInspectorEdit(h,request(h,'edit.formula',{
    expression:{op:'multiply',left:literal(2,'unitless'),
      right:ref('parameter.offset')},
    name:'effectiveHoleOffset',
  }));
  assert.ok(row(h.document,'parameter.thickness').dependsOn.includes('parameter.offset'));
  assert.equal(value(h.document,'extrude.plate','thicknessMm'),70);
  assert.equal(row(h.document,'cut.holes').id,'cut.holes');
  assert.equal(row(h.document,'extrude.plate').writeTargets[0],'body.plate');
});

test('strict mode refuses a broken expression without partially renaming the parameter',()=>{
  const h=fixture(), snap=JSON.stringify(h);
  assert.throws(()=>commitUndoableParameterInspectorEdit(h,
    request(h,'edit.div.zero',{
      expression:{op:'divide',left:literal(8),
        right:literal(0,'unitless')},
    })),/parameter edit not admissible|invalidate an admitted/);
  assert.equal(JSON.stringify(h),snap);
});

test('permit_unresolved retains pending expressions and recovers on later parameter creation',()=>{
  const h=fixture();
  const pending=commitUndoableParameterInspectorEdit(h,request(h,'edit.future',{
    expression:ref('parameter.future'),admission:'permit_unresolved',
    name:'futureThickness',
  }));
  assert.equal(value(pending.document,'extrude.plate','thicknessMm'),undefined);
  assert.ok(row(pending.document,'parameter.thickness')
    .dependsOn.includes('parameter.future'));
  assert.equal(row(pending.document,'parameter.thickness').payload.parameter.name,
    'futureThickness');
  const restored=commitEvent(pending.document,create('create.future',
    param('parameter.future','future',literal(10))));
  assert.equal(value(restored,'extrude.plate','thicknessMm'),10);
});

test('stale project/revision, duplicate names, malformed edits and no-ops reject',()=>{
  const h=fixture(), snap=JSON.stringify(h);
  for (const bad of [
    request(h,'bad.project',{expectedProjectId:'project.different'}),
    request(h,'bad.revision',{expectedRevision:h.document.revision-1}),
    request(h,'bad.duplicate',{name:'offset'}),
    request(h,'bad.symbol',{name:'contains spaces'}),
    request(h,'bad.target',{featureId:'cut.holes'}),
    request(h,'bad.version',{version:2}),
    request(h,'bad.extra',{extra:true}),
    request(h,'bad.noop',{name:'thickness'}),
    request(h,'bad.ast',{expression:{op:'ref',featureId:'cut.holes'}}),
    request(h,'bad.units',{expression:literal(12,'deg')}),
  ]) assert.throws(()=>previewParameterInspectorEdit(h.document,bad));
  assert.equal(JSON.stringify(h),snap);
});

test('reused journal event ID refuses an edit without mutating the session',()=>{
  const h=fixture(), snapshot=JSON.stringify(h);
  assert.throws(()=>commitUndoableParameterInspectorEdit(h,
    request(h,'bind.thickness')),/repeats eventId/);
  assert.equal(JSON.stringify(h),snapshot);
});
