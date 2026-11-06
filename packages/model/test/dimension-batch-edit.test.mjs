import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newProject, commitEvent, featuresOf, planProject, serializeProject,
  deserializeProject, ProjectFormatError, ProjectRevisionError,
} from '../src/index.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction,
  serializeUndoHistory, deserializeUndoHistory,
} from '../src/transactions.ts';
import {
  evaluateDimensionBindingPlan,
} from '../src/dimension-bindings.ts';
import {
  previewDimensionEdit, DIMENSION_EDIT_FORMAT,
} from '../src/dimension-edit.ts';
import {
  DIMENSION_BATCH_EDIT_FORMAT, DIMENSION_BATCH_EDIT_VERSION,
  previewDimensionEditBatch, commitUndoableDimensionEditBatch,
} from '../src/dimension-batch-edit.ts';

const literal = (value, unit='mm') => ({op:'literal',value,unit});
const ref = (featureId) => ({op:'ref',featureId});
const binding = (expression,unit='mm') => ({unit,expression});
const create = (eventId,feature) => ({eventId,type:'feature.create',feature});
const param = (id,value) => ({id,kind:'parameter',dependsOn:[],writeTargets:[],
  payload:{parameter:{name:id.replace(/[^A-Za-z0-9_]/g,'_'),unit:'mm',expression:literal(value)}}});
const plate = (id) => ({id,kind:'extrude',dependsOn:[],writeTargets:['body.'+id],
  payload:{widthMm:8,depthMm:10,thicknessMm:2}});
const start = () => commitEvent(newProject('project.batch'),
  create('create.plate',plate('plate')));
const feature = (doc,id) => featuresOf(doc).find((f)=>f.id===id);
const gate = (doc,id) => evaluateDimensionBindingPlan(planProject(doc))
  .featureGates.find((g)=>g.featureId===id);
const edit = (eventId,featureId,field,bindingValue) => ({
  eventId,featureId,field,binding:bindingValue,
});
const batch = (doc,edits,admission='permit_unresolved') => ({
  format:DIMENSION_BATCH_EDIT_FORMAT,version:DIMENSION_BATCH_EDIT_VERSION,
  expectedRevision:doc.revision,admission,edits,
});

test('three cross-feature edits admit at final revision as ONE durable undo frame',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.plate2',plate('plate2')));
  doc=commitEvent(doc,create('create.width',param('p.width',120)));
  doc=commitEvent(doc,create('create.depth',param('p.depth',50)));
  const edits=[
    edit('bind.a.width','plate','widthMm',binding(ref('p.width'))),
    edit('bind.b.width','plate2','widthMm',binding(ref('p.depth'))),
    edit('bind.a.depth','plate','depthMm',binding(ref('p.depth'))),
  ];
  const request=batch(doc,edits,'require_admissible');
  const original=serializeProject(doc);
  const staged=previewDimensionEditBatch(doc,request);
  assert.equal(staged.events.length,3);
  assert.equal(staged.document.revision,doc.revision+3);
  assert.deepEqual(staged.editedFeatureGates.map((g)=>[g.featureId,g.status]),
    [['plate','bound'],['plate2','bound']]);
  assert.equal(gate(staged.document,'plate').resolvedPayload.widthMm,120);
  assert.equal(gate(staged.document,'plate').resolvedPayload.depthMm,50);
  assert.equal(gate(staged.document,'plate2').resolvedPayload.widthMm,50);
  assert.deepEqual(feature(staged.document,'plate').dependsOn,['p.width','p.depth']);
  assert.equal(feature(staged.document,'plate').payload.widthMm,8);
  assert.deepEqual(staged.invalidation.changedFeatureIds,['plate','plate2']);
  assert.deepEqual(staged.invalidation.readyToEvaluate,['plate','plate2']);
  assert.equal(serializeProject(doc),original); // preview cannot mutate authoring
  const session=commitUndoableDimensionEditBatch(startUndoHistory(doc),request);
  assert.equal(session.undoStack.length,1);
  assert.equal(session.undoStack[0].length,3);
  assert.equal(serializeProject(session.document),serializeProject(staged.document));
  const reopened=deserializeUndoHistory(serializeUndoHistory(session));
  const undone=undoTransaction(reopened,['undo.third','undo.second','undo.first']);
  assert.equal(gate(undone.document,'plate').status,'admissible');
  assert.equal(gate(undone.document,'plate2').status,'admissible');
  assert.deepEqual(feature(undone.document,'plate').dependsOn,[]);
  assert.equal(undone.redoStack.length,1);
  const redone=redoTransaction(undone,['redo.first','redo.second','redo.third']);
  assert.equal(gate(redone.document,'plate').resolvedPayload.depthMm,50);
  assert.equal(gate(redone.document,'plate2').resolvedPayload.widthMm,50);
  assert.equal(feature(redone.document,'plate').id,'plate');
  assert.equal(feature(redone.document,'plate2').id,'plate2');
});

