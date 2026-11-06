import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newProject, commitEvent, featuresOf, planProject, ProjectFormatError,
  ProjectRevisionError, serializeProject, deserializeProject,
} from '../src/index.ts';
import {
  previewDimensionEdit, DIMENSION_EDIT_FORMAT,
} from '../src/dimension-edit.ts';
import {
  previewDimensionDependencyReconciliation,
  commitUndoableDimensionDependencyReconciliation,
  DIMENSION_DEPENDENCY_RECONCILE_FORMAT,
  DIMENSION_DEPENDENCY_RECONCILE_VERSION,
} from '../src/dimension-dependency-reconcile.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction,
  serializeUndoHistory, deserializeUndoHistory,
} from '../src/transactions.ts';
import {evaluateDimensionBindingPlan} from '../src/dimension-bindings.ts';

const ref = (featureId) => ({op:'ref',featureId});
const literal = (value) => ({op:'literal',value,unit:'mm'});
const plate = (id='plate',dependsOn=[]) => ({id,kind:'extrude',dependsOn,
  writeTargets:['body.'+id],payload:{widthMm:20,depthMm:10,thicknessMm:2}});
const param = (id,value=25) => ({id,kind:'parameter',dependsOn:[],writeTargets:[],
  payload:{parameter:{name:'width',unit:'mm',expression:literal(value)}}});
const create = (eventId,feature) => ({eventId,type:'feature.create',feature});
const start = (initial=plate()) => commitEvent(newProject('project.reconcile'),
  create('create.plate',initial));
const feature = (doc,id='plate') => featuresOf(doc).find(f=>f.id===id);
const gate = (doc,id='plate') => evaluateDimensionBindingPlan(planProject(doc))
  .featureGates.find(g=>g.featureId===id);
const binding = (id) => ({unit:'mm',expression:ref(id)});
function edit(doc,id,value,field='widthMm',eventId='bind.'+id){
  return previewDimensionEdit(doc,{
    format:DIMENSION_EDIT_FORMAT,version:1,eventId,featureId:'plate',field,
    binding:value,expectedRevision:doc.revision,admission:'permit_unresolved',
  }).document;
}
const request = (doc,release,extra={}) => ({
  format:DIMENSION_DEPENDENCY_RECONCILE_FORMAT,
  version:DIMENSION_DEPENDENCY_RECONCILE_VERSION,
  eventId:'reconcile.orphans',featureId:'plate',
  expectedRevision:doc.revision,release,
  confirmIndependentIntentReviewed:true,
  admission:'require_admissible',...extra,
});

test('pending future parameter edge becomes ready only after explicit release',()=>{
  let doc=start();
  doc=edit(doc,'p.future',binding('p.future'));
  const withBinding=doc;
  doc=edit(doc,'p.future',null,'widthMm','clear.future');
  assert.equal(gate(doc).status,'unready');
  const original=serializeProject(doc);
  const preview=previewDimensionDependencyReconciliation(doc,request(doc,['p.future']));
  assert.equal(preview.beforeGate.status,'unready');
  assert.equal(preview.afterGate.status,'admissible');
  assert.deepEqual(preview.released,[{dependencyId:'p.future',
    introducedByEventId:'bind.p.future'}]);
  assert.deepEqual(preview.retainedDependencies,[]);
  assert.deepEqual(preview.invalidation.changedFeatureIds,['plate']);
  assert.equal(feature(preview.document).payload.widthMm,20);
  assert.equal(feature(withBinding).dependsOn[0],'p.future');
  assert.equal(serializeProject(doc),original);
  assert.equal(gate(deserializeProject(serializeProject(preview.document))).status,'admissible');
});

