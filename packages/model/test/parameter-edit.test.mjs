import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newProject, commitEvent, featuresOf, planProject,
} from '../src/index.ts';
import {
  startUndoHistory, commitUndoableTransaction, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import { evaluateDimensionBindingPlan } from '../src/dimension-bindings.ts';
import { commitUndoableDimensionEdit } from '../src/dimension-edit.ts';
import { createModelArchive, serializeModelArchive, deserializeModelArchive } from '../src/archive.ts';
import {
  PARAMETER_EDIT_FORMAT, PARAMETER_EDIT_VERSION, previewParameterEdit,
  commitUndoableParameterEdit,
} from '../src/parameter-edit.ts';

const literal = (value, unit = 'mm') => ({op:'literal', value, unit});
const ref = (featureId) => ({op:'ref', featureId});
const create = (eventId,feature) => ({eventId,type:'feature.create',feature});
const parameter = (id, name, expression, unit = 'mm', dependsOn = []) => ({
  id, kind:'parameter', dependsOn, writeTargets:[],
  payload:{parameter:{name,unit,expression}},
});
const edit = (session, eventId, featureId, expression, admission = 'require_admissible') =>
  commitUndoableParameterEdit(session,{
    format:PARAMETER_EDIT_FORMAT,version:PARAMETER_EDIT_VERSION,
    eventId,featureId,expression,expectedRevision:session.document.revision,admission,
  });
const read = (doc,id) => featuresOf(doc).find(f=>f.id===id);
const gate = (doc,id) => evaluateDimensionBindingPlan(planProject(doc))
  .featureGates.find(g=>g.featureId===id);

function boundPlate() {
  let h=startUndoHistory(newProject('project.plate.parameter.edit'));
  h=commitUndoableTransaction(h,[
    create('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{roles:['outline','hole.1','hole.2']}}),
    create('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    create('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],
      writeTargets:['body.plate'],payload:{targetBodyId:'body.plate'}}),
    create('create.thickness',parameter('parameter.t','thickness',literal(8))),
  ]);
  h=commitUndoableDimensionEdit(h,{
    format:'intuit3d.dimension-edit',version:1,
    eventId:'bind.thickness',featureId:'plate',field:'thicknessMm',
    binding:{unit:'mm',expression:ref('parameter.t')},
    expectedRevision:h.document.revision,admission:'require_admissible',
  });
  return h;
}

test('retrospective scalar edit updates dependent plate, cut invalidation and durable archive/undo/redo',()=>{
  const before=boundPlate();
  const journal=JSON.stringify(before.document);
  const request={format:PARAMETER_EDIT_FORMAT,version:PARAMETER_EDIT_VERSION,
    eventId:'edit.thickness',featureId:'parameter.t',expression:literal(12),
    expectedRevision:before.document.revision,admission:'require_admissible'};
  const proposed=previewParameterEdit(before.document,request);
  assert.equal(proposed.parameterGate.status,'admissible');
  assert.deepEqual(proposed.invalidation.changedFeatureIds,['parameter.t']);
  assert.deepEqual(proposed.invalidation.invalidatedFeatureIds,['plate','cut','parameter.t']
    .sort((a,b)=>['sketch.plate','plate','cut','parameter.t'].indexOf(a) -
      ['sketch.plate','plate','cut','parameter.t'].indexOf(b)));
  assert.deepEqual(proposed.invalidation.readyToEvaluate,['parameter.t','plate','cut']);
  assert.deepEqual(proposed.invalidation.unchangedReady,['sketch.plate']);
  assert.equal(proposed.evaluation.featureGates.find(g=>g.featureId==='plate').resolvedPayload.thicknessMm,12);
  const updated=commitUndoableParameterEdit(before,request);
  assert.equal(JSON.stringify(before.document),journal);
  assert.equal(read(updated.document,'plate').payload.thicknessMm,8);
  assert.equal(read(updated.document,'parameter.t').id,'parameter.t');
  assert.equal(gate(updated.document,'plate').resolvedPayload.thicknessMm,12);
  assert.deepEqual(planProject(updated.document).authoredOrder,
    ['sketch.plate','plate','cut','parameter.t']);
  assert.deepEqual(planProject(updated.document).executableOrder,
    ['sketch.plate','parameter.t','plate','cut']);
  const saved=serializeModelArchive(createModelArchive(updated));
  const reopened=deserializeModelArchive(saved).history;
  assert.equal(gate(reopened.document,'plate').resolvedPayload.thicknessMm,12);
  const undone=undoTransaction(reopened,['undo.t']);
  assert.equal(gate(undone.document,'plate').resolvedPayload.thicknessMm,8);
  const redone=redoTransaction(undone,['redo.t']);
  assert.equal(gate(redone.document,'plate').resolvedPayload.thicknessMm,12);
  assert.equal(read(redone.document,'parameter.t').id,'parameter.t');
});