test('strict batch evaluates multiple changed fields on the final authored document',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.p',param('p.width',22)));
  const p=previewDimensionEditBatch(doc,batch(doc,[
    edit('edit.1','plate','widthMm',binding(ref('p.width'))),
    edit('edit.2','plate','thicknessMm',binding(literal(5))),
  ],'require_admissible'));
  assert.equal(p.editedFeatureGates.length,1);
  assert.equal(p.editedFeatureGates[0].resolvedPayload.widthMm,22);
  assert.equal(p.editedFeatureGates[0].resolvedPayload.thicknessMm,5);
  assert.equal(feature(p.document,'plate').payload.thicknessMm,2);
  assert.equal(p.document.journal.at(-1).eventId,'edit.2');
  assert.deepEqual(feature(p.document,'plate').dependsOn,['p.width']);
  assert.deepEqual(gate(deserializeProject(serializeProject(p.document)),'plate'),
    gate(p.document,'plate'));
});

test('permissive batch authors several future-target bindings with no numeric fallback',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.plate2',plate('plate2')));
  const p=previewDimensionEditBatch(doc,batch(doc,[
    edit('bind.a','plate','widthMm',binding(ref('p.late'))),
    edit('bind.b','plate2','depthMm',binding(ref('p.late'))),
  ]));
  assert.deepEqual(p.editedFeatureGates.map((g)=>g.status),['unready','unready']);
  assert.equal(p.editedFeatureGates[0].resolvedPayload,null);
  assert.equal(p.editedFeatureGates[1].resolvedPayload,null);
  assert.deepEqual(p.evaluation.admissibleExecutableOrder,[]);
  assert.deepEqual(feature(p.document,'plate').dependsOn,['p.late']);
  assert.deepEqual(feature(p.document,'plate2').dependsOn,['p.late']);
  const later=commitEvent(p.document,create('create.late',param('p.late',43)));
  assert.equal(gate(later,'plate').resolvedPayload.widthMm,43);
  assert.equal(gate(later,'plate2').resolvedPayload.depthMm,43);
});

test('clearing an unresolved binding never silently deletes its declared dependency',()=>{
  let doc=start();
  doc=previewDimensionEdit(doc,{
    format:DIMENSION_EDIT_FORMAT,version:1,eventId:'edit.future',
    featureId:'plate',field:'widthMm',binding:binding(ref('p.missing')),
    expectedRevision:doc.revision,admission:'permit_unresolved',
  }).document;
  const req=batch(doc,[
    edit('clear.future','plate','widthMm',null),
    edit('new.constant','plate','depthMm',binding(literal(19))),
  ]);
  assert.throws(()=>previewDimensionEditBatch(doc,{...req,admission:'require_admissible'}),
    ProjectFormatError);
  const permissive=previewDimensionEditBatch(doc,req);
  assert.equal(gate(permissive.document,'plate').status,'unready');
  assert.equal(gate(permissive.document,'plate').resolvedPayload,null);
  assert.deepEqual(feature(permissive.document,'plate').dependsOn,['p.missing']);
  assert.equal(feature(permissive.document,'plate').payload.widthMm,8);
});

test('bad final edit rejects the entire transaction without mutating saved history',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.other',plate('other')));
  doc=commitEvent(doc,create('create.param',param('p.valid',40)));
  const session=startUndoHistory(doc);
  const snapshot=serializeUndoHistory(session);
  const req=batch(doc,[
    edit('valid.first','plate','widthMm',binding(ref('p.valid'))),
    edit('invalid.second','other','widthMm',binding(ref('plate'))),
  ],'require_admissible');
  assert.throws(()=>previewDimensionEditBatch(doc,req),ProjectFormatError);
  assert.throws(()=>commitUndoableDimensionEditBatch(session,req),ProjectFormatError);
  assert.equal(serializeUndoHistory(session),snapshot);
  assert.equal(feature(doc,'plate').payload.dimensionBindings,undefined);
});

