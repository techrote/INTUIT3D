/**
 * INTEGRATION contract conformance: #40 INTENT multi-field batch binding and
 * #41 SKETCH dyadic circular profile admission.
 *
 * Adapter here is deliberately test-only. These semantic scalars do not imply
 * authoritative sketch ownership, B-rep geometry, exact STEP, or browser CAD.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newProject, commitEvent, featuresOf, planProject, serializeProject,
} from '@intuit3d/model';
import {
  startUndoHistory, undoTransaction, redoTransaction,
} from '@intuit3d/model/transactions';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '@intuit3d/model/archive';
import {
  DIMENSION_BATCH_EDIT_FORMAT, DIMENSION_BATCH_EDIT_VERSION,
  previewDimensionEditBatch, commitUndoableDimensionEditBatch,
} from '@intuit3d/model/dimension-batch-edit';
import { evaluateDimensionBindingPlan } from '@intuit3d/model/dimension-bindings';
import { assessCircularProfile } from '@intuit3d/sketch/circle-guard/v1';

const create = (eventId, feature) => ({ eventId, type:'feature.create', feature });
const parameter = (id, name, value) => ({
  id, kind:'parameter', dependsOn:[], writeTargets:[],
  payload:{ parameter:{ name, unit:'mm', expression:{op:'literal',value,unit:'mm'} } },
});
const plate = () => ({
  id:'plate', kind:'extrude', dependsOn:[], writeTargets:['body.plate'],
  payload:{widthMm:120,depthMm:80,thicknessMm:8},
});
function documentWithDimensions(width, depth=40) {
  let doc=commitEvent(newProject('integration.batch.circle'),
    create('create.plate',plate()));
  doc=commitEvent(doc,create('create.width',parameter('p.width','width',width)));
  return commitEvent(doc,create('create.depth',parameter('p.depth','depth',depth)));
}
const bind = (eventId,field,featureId) => ({
  eventId,featureId:'plate',field,
  binding:{unit:'mm',expression:{op:'ref',featureId}},
});
const request = (doc, admission='require_admissible') => ({
  format:DIMENSION_BATCH_EDIT_FORMAT, version:DIMENSION_BATCH_EDIT_VERSION,
  expectedRevision:doc.revision, admission,
  edits:[bind('bind.width','widthMm','p.width'),
    bind('bind.depth','depthMm','p.depth')],
});
const gate = doc => evaluateDimensionBindingPlan(planProject(doc))
  .featureGates.find(f=>f.featureId==='plate');
const polygon = (width,depth) => [
  {x:0,y:0},{x:width,y:0},{x:width,y:depth},{x:0,y:depth},
];
function classifyDerivedPlate(doc) {
  const g=gate(doc);
  if (!g || (g.status!=='bound' && g.status!=='admissible') || !g.resolvedPayload) {
    return {kind:'pending',reason:g?.status??'missing'};
  }
  const {widthMm,depthMm}=g.resolvedPayload;
  return {kind:'planar_only',check:assessCircularProfile(polygon(widthMm,depthMm),[
    {id:'hole',x:24,y:20,radius:6},
  ])};
}

test('two-field strict semantic batch remains one undo frame and admits analytic hole after archive replay',()=>{
  const original=documentWithDimensions(60), before=serializeProject(original);
  const proposal=previewDimensionEditBatch(original,request(original));
  assert.equal(proposal.events.length,2);
  assert.equal(proposal.editedFeatureGates[0].status,'bound');
  assert.equal(proposal.editedFeatureGates[0].resolvedPayload.widthMm,60);
  assert.equal(proposal.editedFeatureGates[0].resolvedPayload.depthMm,40);
  assert.equal(serializeProject(original),before);
  let history=commitUndoableDimensionEditBatch(startUndoHistory(original),request(original));
  assert.equal(history.undoStack.length,1);
  assert.equal(history.undoStack[0].length,2);
  assert.deepEqual(featuresOf(history.document).find(f=>f.id==='plate').dependsOn,
    ['p.width','p.depth']);
  assert.equal(featuresOf(history.document).find(f=>f.id==='plate').payload.widthMm,120);
  assert.deepEqual(planProject(history.document).executableOrder,
    ['p.width','p.depth','plate']);
  const saved=serializeModelArchive(createModelArchive(history));
  history=deserializeModelArchive(saved).history;
  assert.equal(serializeModelArchive(createModelArchive(history)),saved);
  assert.equal(classifyDerivedPlate(history.document).check.status,'verified');
  history=undoTransaction(history,['undo.batch.depth','undo.batch.width']);
  assert.equal(gate(history.document).status,'admissible');
  assert.deepEqual(featuresOf(history.document).find(f=>f.id==='plate').dependsOn,[]);
  history=redoTransaction(history,['redo.batch.width','redo.batch.depth']);
  assert.equal(classifyDerivedPlate(history.document).check.status,'verified');
  assert.equal(featuresOf(history.document).find(f=>f.id==='plate').id,'plate');
});

test('strictly bound numeric dimensions cannot promote a circle crossing into valid profile geometry',()=>{
  const original=documentWithDimensions(28);
  const edited=commitUndoableDimensionEditBatch(startUndoHistory(original),request(original));
  const derived=gate(edited.document);
  assert.equal(derived.status,'bound');
  assert.equal(derived.resolvedPayload.widthMm,28);
  const result=classifyDerivedPlate(edited.document);
  assert.equal(result.kind,'planar_only');
  assert.equal(result.check.status,'rejected');
  assert.equal(result.check.reason,'circle_touches_or_crosses_boundary:hole');
  const reopened=deserializeModelArchive(
    serializeModelArchive(createModelArchive(edited)));
  assert.deepEqual(classifyDerivedPlate(reopened.history.document),result);
  assert.equal(featuresOf(reopened.history.document).find(f=>f.id==='plate').payload.widthMm,120);
});

test('tiny encoded contact is rejected even if ordinary scalar binding is valid',()=>{
  const doc=documentWithDimensions(60);
  const result=commitUndoableDimensionEditBatch(startUndoHistory(doc),request(doc));
  const {widthMm,depthMm}=gate(result.document).resolvedPayload;
  const t=1e-170;
  const outer=[{x:0,y:0},{x:t,y:t},{x:widthMm,y:0},
    {x:widthMm,y:depthMm},{x:0,y:depthMm}];
  assert.equal(t*t,0); // former floating segment denominator underflow
  const unsafe=assessCircularProfile(outer,[{id:'tiny',x:t/2,y:t/2,radius:t/10}]);
  assert.equal(unsafe.status,'rejected');
  assert.equal(unsafe.reason,'circle_touches_or_crosses_boundary:tiny');
  assert.equal(assessCircularProfile(outer,[{id:'safe',x:24,y:20,radius:6}]).status,
    'verified');
});

test('permissive future-target batch retains pending semantics without numeric fallback',()=>{
  const doc=commitEvent(newProject('integration.batch.pending'),
    create('create.plate',plate()));
  const pending=previewDimensionEditBatch(doc,{
    ...request(doc,'permit_unresolved'),
  });
  assert.deepEqual(pending.editedFeatureGates.map(g=>g.status),['unready']);
  assert.equal(pending.editedFeatureGates[0].resolvedPayload,null);
  assert.deepEqual(featuresOf(pending.document).find(f=>f.id==='plate').dependsOn,
    ['p.width','p.depth']);
  assert.deepEqual(classifyDerivedPlate(pending.document),
    {kind:'pending',reason:'unready'});
  assert.equal(serializeProject(doc),serializeProject(commitEvent(
    newProject('integration.batch.pending'),create('create.plate',plate()))));
});
