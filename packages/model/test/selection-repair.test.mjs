import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {newProject, commitEvent, featuresOf, ProjectFormatError, ProjectRevisionError} from '../src/index.ts';
import {startUndoHistory, undoTransaction, redoTransaction} from '../src/transactions.ts';
import {createModelArchive, serializeModelArchive, deserializeModelArchive} from '../src/archive.ts';
import {SEMANTIC_SELECTION_EDIT_FORMAT, commitUndoableSemanticSelectionEdit} from '../src/semantic-selection.ts';
import {TOPOLOGY_REFERENCE_FORMAT} from '../src/topology.ts';
import {SELECTION_EVIDENCE_FORMAT, inspectSelectionInventory} from '../src/selection-inventory.ts';
import {
  SELECTION_REPAIR_FORMAT, previewSelectionRepairBatch, commitUndoableSelectionRepairBatch,
} from '../src/selection-repair.ts';

const projectId='project.plate';
const face={kind:'face',featureId:'feature.extrude',roleId:'face.top'};
const left={...face,roleId:'face.top.left'};
const right={...face,roleId:'face.top.right'};
const edge={kind:'edge',featureId:'feature.extrude',roleId:'edge.side'};
const replacement={...edge,roleId:'edge.new'};
const ref=(anchor)=>({
  format:TOPOLOGY_REFERENCE_FORMAT,version:1,projectId,atRevision:2,anchor,
});
function step(n,anchor,to){
  return {projectId,fromRevision:n,toRevision:n+1,coverage:'complete',
    mappings:[{from:[anchor],to,confidence:'observed'}]};
}
function makeFixture(){
  let doc=newProject(projectId);
  doc=commitEvent(doc,{eventId:'event.sketch',type:'feature.create',
    feature:{id:'feature.sketch',kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{widthMm:120,heightMm:80,holes:[{x:-30,y:0,radiusMm:5},{x:30,y:0,radiusMm:5}]}}});
  doc=commitEvent(doc,{eventId:'event.extrude',type:'feature.create',
    feature:{id:'feature.extrude',kind:'extrude',dependsOn:['feature.sketch'],
      writeTargets:['body.plate'],payload:{thicknessMm:8}}});
  doc=commitEvent(doc,{eventId:'event.cut',type:'feature.create',
    feature:{id:'feature.cut',kind:'cut',dependsOn:['feature.extrude'],
      writeTargets:['body.plate'],payload:{holeCount:2}}});
  doc=commitEvent(doc,{eventId:'event.measure',type:'feature.create',
    feature:{id:'feature.measure',kind:'measure',dependsOn:['feature.cut'],
      writeTargets:[],payload:{label:'right-wall'}}});
  let session=startUndoHistory(doc);
  for(const [featureId,field,anchor,eventId] of [
    ['feature.cut','sourceFace',face,'event.select-face'],
    ['feature.measure','sourceEdge',edge,'event.select-edge'],
  ]){
    session=commitUndoableSemanticSelectionEdit(session,{
      format:SEMANTIC_SELECTION_EDIT_FORMAT,version:1,eventId,featureId,field,
      expectedRevision:session.document.revision,reference:ref(anchor),
      admission:'require_ready',
    });
  }
  // Change an early dimension; the source IDs are stable but the physical
  // face/edge topology requires fresh provider reports.
  const edited=commitEvent(session.document,{eventId:'event.thickness',type:'feature.edit',
    featureId:'feature.extrude',patch:{payload:{thicknessMm:12}}});
  return startUndoHistory(edited);
}
function receipt(doc,featureId,field,anchor,final){
  const steps=[];
  for(let n=2;n<doc.revision;n++) steps.push(step(n,anchor,n===doc.revision-1?final:[anchor]));
  return {format:SELECTION_EVIDENCE_FORMAT,version:1,projectId,
    revision:doc.revision,featureId,field,reference:ref(anchor),
    provider:'deterministic_fixture',
    snapshot:{projectId,atRevision:2,observedRoles:[anchor]},steps};
}
function evidence(doc){
  return [receipt(doc,'feature.cut','sourceFace',face,[left,right]),
    receipt(doc,'feature.measure','sourceEdge',edge,[])];
}
const replacementObservation=(doc)=>({
  provider:'deterministic_fixture',
  snapshot:{projectId,atRevision:doc.revision,observedRoles:[replacement]},
});
function request(doc){
  return {format:SELECTION_REPAIR_FORMAT,version:1,expectedRevision:doc.revision,
    admission:'require_ready',
    repairs:[
      {eventId:'event.repair-face',featureId:'feature.cut',field:'sourceFace',selected:right},
      {eventId:'event.repair-edge',featureId:'feature.measure',field:'sourceEdge',
        selected:replacement,replacementObservation:replacementObservation(doc)},
    ]};
}
function targets(doc){
  const features=featuresOf(doc);
  return [features.find(f=>f.id==='feature.cut').payload.sourceFace.anchor,
    features.find(f=>f.id==='feature.measure').payload.sourceEdge.anchor];
}

