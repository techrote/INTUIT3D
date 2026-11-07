import assert from 'node:assert/strict';
import test from 'node:test';
import {newProject, commitEvent, featuresOf, planProject,
  serializeProject, deserializeProject, ProjectRevisionError, ProjectFormatError} from '../src/index.ts';
import {planIncrementalEvaluation} from '../src/incremental.ts';
import {startUndoHistory, undoTransaction, redoTransaction,
  serializeUndoHistory, deserializeUndoHistory} from '../src/transactions.ts';
import {TOPOLOGY_REFERENCE_FORMAT} from '../src/topology.ts';
import {SEMANTIC_SELECTION_EDIT_FORMAT, SEMANTIC_SELECTION_RECOVERY_FORMAT,
  commitUndoableSemanticSelectionEdit, commitUndoableSemanticSelectionRecovery} from '../src/semantic-selection.ts';
import {SELECTION_EVIDENCE_FORMAT, SELECTION_INVENTORY_FORMAT,
  inspectSelectionInventory} from '../src/selection-inventory.ts';

const projectId='project.plate';
const face={featureId:'feature.extrude',roleId:'face.top',kind:'face'};
const body={featureId:'feature.extrude',roleId:'body.plate',kind:'body'};
const left={...face,roleId:'face.top.left'};
const right={...face,roleId:'face.top.right'};
const ref=(anchor)=>({format:TOPOLOGY_REFERENCE_FORMAT,version:1,
  projectId,atRevision:2,anchor});
const makeStep=(n,source,targets)=>({
  projectId,fromRevision:n,toRevision:n+1,coverage:'complete',
  mappings:[{from:[source],to:targets,confidence:'observed'}],
});
function initial() {
  let doc=newProject(projectId);
  doc=commitEvent(doc,{eventId:'event.sketch',type:'feature.create',
    feature:{id:'feature.sketch',kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{widthMm:120,depthMm:80,holes:[{x:-30,y:0,radius:5},{x:30,y:0,radius:5}]}}});
  doc=commitEvent(doc,{eventId:'event.extrude',type:'feature.create',
    feature:{id:'feature.extrude',kind:'extrude',dependsOn:['feature.sketch'],
      writeTargets:['body.plate'],payload:{thicknessMm:8}}});
  doc=commitEvent(doc,{eventId:'event.cut',type:'feature.create',
    feature:{id:'feature.cut',kind:'cut',dependsOn:['feature.extrude'],
      writeTargets:['body.plate'],payload:{holeCount:2}}});
  doc=commitEvent(doc,{eventId:'event.measure',type:'feature.create',
    feature:{id:'feature.measure',kind:'measure',dependsOn:['feature.cut'],
      writeTargets:[],payload:{label:'plate'}}});
  return doc;
}
function select(history,featureId,field,anchor,eventId) {
  return commitUndoableSemanticSelectionEdit(history,{
    format:SEMANTIC_SELECTION_EDIT_FORMAT,version:1,eventId,featureId,field,
    expectedRevision:history.document.revision,reference:ref(anchor),admission:'require_ready',
  });
}
function selectedHistory(){
  let history=startUndoHistory(initial());
  history=select(history,'feature.cut','sourceFace',face,'event.select-face');
  history=select(history,'feature.measure','sourceBody',body,'event.select-body');
  return history;
}
function receipt(doc,featureId,field,anchor,{split=false,provider='deterministic_fixture'}={}) {
  const steps=[];
  for(let n=2;n<doc.revision;n++){
    steps.push(makeStep(n,anchor,split&&n===doc.revision-1?[left,right]:[anchor]));
  }
  return {
    format:SELECTION_EVIDENCE_FORMAT,version:1,projectId,revision:doc.revision,
    featureId,field,reference:ref(anchor),provider,
    snapshot:{projectId,atRevision:2,observedRoles:[anchor]},steps,
  };
}
const faceReceipt=(doc,opts)=>receipt(doc,'feature.cut','sourceFace',face,opts);
const bodyReceipt=(doc,opts)=>receipt(doc,'feature.measure','sourceBody',body,opts);

