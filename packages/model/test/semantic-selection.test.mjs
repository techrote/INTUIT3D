import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newProject, commitEvent, featuresOf, planProject, serializeProject, deserializeProject,
  ProjectRevisionError, ProjectFormatError,
} from '../src/index.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction,
  serializeUndoHistory, deserializeUndoHistory,
} from '../src/transactions.ts';
import {TOPOLOGY_REFERENCE_FORMAT} from '../src/topology.ts';
import {
  SEMANTIC_SELECTION_EDIT_FORMAT, SEMANTIC_SELECTION_RECOVERY_FORMAT,
  previewSemanticSelectionEdit, commitUndoableSemanticSelectionEdit,
  assessSemanticSelection, previewSemanticSelectionRecovery,
  commitUndoableSemanticSelectionRecovery,
} from '../src/semantic-selection.ts';

const role=(roleId,featureId='feature.plate')=>({featureId,roleId,kind:'face'});
const original=role('face.top'), left=role('face.top.left'),right=role('face.top.right');
const ref=(atRevision=1,anchor=original,projectId='project.plate')=>({
  format:TOPOLOGY_REFERENCE_FORMAT,version:1,projectId,atRevision,anchor,
});
const row=(from,to,confidence='observed')=>({from,to,confidence});
const step=(fromRevision,mappings,coverage='complete')=>({
  projectId:'project.plate',fromRevision,toRevision:fromRevision+1,
  coverage,mappings,
});
const snapshot=(atRevision=1,observedRoles=[original])=>({
  projectId:'project.plate',atRevision,observedRoles,
});
function plate() {
  let doc=newProject('project.plate');
  doc=commitEvent(doc,{eventId:'event.plate',type:'feature.create',
    feature:{id:'feature.plate',kind:'extrude',dependsOn:[],
      writeTargets:['body.plate'],payload:{widthMm:120,heightMm:80,thicknessMm:8}}});
  doc=commitEvent(doc,{eventId:'event.cut',type:'feature.create',
    feature:{id:'feature.cut',kind:'cut',dependsOn:['feature.plate'],
      writeTargets:['body.plate'],payload:{holeRadiusMm:5}}});
  return doc;
}
const edit=(doc,eventId='event.select',reference=ref(),admission='require_ready')=>({
  format:SEMANTIC_SELECTION_EDIT_FORMAT,version:1,eventId,
  featureId:'feature.cut',field:'selectedFace',expectedRevision:doc.revision,
  reference,admission,
});
const trace=[step(1,[row([original],[original])]),
  step(2,[row([original],[left,right])])];
const recovery=(doc,eventId='event.resolve',selected=left)=>({
  format:SEMANTIC_SELECTION_RECOVERY_FORMAT,version:1,eventId,
  featureId:'feature.cut',field:'selectedFace',expectedRevision:doc.revision,
  snapshot:snapshot(),steps:trace,selected,admission:'require_ready',
});

test('actual plate/cut target is versioned journal intent with dependency-aware partial rebuild',()=>{
  let doc=plate();
  doc=commitEvent(doc,{eventId:'event.measure',type:'feature.create',
    feature:{id:'feature.measure',kind:'measure',dependsOn:['feature.cut'],
      writeTargets:[],payload:{label:'volume'}}});
  const preview=previewSemanticSelectionEdit(doc,edit(doc));
  assert.equal(preview.featureStatus,'ready');
  assert.deepEqual(preview.invalidation.changedFeatureIds,['feature.cut']);
  assert.deepEqual(preview.invalidation.invalidatedFeatureIds,['feature.cut','feature.measure']);
  assert.deepEqual(preview.invalidation.unchangedReady,['feature.plate']);
  assert.deepEqual(preview.invalidation.readyToEvaluate,['feature.cut','feature.measure']);
  assert.deepEqual(planProject(preview.document).executableOrder,
    ['feature.plate','feature.cut','feature.measure']);
  assert.deepEqual(featuresOf(preview.document).find(f=>f.id==='feature.cut').payload.selectedFace,ref());
  assert.equal(JSON.stringify(preview.document).includes('observedRoles'),false);
});