test('strict mode refuses unresolved additions, permissive mode retains editable journal',()=>{
  const doc=start();
  const req=batch(doc,[
    edit('future.1','plate','widthMm',binding(ref('p.forward'))),
    edit('future.2','plate','depthMm',binding(literal(7))),
  ],'require_admissible');
  assert.throws(()=>previewDimensionEditBatch(doc,req),ProjectFormatError);
  const deferred=commitUndoableDimensionEditBatch(startUndoHistory(doc),
    {...req,admission:'permit_unresolved'});
  assert.equal(deferred.undoStack.length,1);
  assert.equal(gate(deferred.document,'plate').status,'unready');
  assert.equal(gate(deferred.document,'plate').resolvedPayload,null);
  assert.equal(feature(deferred.document,'plate').payload.depthMm,10);
});

test('stale revision and corrupt session fences fail before any events commit',()=>{
  const doc=start();
  const req=batch(doc,[edit('e1','plate','widthMm',binding(literal(9)))]);
  assert.throws(()=>previewDimensionEditBatch(doc,{...req,expectedRevision:0}),ProjectRevisionError);
  assert.throws(()=>commitUndoableDimensionEditBatch(startUndoHistory(doc),
    {...req,expectedRevision:0}),ProjectRevisionError);
  const session=startUndoHistory(doc);
  assert.throws(()=>commitUndoableDimensionEditBatch({...session,documentFence:'wrong'},req),
    ProjectRevisionError);
});

test('duplicate targets/event IDs and bounded event capacity reject before side effects',()=>{
  const doc=start();
  const req=batch(doc,[edit('a','plate','widthMm',binding(literal(9)))]);
  assert.throws(()=>previewDimensionEditBatch(doc,{...req,edits:[
    req.edits[0],edit('b','plate','widthMm',binding(literal(10))),
  ]}),ProjectFormatError);
  assert.throws(()=>previewDimensionEditBatch(doc,{...req,edits:[
    req.edits[0],edit('a','plate','depthMm',binding(literal(10))),
  ]}),ProjectFormatError);
  assert.throws(()=>previewDimensionEditBatch(doc,{...req,edits:Array.from({length:65},
    (_,i)=>edit('bulk.'+i,'plate','field'+i,binding(literal(i))))}),ProjectFormatError);
  assert.throws(()=>previewDimensionEditBatch(doc,{...req,edits:[]}),ProjectFormatError);
  assert.equal(doc.revision,1);
});

test('malformed later expression, missing field and non-parameter reference fail closed',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.other',plate('other')));
  const valid=edit('one','plate','depthMm',binding(literal(10)));
  for(const bad of [
    edit('bad.1','plate','thicknessMm',binding({op:'literal',value:NaN,unit:'mm'})),
    edit('bad.2','other','nonexistentMm',binding(literal(2))),
    edit('bad.3','other','widthMm',binding(ref('plate'))),
  ]) assert.throws(()=>previewDimensionEditBatch(doc,batch(doc,[valid,bad])),
    ProjectFormatError);
  const original=serializeProject(doc);
  const cycle={op:'negate'};cycle.operand=cycle;
  assert.throws(()=>previewDimensionEditBatch(doc,batch(doc,[valid,
    edit('bad.cycle','other','widthMm',binding(cycle))])),ProjectFormatError);
  assert.equal(serializeProject(doc),original);
});

test('unsupported versions, extra properties and malformed entries reject',()=>{
  const doc=start();
  const req=batch(doc,[edit('a','plate','widthMm',binding(literal(9)))]);
  for(const broken of [
    {...req,version:2},
    {...req,unexpected:'x'},
    {...req,admission:'force_geometry'},
    {...req,edits:[{...req.edits[0],unexpected:'x'}]},
    {...req,edits:[null]},
    {...req,edits:[{...req.edits[0],binding:{unit:'mm',expression:literal(8),extra:1}}]},
  ]) assert.throws(()=>previewDimensionEditBatch(doc,broken),ProjectFormatError);
});

test('existing event IDs cannot be reused, and serialized batch is deterministic',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.p',param('p.good',18)));
  assert.throws(()=>previewDimensionEditBatch(doc,batch(doc,[
    edit('create.p','plate','widthMm',binding(ref('p.good'))),
  ])),ProjectFormatError);
  const req=batch(doc,[edit('unique','plate','widthMm',binding(ref('p.good')))]);
  const left=previewDimensionEditBatch(doc,req);
  const right=previewDimensionEditBatch(deserializeProject(serializeProject(doc)),req);
  assert.equal(serializeProject(left.document),serializeProject(right.document));
  assert.deepEqual(left.invalidation,right.invalidation);
});