test('project inventory exposes stable, authored face/body targets and explicit missing evidence',()=>{
  const history=selectedHistory(),doc=history.document;
  const before=structuredClone(doc);
  const missing=inspectSelectionInventory(doc);
  assert.equal(missing.format,SELECTION_INVENTORY_FORMAT);
  assert.equal(missing.revision,6);
  assert.deepEqual(missing.awaitingProvider,
    ['feature.cut.sourceFace','feature.measure.sourceBody']);
  assert.equal(missing.exactGeometryAuthority,false);
  assert.equal(missing.allReferencesObserved,false);
  const reported=inspectSelectionInventory(doc,[faceReceipt(doc),bodyReceipt(doc)]);
  assert.deepEqual(reported.selections.map(s=>s.status),['candidate','candidate']);
  assert.deepEqual(reported.selections.map(s=>s.provisionalTarget),[face,body]);
  assert.equal(reported.allReferencesObserved,true);
  assert.equal(reported.exactGeometryAuthority,false);
  assert.equal(reported.selections[0].observedProvider,'deterministic_fixture');
  assert.deepEqual(doc,before,'inspection must never mutate the source journal');
  assert.equal(serializeProject(doc).includes('intuit3d.selection-evidence'),false);
});

test('retrospective thickness edit invalidates affected branch while preserving semantic body ID',()=>{
  const previous=selectedHistory().document;
  const revised=commitEvent(previous,{eventId:'event.thickness',type:'feature.edit',
    featureId:'feature.extrude',patch:{payload:{thicknessMm:12}}});
  const invalidation=planIncrementalEvaluation(previous,revised);
  assert.deepEqual(invalidation.unchangedReady,['feature.sketch']);
  assert.deepEqual(invalidation.readyToEvaluate,
    ['feature.extrude','feature.cut','feature.measure']);
  assert.equal(featuresOf(revised).find(f=>f.id==='feature.extrude').writeTargets[0],'body.plate');
  assert.throws(()=>inspectSelectionInventory(revised,
    [faceReceipt(previous),bodyReceipt(previous)]),ProjectRevisionError);
  const observed=inspectSelectionInventory(revised,[
    faceReceipt(revised,{split:true}),bodyReceipt(revised,{provider:'experimental_native'}),
  ]);
  assert.deepEqual(observed.needsUserRecovery,['feature.cut.sourceFace']);
  assert.deepEqual(observed.selections.map(s=>s.status),
    ['requires_reconciliation','candidate']);
  assert.deepEqual(observed.selections[0].recoveryCandidates,[left,right]);
  assert.deepEqual(observed.selections[1].provisionalTarget,body);
  assert.equal(observed.selections[1].observedProvider,'experimental_native');
  assert.equal(observed.allReferencesObserved,false);
});

test('explicit face recovery persists through undo/redo/archive; provider proof is never persisted',()=>{
  let history=selectedHistory();
  const old=history.document;
  history=importThicknessChange(history);
  const provider=faceReceipt(history.document,{split:true});
  history=commitUndoableSemanticSelectionRecovery(history,{
    format:SEMANTIC_SELECTION_RECOVERY_FORMAT,version:1,eventId:'event.choose-left',
    featureId:'feature.cut',field:'sourceFace',expectedRevision:history.document.revision,
    snapshot:provider.snapshot,steps:provider.steps,selected:left,admission:'require_ready',
  });
  assert.equal(history.document.revision,8);
  const reopened=deserializeUndoHistory(serializeUndoHistory(history));
  const stored=featuresOf(reopened.document).find(f=>f.id==='feature.cut').payload.sourceFace;
  assert.equal(stored.atRevision,7);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.anchor)),left);
  const pending=inspectSelectionInventory(deserializeProject(serializeProject(reopened.document)));
  assert.deepEqual(pending.selections.map(s=>s.status),['pending_evidence','pending_evidence']);
  history=undoTransaction(reopened,['event.undo-choice']);
  assert.deepEqual(JSON.parse(JSON.stringify(featuresOf(history.document).find(f=>f.id==='feature.cut').payload.sourceFace.anchor)),face);
  history=redoTransaction(history,['event.redo-choice']);
  assert.deepEqual(JSON.parse(JSON.stringify(featuresOf(history.document).find(f=>f.id==='feature.cut').payload.sourceFace.anchor)),left);
  assert.equal(featuresOf(history.document).find(f=>f.id==='feature.measure').payload.sourceBody.anchor.roleId,
    'body.plate');
  assert.equal(planProject(history.document).features.every(s=>s.status==='ready'),true);
  assert.equal(old.revision,6);
});
function importThicknessChange(history){
  const doc=history.document;
  // One ordinary journal event still preserves the entire undo history.
  const next=commitEvent(doc,{eventId:'event.thickness',type:'feature.edit',
    featureId:'feature.extrude',patch:{payload:{thicknessMm:12}}});
  return startUndoHistory(next);
}