test('explicit release retains unrelated authored graph edges, order and stable IDs',()=>{
  let doc=start(plate('plate',['p.independent']));
  doc=commitEvent(doc,create('create.independent',param('p.independent',90)));
  doc=edit(doc,'p.orphan',binding('p.orphan'));
  doc=edit(doc,'p.orphan',null,'widthMm','clear.orphan');
  const preview=previewDimensionDependencyReconciliation(doc,request(doc,['p.orphan']));
  assert.deepEqual(feature(preview.document).dependsOn,['p.independent']);
  assert.equal(feature(preview.document).id,'plate');
  assert.equal(gate(preview.document).status,'admissible');
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,
    request(doc,['p.independent'])),/no binding-introduction witness/);
});

test('a still-bound parameter is never released, even with confirmation',()=>{
  const doc=edit(start(),'p.forward',binding('p.forward'));
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,
    request(doc,['p.forward'])),/live dimension binding/);
  assert.equal(gate(doc).resolvedPayload,null);
});

test('two fields share parameter: clearing one does not release the other',()=>{
  let doc=edit(start(),'p.shared',binding('p.shared'));
  doc=edit(doc,'p.shared',binding('p.shared'),'depthMm','bind.depth');
  doc=edit(doc,'p.shared',null,'widthMm','clear.width');
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,
    request(doc,['p.shared'])),/live dimension binding/);
  doc=edit(doc,'p.shared',null,'depthMm','clear.depth');
  assert.equal(previewDimensionDependencyReconciliation(doc,
    request(doc,['p.shared'])).afterGate.status,'admissible');
});

test('retargeted binding keeps new live edge and releases only historical old edge',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.param',param('p.new',47)));
  doc=edit(doc,'p.old',binding('p.old'));
  doc=edit(doc,'p.new',binding('p.new'),'widthMm','replace.width');
  assert.deepEqual(feature(doc).dependsOn,['p.old','p.new']);
  const preview=previewDimensionDependencyReconciliation(doc,
    request(doc,['p.old']));
  assert.deepEqual(feature(preview.document).dependsOn,['p.new']);
  assert.equal(preview.afterGate.status,'bound');
  assert.equal(preview.afterGate.resolvedPayload.widthMm,47);
});

test('unknown or manually introduced edges are not eligible for release',()=>{
  let doc=start(plate('plate',['p.authored']));
  doc=commitEvent(doc,{eventId:'manual.add',type:'feature.edit',
    featureId:'plate',patch:{dependsOn:['p.authored','p.manual']}});
  for(const id of ['p.authored','p.manual']){
    assert.throws(()=>previewDimensionDependencyReconciliation(doc,
      request(doc,[id])),/no binding-introduction witness/);
  }
});

test('generic later reintroduction invalidates a previous binding witness',()=>{
  let doc=edit(start(),'p.old',binding('p.old'));
  doc=edit(doc,'p.old',null,'widthMm','clear.old');
  doc=commitEvent(doc,{eventId:'remove.dep',type:'feature.edit',
    featureId:'plate',patch:{dependsOn:[]}});
  doc=commitEvent(doc,{eventId:'manual.readd',type:'feature.edit',
    featureId:'plate',patch:{dependsOn:['p.old']}});
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,
    request(doc,['p.old'])),/no binding-introduction witness/);
});

test('known non-parameter dependencies cannot be released',()=>{
  let doc=edit(start(),'p.future',binding('p.future'));
  doc=edit(doc,'p.future',null,'widthMm','clear.future');
  doc=commitEvent(doc,create('create.body',{id:'p.future',kind:'sketch',
    dependsOn:[],writeTargets:[],payload:{}}));
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,
    request(doc,['p.future'])),/non-parameter dependency/);
});

test('reconciles one complete atomic undo/redo frame through archive serialization',()=>{
  let doc=edit(start(),'p.lost',binding('p.lost'));
  doc=edit(doc,'p.lost',null,'widthMm','clear.lost');
  const before=serializeProject(doc);
  const session=commitUndoableDimensionDependencyReconciliation(
    startUndoHistory(doc),request(doc,['p.lost']));
  assert.equal(session.undoStack.length,1);
  assert.deepEqual(feature(session.document).dependsOn,[]);
  const reopened=deserializeUndoHistory(serializeUndoHistory(session));
  const undone=undoTransaction(reopened,['undo.release']);
  assert.deepEqual(feature(undone.document).dependsOn,['p.lost']);
  assert.equal(gate(undone.document).status,'unready');
  const redone=redoTransaction(undone,['redo.release']);
  assert.deepEqual(feature(redone.document).dependsOn,[]);
  assert.equal(gate(redone.document).status,'admissible');
  assert.equal(serializeProject(doc),before);
});

