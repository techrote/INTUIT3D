import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newProject, commitEvent, planProject, featuresOf,
  serializeProject, deserializeProject, ProjectFormatError, ProjectRevisionError,
} from '../src/index.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction,
  serializeUndoHistory, deserializeUndoHistory,
} from '../src/transactions.ts';
import { evaluateDimensionBindingPlan, DIMENSION_BINDINGS_FORMAT } from '../src/dimension-bindings.ts';
import {
  DIMENSION_EDIT_FORMAT, previewDimensionEdit, commitUndoableDimensionEdit,
} from '../src/dimension-edit.ts';

const literal = (value, unit='mm') => ({op:'literal',value,unit});
const ref = featureId => ({op:'ref',featureId});
const add = (left,right) => ({op:'add',left,right});
const bind = (unit,expression) => ({unit,expression});
const create = (eventId,feature) => ({eventId,type:'feature.create',feature});
const param = (id,v=120) => ({id,kind:'parameter',dependsOn:[],writeTargets:[],
  payload:{parameter:{name:'width',unit:'mm',expression:literal(v)}}});
const plate = (id='plate') => ({id,kind:'extrude',dependsOn:[],writeTargets:['body.plate'],
  payload:{widthMm:8,depthMm:10,thicknessMm:2}});
const start = () => commitEvent(newProject('project.edit'),create('create.plate',plate()));
const proposal = (doc, opts={}) => ({
  format:DIMENSION_EDIT_FORMAT,version:1,eventId:opts.eventId??'edit.one',
  featureId:opts.featureId??'plate',field:opts.field??'widthMm',
  binding:opts.binding===undefined?bind('mm',ref('p.width')):opts.binding,
  expectedRevision:opts.expectedRevision??doc.revision,
  admission:opts.admission??'permit_unresolved',
});
const gate = (doc,id='plate') => evaluateDimensionBindingPlan(planProject(doc)).featureGates.find(g=>g.featureId===id);
const get = doc => featuresOf(doc).find(f=>f.id==='plate');

test('forward parameter binding authors pending intent, then resolves after late creation',()=>{
  const initial=start();
  const p=previewDimensionEdit(initial,proposal(initial));
  assert.equal(p.gate.status,'unready');
  assert.equal(p.gate.resolvedPayload,null);
  assert.equal(p.document.revision,initial.revision+1);
  assert.deepEqual(get(p.document).dependsOn,['p.width']);
  assert.equal(get(p.document).payload.widthMm,8);
  assert.deepEqual(p.invalidation.readyToEvaluate,[]);
  assert.ok(p.invalidation.invalidatedFeatureIds.includes('plate'));
  const later=commitEvent(p.document,create('create.parameter',param('p.width',155)));
  assert.equal(gate(later).status,'bound');
  assert.equal(gate(later).resolvedPayload.widthMm,155);
  assert.equal(get(later).payload.widthMm,8);
  assert.deepEqual(gate(deserializeProject(serializeProject(later))),gate(later));
});

test('strict admission rejects unresolved binding without altering document or history',()=>{
  const doc=start(), before=serializeProject(doc);
  assert.throws(()=>previewDimensionEdit(doc,proposal(doc,{admission:'require_admissible'})),ProjectFormatError);
  const session=startUndoHistory(doc);
  assert.throws(()=>commitUndoableDimensionEdit(session,proposal(doc,{admission:'require_admissible'})),ProjectFormatError);
  assert.equal(serializeProject(doc),before);
  assert.equal(session.document.revision,doc.revision);
});

test('strict admission passes known parameter, produces one atomic undo frame',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.p',param('p.width',20)));
  const session=commitUndoableDimensionEdit(startUndoHistory(doc),proposal(doc,{admission:'require_admissible'}));
  assert.equal(session.undoStack.length,1);
  assert.equal(session.document.revision,doc.revision+1);
  assert.equal(gate(session.document).resolvedPayload.widthMm,20);
  assert.equal(get(session.document).payload.widthMm,8);
  assert.equal(serializeUndoHistory(deserializeUndoHistory(serializeUndoHistory(session))),serializeUndoHistory(session));
});

