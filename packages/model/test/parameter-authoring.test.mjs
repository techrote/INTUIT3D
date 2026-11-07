import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newProject, commitEvent, featuresOf, planProject,
} from '../src/index.ts';
import {
  startUndoHistory, commitUndoableTransaction, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import {
  previewParameterAuthoring, commitUndoableParameterAuthoring,
  PARAMETER_AUTHORING_FORMAT, PARAMETER_AUTHORING_VERSION,
} from '../src/parameter-authoring.ts';
import { commitUndoableParameterEdit } from '../src/parameter-edit.ts';
import { evaluateDimensionBindingPlan } from '../src/dimension-bindings.ts';
import { createModelArchive, serializeModelArchive, deserializeModelArchive } from '../src/archive.ts';

const literal = (value,unit='mm')=>({op:'literal',value,unit});
const ref = featureId=>({op:'ref',featureId});
const create = (eventId,feature)=>({type:'feature.create',eventId,feature});
const parameter = (id,name,expression,dependsOn=[])=>({
  id,kind:'parameter',dependsOn,writeTargets:[],
  payload:{parameter:{name,unit:'mm',expression}},
});
const find=(doc,id)=>featuresOf(doc).find(f=>f.id===id);
const gate=(doc,id)=>evaluateDimensionBindingPlan(planProject(doc))
  .featureGates.find(g=>g.featureId===id);
const request=(revision, overrides={})=>({
  format:PARAMETER_AUTHORING_FORMAT,version:PARAMETER_AUTHORING_VERSION,
  expectedRevision:revision,admission:'require_admissible',
  parameter:{eventId:'create.named.thickness',featureId:'parameter.thickness',
    name:'thickness',unit:'mm',expression:literal(8)},
  bindings:[
    {eventId:'bind.extrude',featureId:'plate.extrude',field:'thicknessMm'},
  ],
  ...overrides,
});

function plate() {
  let doc=newProject('project.plate.named.parameter');
  doc=commitEvent(doc,create('create.sketch',{id:'plate.sketch',kind:'sketch',
    dependsOn:[],writeTargets:[],payload:{semanticRole:'plate-with-two-holes'}}));
  doc=commitEvent(doc,create('create.extrude',{id:'plate.extrude',kind:'extrude',
    dependsOn:['plate.sketch'],writeTargets:['body.plate'],
    payload:{sourceSketchId:'plate.sketch',thicknessMm:8}}));
  doc=commitEvent(doc,create('create.cut',{id:'plate.cut',kind:'cut',
    dependsOn:['plate.extrude'],writeTargets:['body.plate'],
    payload:{sourceSketchId:'plate.sketch',targetBodyId:'body.plate',depthMm:8}}));
  doc=commitEvent(doc,create('create.annotation',{id:'annotation.1',kind:'annotation',
    dependsOn:[],writeTargets:[],payload:{label:'independent'}}));
  return startUndoHistory(doc);
}

test('create and retrospectively bind a named parameter in ONE undo frame; edit 8→12, replay, undo and redo',()=>{
  const before=plate();
  const original=JSON.stringify(before);
  const proposal=previewParameterAuthoring(before.document,request(before.document.revision));
  assert.equal(proposal.parameterGate.status,'admissible');
  assert.equal(proposal.bindingGates[0].status,'bound');
  assert.deepEqual(proposal.invalidation.changedFeatureIds,['plate.extrude','parameter.thickness']);
  assert.deepEqual(proposal.invalidation.invalidatedFeatureIds,
    ['plate.extrude','plate.cut','parameter.thickness']);
  assert.deepEqual(proposal.invalidation.unchangedReady,
    ['plate.sketch','annotation.1']);
  assert.deepEqual(proposal.events.map(e=>e.type),['feature.create','feature.edit']);
  assert.equal(JSON.stringify(before),original);

  const bound=commitUndoableParameterAuthoring(before,request(before.document.revision));
  assert.equal(bound.document.revision,before.document.revision+2);
  assert.equal(bound.undoStack.length,before.undoStack.length+1);
  assert.ok(find(bound.document,'plate.extrude').dependsOn.includes('parameter.thickness'));
  assert.equal(find(bound.document,'plate.extrude').payload.thicknessMm,8);
  assert.equal(gate(bound.document,'plate.extrude').resolvedPayload.thicknessMm,8);
  assert.deepEqual(planProject(bound.document).authoredOrder,
    ['plate.sketch','plate.extrude','plate.cut','annotation.1','parameter.thickness']);
  assert.ok(planProject(bound.document).executableOrder.indexOf('parameter.thickness')<
    planProject(bound.document).executableOrder.indexOf('plate.extrude'));

  const edited=commitUndoableParameterEdit(bound,{
    format:'intuit3d.parameter-edit',version:1,
    eventId:'edit.thickness.to12',featureId:'parameter.thickness',
    expectedRevision:bound.document.revision,expression:literal(12),
    admission:'require_admissible',
  });
  assert.equal(gate(edited.document,'plate.extrude').resolvedPayload.thicknessMm,12);
  assert.equal(gate(edited.document,'plate.cut').status,'admissible');
  const saved=serializeModelArchive(createModelArchive(edited));
  const reopened=deserializeModelArchive(saved).history;
  assert.equal(gate(reopened.document,'plate.extrude').resolvedPayload.thicknessMm,12);
  const undone=undoTransaction(reopened,['undo.edit.thickness']);
  assert.equal(gate(undone.document,'plate.extrude').resolvedPayload.thicknessMm,8);
  const unbound=undoTransaction(undone,['undo.bind','undo.parameter']);
  assert.equal(find(unbound.document,'parameter.thickness'),undefined);
  assert.deepEqual(find(unbound.document,'plate.extrude').dependsOn,['plate.sketch']);
  assert.equal(gate(unbound.document,'plate.extrude').status,'admissible');
  const rebound=redoTransaction(unbound,['redo.parameter','redo.bind']);
  assert.equal(gate(rebound.document,'plate.extrude').status,'bound');
  const redone=redoTransaction(rebound,['redo.edit.thickness']);
  assert.equal(gate(redone.document,'plate.extrude').resolvedPayload.thicknessMm,12);
  assert.equal(redone.document.projectId,before.document.projectId);
});

test('multiple selected dimensions can be bound atomically with distinct feature IDs',()=>{
  const before=plate();
  const req=request(before.document.revision,{
    bindings:[
      {eventId:'bind.extrude',featureId:'plate.extrude',field:'thicknessMm'},
      {eventId:'bind.cut',featureId:'plate.cut',field:'depthMm'},
    ],
  });
  const preview=previewParameterAuthoring(before.document,req);
  assert.equal(preview.bindingGates.length,2);
  const after=commitUndoableParameterAuthoring(before,req);
  assert.equal(after.document.revision,before.document.revision+3);
  assert.equal(after.undoStack.length,1);
  assert.equal(gate(after.document,'plate.extrude').resolvedPayload.thicknessMm,8);
  assert.equal(gate(after.document,'plate.cut').resolvedPayload.depthMm,8);
  assert.deepEqual(find(after.document,'plate.cut').dependsOn,
    ['plate.extrude','parameter.thickness']);
});

test('strict admission rejects malformed, duplicate or invalid units without partial commit',()=>{
  const before=plate();
  const base=request(before.document.revision);
  const invalid=[
    {...base, expectedRevision:before.document.revision-1},
    {...base, version:2},
    {...base, parameter:{...base.parameter,featureId:'plate.extrude'}},
    {...base, parameter:{...base.parameter,unit:'metres'}},
    {...base, parameter:{...base.parameter,expression:literal(8,'unitless')}},
    {...base, parameter:{...base.parameter,
      expression:{op:'divide',left:literal(8),right:literal(0,'unitless')}}},
    {...base, parameter:{...base.parameter,expression:ref('plate.sketch')}},
    {...base, parameter:{...base.parameter,expression:ref('parameter.thickness')}},
    {...base, bindings:[{...base.bindings[0],field:'unknown'}]},
    {...base, bindings:[{...base.bindings[0],featureId:'missing'}]},
    {...base, bindings:[{...base.bindings[0],eventId:'create.named.thickness'}]},
    {...base, bindings:[...base.bindings,...base.bindings]},
    {...base, bindings:[]},
    {...base, unexpected:true},
  ];
  const fence=JSON.stringify(before);
  for (const bad of invalid) assert.throws(()=>commitUndoableParameterAuthoring(before,bad));
  assert.equal(JSON.stringify(before),fence);
});

test('an unresolved forward scalar remains authored and explicitly pending until its source exists',()=>{
  const before=plate();
  const req=request(before.document.revision,{
    parameter:{...request(before.document.revision).parameter,
      expression:ref('parameter.future')},admission:'permit_unresolved',
  });
  assert.throws(()=>previewParameterAuthoring(before.document,{
    ...req,admission:'require_admissible',
  }),/not admissible/);
  const pending=commitUndoableParameterAuthoring(before,req);
  assert.equal(gate(pending.document,'plate.extrude').resolvedPayload,null);
  assert.equal(planProject(pending.document).features
    .find(x=>x.feature.id==='parameter.thickness').status,'pending');
  const resumed=commitUndoableTransaction(pending,[
    create('create.future',parameter('parameter.future','future',literal(14))),
  ]);
  assert.equal(gate(resumed.document,'plate.extrude').resolvedPayload.thicknessMm,14);
  assert.deepEqual(find(resumed.document,'parameter.thickness').dependsOn,['parameter.future']);
  assert.equal(find(resumed.document,'plate.extrude').id,'plate.extrude');
});

test('existing parameter name cannot be ambiguously duplicated and old feature IDs never reused',()=>{
  const before=plate();
  const bound=commitUndoableParameterAuthoring(before,request(before.document.revision));
  const next=request(bound.document.revision,{
    parameter:{eventId:'second.create',featureId:'parameter.another',
      name:'thickness',unit:'mm',expression:literal(3)},
    bindings:[{eventId:'second.bind',featureId:'plate.cut',field:'depthMm'}],
  });
  assert.throws(()=>previewParameterAuthoring(bound.document,next),/display name already exists/);
  assert.throws(()=>previewParameterAuthoring(bound.document,{
    ...next,parameter:{...next.parameter,name:'other',featureId:'parameter.thickness'},
  }),/ID already exists/);
});