test('strict scalar admission protects a previously valid consumer from division by zero',()=>{
  let h=boundPlate();
  h=commitUndoableTransaction(h,[create('create.divisor',
    parameter('parameter.divisor','divisor',literal(2,'unitless'),'unitless'))]);
  h=commitUndoableDimensionEdit(h,{
    format:'intuit3d.dimension-edit',version:1,eventId:'replace.plate.binding',
    featureId:'plate',field:'thicknessMm',
    binding:{unit:'mm',expression:{
      op:'divide',left:literal(16),right:ref('parameter.divisor'),
    }},expectedRevision:h.document.revision,admission:'require_admissible',
  });
  assert.equal(gate(h.document,'plate').resolvedPayload.thicknessMm,8);
  const snapshot=JSON.stringify(h);
  assert.throws(()=>edit(h,'set.divisor.zero','parameter.divisor',
    literal(0,'unitless')),/invalidate an admitted dependent feature: plate/);
  assert.equal(JSON.stringify(h),snapshot);
  const unready=edit(h,'set.divisor.zero','parameter.divisor',
    literal(0,'unitless'),'permit_unresolved');
  assert.equal(gate(unready.document,'parameter.divisor').status,'admissible');
  assert.equal(gate(unready.document,'plate').status,'invalid_binding');
  assert.equal(gate(unready.document,'plate').resolvedPayload,null);
  assert.equal(gate(unready.document,'cut').status,'blocked_binding');
  const repaired=edit(unready,'repair.divisor','parameter.divisor',literal(4,'unitless'));
  assert.equal(gate(repaired.document,'plate').resolvedPayload.thicknessMm,4);
});

test('forward expression dependency remains pending, then recovers after retrospective target creation',()=>{
  let h=boundPlate();
  h=edit(h,'edit.future','parameter.t',ref('parameter.future'),'permit_unresolved');
  assert.equal(gate(h.document,'parameter.t').status,'unready');
  assert.equal(gate(h.document,'plate').resolvedPayload,null);
  assert.ok(read(h.document,'parameter.t').dependsOn.includes('parameter.future'));
  const pending=deserializeModelArchive(serializeModelArchive(createModelArchive(h))).history;
  const repaired=commitUndoableTransaction(pending,[
    create('create.future',parameter('parameter.future','future',literal(14))),
  ]);
  assert.equal(gate(repaired.document,'plate').resolvedPayload.thicknessMm,14);
  assert.deepEqual(planProject(repaired.document).authoredOrder,
    ['sketch.plate','plate','cut','parameter.t','parameter.future']);
  assert.ok(planProject(repaired.document).executableOrder.indexOf('parameter.future') <
    planProject(repaired.document).executableOrder.indexOf('parameter.t'));
});

test('old dependency edges and unrelated payload fields are not silently erased',()=>{
  let h=boundPlate();
  h=edit(h,'edit.one','parameter.t',ref('parameter.future'),'permit_unresolved');
  h=edit(h,'edit.two','parameter.t',literal(15),'permit_unresolved');
  assert.ok(read(h.document,'parameter.t').dependsOn.includes('parameter.future'));
  assert.equal(gate(h.document,'parameter.t').status,'unready');
  assert.equal(read(h.document,'parameter.t').payload.parameter.name,'thickness');
  assert.equal(read(h.document,'parameter.t').payload.parameter.unit,'mm');
});

test('stale revision, non-parameter target, unknown version and malformed expression reject atomically',()=>{
  const h=boundPlate();
  const request={format:PARAMETER_EDIT_FORMAT,version:PARAMETER_EDIT_VERSION,
    eventId:'event.good',featureId:'parameter.t',expectedRevision:h.document.revision,
    expression:literal(12),admission:'require_admissible'};
  for(const bad of [
    {...request,expectedRevision:h.document.revision-1},
    {...request,featureId:'plate'},
    {...request,version:2},
    {...request,expression:{op:'literal',value:12,unit:'metres'}},
    {...request,expression:{op:'ref',featureId:'plate'}},
    {...request,expression:{op:'divide',left:literal(4),right:literal(0)}},
    {...request,unexpected:true},
  ]) {
    assert.throws(()=>previewParameterEdit(h.document,bad));
  }
  assert.equal(read(h.document,'parameter.t').payload.parameter.expression.value,8);
});

test('duplicate journal event IDs reject without mutating history',()=>{
  const h=boundPlate();
  assert.throws(()=>edit(h,'bind.thickness','parameter.t',literal(12)),/repeats eventId/);
  assert.equal(gate(h.document,'plate').resolvedPayload.thicknessMm,8);
});

test('existing damaged parameter expression can be recovered by a strict edit without changing its ID',()=>{
  let d=newProject('project.repair.param');
  d=commitEvent(d,create('create.bad',parameter('parameter.bad','bad',
    {op:'divide',left:literal(4),right:literal(0,'unitless')})));
  assert.equal(gate(d,'parameter.bad').status,'blocked_binding');
  const h=startUndoHistory(d);
  const fixed=edit(h,'fix.bad','parameter.bad',literal(9));
  assert.equal(gate(fixed.document,'parameter.bad').status,'admissible');
  assert.equal(read(fixed.document,'parameter.bad').id,'parameter.bad');
});