test('undo and redo preserve semantic ID, value fallback and binding restoration',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.p',param('p.width',50)));
  const edited=commitUndoableDimensionEdit(startUndoHistory(doc),proposal(doc,{admission:'require_admissible'}));
  const undone=undoTransaction(edited,['undo.binding'],edited.document.revision);
  assert.equal(get(undone.document).id,'plate');
  assert.equal(get(undone.document).payload.widthMm,8);
  assert.equal(get(undone.document).payload.dimensionBindings,undefined);
  assert.deepEqual(get(undone.document).dependsOn,['p.width']); // additive edges are not guessed away
  const redone=redoTransaction(undone,['redo.binding'],undone.document.revision);
  assert.equal(gate(redone.document).resolvedPayload.widthMm,50);
  assert.equal(get(redone.document).id,'plate');
  assert.equal(redone.document.revision,edited.document.revision+2);
});

test('replacing one binding preserves another and both dependency edges',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.p1',param('p.width',25)));
  doc=commitEvent(doc,create('create.p2',param('p.depth',35)));
  const first=previewDimensionEdit(doc,proposal(doc,{admission:'require_admissible'}));
  const second=previewDimensionEdit(first.document,proposal(first.document,{field:'depthMm',
    eventId:'edit.two',admission:'require_admissible',binding:bind('mm',ref('p.depth'))}));
  assert.equal(second.gate.resolvedPayload.widthMm,25);
  assert.equal(second.gate.resolvedPayload.depthMm,35);
  assert.deepEqual(get(second.document).dependsOn,['p.width','p.depth']);
  const replace=previewDimensionEdit(second.document,proposal(second.document,{eventId:'edit.three',
    admission:'require_admissible',binding:bind('mm',add(ref('p.width'),literal(5)))}));
  assert.equal(replace.gate.resolvedPayload.widthMm,30);
  assert.equal(replace.gate.resolvedPayload.depthMm,35);
  assert.equal(get(replace.document).payload.widthMm,8);
});

test('removing one binding keeps other binding and cannot silently delete semantic dependency',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.p',param('p.width',25)));
  doc=previewDimensionEdit(doc,proposal(doc)).document;
  const cleared=previewDimensionEdit(doc,proposal(doc,{binding:null,eventId:'edit.clear',admission:'require_admissible'}));
  assert.equal(cleared.gate.status,'admissible');
  assert.equal(cleared.gate.resolvedPayload.widthMm,8);
  assert.deepEqual(get(cleared.document).dependsOn,['p.width']);
  assert.equal(get(cleared.document).payload.dimensionBindings,undefined);
});

test('stale optimistic revision is rejected on preview and committed session',()=>{
  const doc=start(), request=proposal(doc,{expectedRevision:0});
  assert.throws(()=>previewDimensionEdit(doc,request),ProjectRevisionError);
  assert.throws(()=>commitUndoableDimensionEdit(startUndoHistory(doc),request),ProjectRevisionError);
});

test('non-numeric, nonexistent or forbidden binding target is rejected',()=>{
  let doc=start();
  for (const field of ['missingMm','dimensionBindings','__proto__','constructor','width.mm']) {
    assert.throws(()=>previewDimensionEdit(doc,proposal(doc,{field})),ProjectFormatError);
  }
  doc=commitEvent(doc,{eventId:'add.label',type:'feature.edit',featureId:'plate',patch:{payload:{widthMm:'text',depthMm:10,thicknessMm:2}}});
  assert.throws(()=>previewDimensionEdit(doc,proposal(doc)),ProjectFormatError);
});