test('release does not erase independent pending dependencies in permissive admission',()=>{
  let doc=start(plate('plate',['p.other.missing']));
  doc=edit(doc,'p.binding.missing',binding('p.binding.missing'));
  doc=edit(doc,'p.binding.missing',null,'widthMm','clear.missing');
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,
    request(doc,['p.binding.missing'])),/nonadmissible/);
  const deferred=previewDimensionDependencyReconciliation(doc,
    request(doc,['p.binding.missing'],{admission:'permit_unresolved'}));
  assert.deepEqual(feature(deferred.document).dependsOn,['p.other.missing']);
  assert.equal(deferred.afterGate.status,'unready');
  assert.equal(deferred.afterGate.resolvedPayload,null);
});

test('revision, event ID and corrupt undo-history fences fail before mutation',()=>{
  let doc=edit(start(),'p.future',binding('p.future'));
  doc=edit(doc,'p.future',null,'widthMm','clear.future');
  const req=request(doc,['p.future']);
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,
    {...req,expectedRevision:0}),ProjectRevisionError);
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,
    {...req,eventId:'clear.future'}),ProjectFormatError);
  const history=startUndoHistory(doc);
  const original=serializeUndoHistory(history);
  assert.throws(()=>commitUndoableDimensionDependencyReconciliation(
    {...history,documentFence:'invalid'},req),ProjectRevisionError);
  assert.equal(serializeUndoHistory(history),original);
});

test('malformed request schemas, duplicate release IDs and blank acknowledgment fail',()=>{
  let doc=edit(start(),'p.future',binding('p.future'));
  doc=edit(doc,'p.future',null,'widthMm','clear.future');
  const req=request(doc,['p.future']);
  for(const bad of [
    {...req,version:2}, {...req,extra:'x'},
    {...req,confirmIndependentIntentReviewed:false},
    {...req,confirmIndependentIntentReviewed:undefined},
    {...req,release:[]}, {...req,release:['p.future','p.future']},
    {...req,release:['p.future','bad id']}, {...req,release:['no.edge']},
    {...req,release:Array.from({length:65},(_,i)=>'p.x'+i)},
    {...req,admission:'claim_exact'},
  ]) assert.throws(()=>previewDimensionDependencyReconciliation(doc,bad),
    ProjectFormatError);
  assert.equal(doc.revision,3);
});

test('malformed or unsupported manifest blocks release instead of guessing references',()=>{
  let doc=edit(start(),'p.future',binding('p.future'));
  doc=edit(doc,'p.future',null,'widthMm','clear.future');
  doc=commitEvent(doc,{eventId:'corrupt.manifest',type:'feature.edit',
    featureId:'plate',patch:{payload:{...feature(doc).payload,
      dimensionBindings:{format:'unsupported',version:8,entries:[]}}}});
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,
    request(doc,['p.future'])),/unsupported dimension binding manifest/);
});

test('release of one orphan never erases separately bound parameter on same feature',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.param',param('p.live',8)));
  doc=edit(doc,'p.old',binding('p.old'));
  doc=edit(doc,'p.live',binding('p.live'),'depthMm','bind.live');
  doc=edit(doc,'p.old',null,'widthMm','clear.old');
  const p=previewDimensionDependencyReconciliation(doc,request(doc,['p.old']));
  assert.deepEqual(feature(p.document).dependsOn,['p.live']);
  assert.equal(p.afterGate.status,'bound');
  assert.equal(p.afterGate.resolvedPayload.depthMm,8);
});