test('split and deleted references are offered as explicit, distinct repair actions',()=>{
  const doc=makeFixture().document;
  assert.equal(doc.revision,7);
  const inv=inspectSelectionInventory(doc,evidence(doc));
  assert.deepEqual(inv.selections.map(x=>x.action),
    ['choose_successor','replace_deleted_reference']);
  assert.deepEqual(inv.selections[0].recoveryCandidates,[left,right]);
  assert.deepEqual(inv.needsUserRecovery,['feature.cut.sourceFace','feature.measure.sourceEdge']);
  assert.deepEqual(targets(doc),[face,edge]);
});

test('one atomic repair updates partial rebuild and preserves untouched semantic body',()=>{
  const session=makeFixture(),doc=session.document;
  const preview=previewSelectionRepairBatch(doc,request(doc),evidence(doc));
  assert.equal(preview.document.revision,9);
  assert.equal(preview.events.length,2);
  assert.deepEqual(preview.repaired.map(x=>x.previousStatus),
    ['requires_reconciliation','deleted']);
  assert.deepEqual(preview.invalidation.unchangedReady,
    ['feature.sketch','feature.extrude']);
  assert.deepEqual(preview.invalidation.readyToEvaluate,['feature.cut','feature.measure']);
  assert.deepEqual(targets(preview.document),[right,replacement]);
  assert.equal(featuresOf(preview.document).find(f=>f.id==='feature.extrude').writeTargets[0],
    'body.plate');
  assert.equal(preview.exactGeometryAuthority,false);
  assert.equal(JSON.stringify(preview.document).includes('deterministic_fixture'),false);
});

test('repair is one undo frame, survives archive reopen/undo/redo and needs fresh evidence',()=>{
  let session=makeFixture(),doc=session.document;
  session=commitUndoableSelectionRepairBatch(session,request(doc),evidence(doc));
  assert.equal(session.undoStack.length,1);
  const reopened=deserializeModelArchive(serializeModelArchive(createModelArchive(session)));
  session=reopened.history;
  assert.deepEqual(targets(session.document),[right,replacement]);
  assert.deepEqual(targets(session.document).map(x=>x.featureId),
    ['feature.extrude','feature.extrude']);
  assert.deepEqual(inspectSelectionInventory(session.document).selections.map(x=>x.status),
    ['pending_evidence','pending_evidence']);
  session=undoTransaction(session,['event.undo-edge','event.undo-face']);
  assert.deepEqual(targets(session.document),[face,edge]);
  session=redoTransaction(session,['event.redo-face','event.redo-edge']);
  assert.deepEqual(targets(session.document),[right,replacement]);
  assert.equal(featuresOf(session.document).find(f=>f.id==='feature.extrude').payload.thicknessMm,12);
  assert.equal(session.document.revision,13);
});

test('stale/unknown/unobserved choices reject the entire batch with no partial mutation',()=>{
  const session=makeFixture(),doc=session.document,original=JSON.stringify(doc);
  const good=request(doc),reports=evidence(doc);
  assert.throws(()=>previewSelectionRepairBatch(doc,{...good,expectedRevision:doc.revision-1},reports),
    ProjectRevisionError);
  assert.throws(()=>previewSelectionRepairBatch(doc,good,[reports[0]]),ProjectFormatError);
  assert.throws(()=>previewSelectionRepairBatch(doc,{
    ...good,repairs:[{...good.repairs[0],selected:edge},good.repairs[1]]},reports),
  ProjectFormatError);
  assert.throws(()=>previewSelectionRepairBatch(doc,{
    ...good,repairs:[good.repairs[0],{
      ...good.repairs[1],replacementObservation:{provider:'deterministic_fixture',
        snapshot:{projectId,atRevision:doc.revision,observedRoles:[edge]}}}]},reports),
  ProjectFormatError);
  assert.throws(()=>previewSelectionRepairBatch(doc,{
    ...good,repairs:[good.repairs[0],{
      ...good.repairs[1],selected:{...replacement,featureId:'feature.missing'}}]},reports),
  ProjectFormatError);
  assert.throws(()=>previewSelectionRepairBatch(doc,{
    ...good,repairs:[good.repairs[0],good.repairs[0]]},reports),ProjectFormatError);
  assert.equal(JSON.stringify(doc),original);
  assert.deepEqual(targets(session.document),[face,edge]);
});

test('authoritative model operation stays distinct from exact geometry/STEP status',()=>{
  const doc=makeFixture().document;
  const report=previewSelectionRepairBatch(doc,request(doc),evidence(doc));
  assert.equal(report.exactGeometryAuthority,false);
  assert.equal(report.document.journal.filter(x=>x.type==='feature.edit').length,5);
  assert.equal(JSON.stringify(report.document).includes('observedRoles'),false);
});

test('standalone user workflow example runs',()=>{
  const file=fileURLToPath(new URL('../examples/repair-plate-selections.mjs',import.meta.url));
  const result=spawnSync(process.execPath,['--experimental-strip-types',file],
    {encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr || result.stdout);
  const report=JSON.parse(result.stdout.trim());
  assert.equal(report.format,'intuit3d.selection-repair-demo');
  assert.equal(report.thicknessMm,12);
  assert.equal(report.stableBodyId,'body.plate');
  assert.deepEqual(report.repairActions,['choose_successor','replace_deleted_reference']);
  assert.equal(report.afterReopen,'pending_evidence');
  assert.equal(report.undoRestoredFace,'face.top');
  assert.equal(report.exactGeometryAuthority,false);
});