test('never silently converts existing non-parameter feature into a parameter reference',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.other',{...plate('another'),writeTargets:['body.other']}));
  assert.throws(()=>previewDimensionEdit(doc,proposal(doc,{binding:bind('mm',ref('another'))})),ProjectFormatError);
});

test('known cyclic dependency can remain explicitly conflicted, strict mode refuses',()=>{
  let doc=start();
  doc=commitEvent(doc,create('create.p',{...param('p.width'),dependsOn:['plate']}));
  const pending=previewDimensionEdit(doc,proposal(doc));
  assert.equal(pending.gate.status,'unready');
  assert.equal(pending.gate.resolvedPayload,null);
  assert.ok(pending.document.journal.length>doc.journal.length);
  assert.equal(planProject(pending.document).features.find(x=>x.feature.id==='plate').status,'conflicted');
  assert.throws(()=>previewDimensionEdit(doc,proposal(doc,{admission:'require_admissible'})),ProjectFormatError);
});

test('structurally invalid expressions fail even when parameter target is missing',()=>{
  const doc=start();
  for (const expression of [
    {op:'ref',featureId:'bad id'},
    {op:'add',left:literal(10)},
    {op:'literal',value:Infinity,unit:'mm'},
    {op:'literal',value:10,unit:'miles'},
    {op:'unknown'},
    {op:'ref',featureId:'p.width',extra:'x'},
  ]) {
    assert.throws(()=>previewDimensionEdit(doc,proposal(doc,{binding:bind('mm',expression)})),ProjectFormatError);
  }
});

test('cyclic, aliased and excessively deep expressions fail closed',()=>{
  const doc=start();
  const cycle={op:'negate'}; cycle.operand=cycle;
  const leaf=literal(2);
  const alias=add(leaf,leaf);
  let tooDeep=literal(1);
  for(let i=0;i<65;i++) tooDeep={op:'negate',operand:tooDeep};
  for(const expression of [cycle,alias,tooDeep]) {
    assert.throws(()=>previewDimensionEdit(doc,proposal(doc,{binding:bind('mm',expression)})),ProjectFormatError);
  }
});

test('malformed v1 manifests are not rewritten or silently repaired',()=>{
  const input=start();
  const bad=commitEvent(input,{eventId:'bad.manifest',type:'feature.edit',featureId:'plate',patch:{payload:{
    widthMm:8,depthMm:10,thicknessMm:2,
    dimensionBindings:{format:DIMENSION_BINDINGS_FORMAT,version:2,entries:[]},
  }}});
  assert.throws(()=>previewDimensionEdit(bad,proposal(bad)),ProjectFormatError);
  assert.equal(get(bad).payload.dimensionBindings.version,2);
});

test('deferred edit on missing target does not fabricate a numeric fallback or exact geometry',()=>{
  let doc=start();
  const proposalResult=previewDimensionEdit(doc,proposal(doc));
  assert.deepEqual(proposalResult.evaluation.admissibleExecutableOrder,[]);
  assert.equal(proposalResult.gate.resolvedPayload,null);
  assert.deepEqual(proposalResult.invalidation.unresolved.map(x=>x.status),['pending']);
  const independent=commitEvent(proposalResult.document,create('create.independent',{
    id:'unrelated',kind:'sketch',dependsOn:[],writeTargets:[],payload:{widthMm:8},
  }));
  const result=evaluateDimensionBindingPlan(planProject(independent));
  assert.deepEqual(result.admissibleExecutableOrder,['unrelated']);
});

test('request shape/version/admission invalidity is rejected before a journal write',()=>{
  const doc=start();
  const valid=proposal(doc);
  for(const req of [
    {...valid,version:2},
    {...valid,admission:'force_geometry'},
    {...valid,unexpected:true},
    {...valid,binding:{unit:'mm',expression:literal(2),unknown:1}},
  ]) assert.throws(()=>previewDimensionEdit(doc,req),ProjectFormatError);
});