test('split/merge evidence produces repairable target, not arbitrary first face',()=>{
  const doc=previewSemanticSelectionEdit(plate(),edit(plate())).document;
  const result=assessSemanticSelection(doc,'feature.cut','selectedFace',
    {snapshot:snapshot(),steps:trace});
  assert.equal(result.status,'requires_reconciliation');
  assert.deepEqual(result.resolution.candidates,[left,right]);
  assert.ok(result.diagnosticCodes.includes('SPLIT'));
  assert.equal(assessSemanticSelection(doc,'feature.cut','selectedFace').status,'pending_evidence');
  assert.equal(assessSemanticSelection(plate(),'feature.cut','selectedFace').status,'unselected');
});

test('explicit user re-anchor survives undo, redo, archive and later provider observation',()=>{
  let history=startUndoHistory(plate());
  history=commitUndoableSemanticSelectionEdit(history,edit(history.document));
  assert.equal(history.document.revision,3);
  const preview=previewSemanticSelectionRecovery(history.document,recovery(history.document));
  assert.deepEqual(preview.reference,ref(3,left));
  history=commitUndoableSemanticSelectionRecovery(history,recovery(history.document));
  assert.equal(history.document.revision,4);
  const reopened=deserializeUndoHistory(serializeUndoHistory(history));
  assert.deepEqual(featuresOf(reopened.document).find(f=>f.id==='feature.cut').payload.selectedFace,ref(3,left));
  assert.equal(assessSemanticSelection(reopened.document,'feature.cut','selectedFace').status,
    'pending_evidence');
  const report=assessSemanticSelection(reopened.document,'feature.cut','selectedFace',{
    snapshot:snapshot(3,[left]),steps:[step(3,[row([left],[left])])]});
  assert.equal(report.status,'candidate');
  assert.deepEqual(report.resolution.candidates,[left]);
  history=undoTransaction(reopened,['event.undo']);
  assert.deepEqual(featuresOf(history.document).find(f=>f.id==='feature.cut').payload.selectedFace,ref());
  history=redoTransaction(history,['event.redo']);
  assert.deepEqual(featuresOf(history.document).find(f=>f.id==='feature.cut').payload.selectedFace,ref(3,left));
  assert.deepEqual(featuresOf(history.document).map(f=>f.id),['feature.plate','feature.cut']);
  const restored=deserializeProject(serializeProject(history.document));
  assert.deepEqual(featuresOf(restored).find(f=>f.id==='feature.cut').payload.selectedFace,ref(3,left));
  assert.equal(planProject(restored).features.find(f=>f.feature.id==='feature.cut').status,'ready');
});

test('unknown future reference preserves pending authored cut, recovers when feature appears',()=>{
  let doc=newProject('project.plate');
  doc=commitEvent(doc,{eventId:'event.cut',type:'feature.create',
    feature:{id:'feature.cut',kind:'cut',dependsOn:[],writeTargets:['body.future'],payload:{}}});
  const future=edit(doc,'event.pending',ref(1,role('face.top','feature.future')),'permit_pending');
  const preview=previewSemanticSelectionEdit(doc,future);
  assert.equal(preview.featureStatus,'pending');
  assert.deepEqual(featuresOf(preview.document)[0].dependsOn,['feature.future']);
  assert.equal(assessSemanticSelection(preview.document,'feature.cut','selectedFace').status,'pending_model');
  assert.throws(()=>previewSemanticSelectionEdit(doc,{...future,admission:'require_ready'}),ProjectFormatError);
  doc=commitEvent(preview.document,{eventId:'event.future',type:'feature.create',
    feature:{id:'feature.future',kind:'extrude',dependsOn:[],
      writeTargets:['body.future2'],payload:{widthMm:120}}});
  assert.equal(planProject(doc).features.find(f=>f.feature.id==='feature.cut').status,'ready');
  assert.equal(assessSemanticSelection(doc,'feature.cut','selectedFace').status,'pending_evidence');
});