test('receipt collision, stale/replaced reference, wrong project and foreign target are rejected',()=>{
  const doc=selectedHistory().document;
  const a=faceReceipt(doc);
  assert.throws(()=>inspectSelectionInventory(doc,[a,a]),ProjectFormatError);
  assert.throws(()=>inspectSelectionInventory(doc,[{...a,projectId:'project.other'}]),ProjectRevisionError);
  assert.throws(()=>inspectSelectionInventory(doc,[{...a,reference:ref(right)}]),ProjectRevisionError);
  assert.throws(()=>inspectSelectionInventory(doc,[{...a,field:'missing'}]),ProjectFormatError);
  assert.throws(()=>inspectSelectionInventory(doc,[{...a,provider:'independent_certified'}]),ProjectFormatError);
  const incomplete=inspectSelectionInventory(doc,[{...a,steps:a.steps.slice(1)}]);
  assert.equal(incomplete.selections[0].status,'pending_evidence');
  assert.ok(incomplete.selections[0].diagnosticCodes.includes('MISSING_STEP'));
});

test('authored body reference cannot impersonate a non-owned semantic output',()=>{
  const doc=initial();
  const history=select(startUndoHistory(doc),'feature.measure','sourceBody',
    {...body,roleId:'body.other'},'event.invalid-body');
  assert.throws(()=>inspectSelectionInventory(history.document),ProjectFormatError);
});

test('missing provider evidence is not inferred from compatible names after save/reopen',()=>{
  const doc=selectedHistory().document;
  const reopened=deserializeProject(serializeProject(doc));
  assert.deepEqual(inspectSelectionInventory(reopened).selections.map(s=>s.action),
    ['await_provider','await_provider']);
  const unrelated=commitEvent(reopened,{eventId:'event.annotation',type:'feature.create',
    feature:{id:'feature.annotation',kind:'annotation',dependsOn:[],
      writeTargets:[],payload:{text:'unrelated'}}});
  assert.deepEqual(inspectSelectionInventory(unrelated).selections.map(s=>s.status),
    ['pending_evidence','pending_evidence']);
});

test('public runnable plate-and-holes recovery example executes without geometry overclaims',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const file=fileURLToPath(new URL('../examples/selection-inventory.mjs',import.meta.url));
  const result=spawnSync(process.execPath,['--experimental-strip-types',file],
    {encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr || result.stdout);
  const report=JSON.parse(result.stdout.trim());
  assert.equal(report.format,'intuit3d.semantic-selection-inventory-demo');
  assert.equal(report.thicknessMm,12);
  assert.equal(report.bodyId,'body.plate');
  assert.equal(report.selectedFaceRoleId,'face.top.right');
  assert.deepEqual(report.repairCandidates,['face.top.left','face.top.right']);
  assert.deepEqual(report.postReopenStatus,['pending_evidence','pending_evidence']);
  assert.deepEqual(report.changedBranch,['feature.extrude','feature.cut','feature.measure']);
  assert.equal(report.exactGeometryAuthority,false);
});