test('recovery refuses unobserved candidate, incomplete evidence, wrong project and stale revision',()=>{
  const doc=previewSemanticSelectionEdit(plate(),edit(plate())).document;
  assert.throws(()=>previewSemanticSelectionRecovery(doc,recovery(doc,'event.no',role('face.absent'))),ProjectFormatError);
  assert.throws(()=>previewSemanticSelectionRecovery(doc,{
    ...recovery(doc,'event.missing'),steps:trace.slice(0,1)}));
  assert.throws(()=>previewSemanticSelectionRecovery(doc,{
    ...recovery(doc,'event.stale'),expectedRevision:2}),ProjectRevisionError);
  assert.throws(()=>previewSemanticSelectionEdit(doc,{
    ...edit(doc,'event.wrong',ref(1,original,'other.project'))}),ProjectFormatError);
  assert.throws(()=>assessSemanticSelection(doc,'feature.cut','selectedFace',{
    snapshot:snapshot(1,[]),steps:trace}),Error);
  assert.equal(featuresOf(doc).find(f=>f.id==='feature.cut').payload.selectedFace.format,
    TOPOLOGY_REFERENCE_FORMAT);
});

test('intent edit does not overwrite unrelated payload or discard independently authored dependencies',()=>{
  let doc=plate();
  doc=commitEvent(doc,{eventId:'event.extra',type:'feature.create',
    feature:{id:'feature.extra',kind:'sketch',dependsOn:[],writeTargets:[],payload:{}}});
  doc=commitEvent(doc,{eventId:'event.dependency',type:'feature.edit',featureId:'feature.cut',
    patch:{dependsOn:['feature.plate','feature.extra']}});
  const selected=previewSemanticSelectionEdit(doc,edit(doc)).document;
  assert.deepEqual(featuresOf(selected).find(f=>f.id==='feature.cut').dependsOn,
    ['feature.plate','feature.extra']);
  assert.equal(featuresOf(selected).find(f=>f.id==='feature.cut').payload.holeRadiusMm,5);
  const altered=commitEvent(doc,{eventId:'event.other',type:'feature.edit',featureId:'feature.cut',
    patch:{payload:{selectedFace:'old-local-index'}}});
  assert.throws(()=>previewSemanticSelectionEdit(altered,edit(altered)),Error);
});

test('source at impossible revision and self-selection cannot pass as a valid face',()=>{
  const doc=plate();
  assert.throws(()=>previewSemanticSelectionEdit(doc,edit(doc,'event.future',ref(3))),ProjectFormatError);
  assert.throws(()=>previewSemanticSelectionEdit(doc,edit(doc,'event.self',
    ref(2,role('face.self','feature.cut')))),ProjectFormatError);
  assert.throws(()=>previewSemanticSelectionEdit(doc,{
    ...edit(doc,'event.field'),field:'__proto__'}),ProjectFormatError);
  assert.throws(()=>previewSemanticSelectionEdit(doc,{
    ...edit(doc,'event.bad'),reference:{...ref(),anchor:{...original,roleId:'face#transient'}}}),Error);
});

test('parameter change after selection requires new provider trace; no cached exact evidence',()=>{
  let doc=previewSemanticSelectionEdit(plate(),edit(plate())).document; // rev3
  doc=commitEvent(doc,{eventId:'event.edit-thickness',type:'feature.edit',
    featureId:'feature.plate',patch:{payload:{widthMm:120,heightMm:80,thicknessMm:12}}});
  const report=assessSemanticSelection(doc,'feature.cut','selectedFace',{
    snapshot:snapshot(),steps:trace});
  assert.equal(report.status,'pending_evidence');
  assert.ok(report.diagnosticCodes.includes('MISSING_STEP'));
  assert.equal(featuresOf(doc).find(f=>f.id==='feature.plate').payload.thicknessMm,12);
});
