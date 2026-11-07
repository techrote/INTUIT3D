import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newProject, featuresOf, ProjectFormatError, ProjectRevisionError,
} from '../src/index.ts';
import {
  startUndoHistory, commitUndoableTransaction, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import {
  PARAMETER_FORMULA_TABLE_FORMAT, commitUndoableParameterFormulaTableEdit,
} from '../src/parameter-formula-table.ts';
import { inspectParameterSheet, parameterSheetRequest } from '../src/parameter-sheet.ts';
import {
  rebaseParameterSheetEdit, PARAMETER_SHEET_REBASE_FORMAT,
} from '../src/parameter-sheet-rebase.ts';
import { runParameterSheetRebasePlate } from '../examples/parameter-sheet-rebase-plate.mjs';

const literal = value => ({op:'literal',value,unit:'mm'});
const ref = featureId => ({op:'ref',featureId});
const create = (eventId,feature) => ({eventId,type:'feature.create',feature});
const param = (id,name,value) => create('create.'+id,{
  id,kind:'parameter',dependsOn:[],writeTargets:[],
  payload:{parameter:{name,unit:'mm',expression:literal(value)}},
});
function setup() {
  return commitUndoableTransaction(startUndoHistory(newProject('sheet.rebase.plate')),[
    param('p.width','width',8),
    param('p.offset','offset',16),
    param('p.margin','margin',4),
    create('create.extrude',{id:'extrude',kind:'extrude',
      dependsOn:['p.width'],writeTargets:['body.plate'],
      payload:{thicknessMm:8,
        dimensionBindings:{format:'intuit3d.dimension-bindings',version:1,
          entries:[{field:'thicknessMm',unit:'mm',expression:ref('p.width')}]}}}),
    create('create.cut',{id:'cut',kind:'cut',
      dependsOn:['extrude','p.offset'],writeTargets:['body.plate'],
      payload:{targetBodyId:'body.plate',holeOffsetMm:16,
        dimensionBindings:{format:'intuit3d.dimension-bindings',version:1,
          entries:[{field:'holeOffsetMm',unit:'mm',expression:ref('p.offset')}]}}}),
    create('create.spacer',{id:'spacer',kind:'extrude',
      dependsOn:[],writeTargets:['body.spacer'],payload:{thicknessMm:3}}),
  ]);
}
function edit(doc,rows,admission='require_admissible') {
  return {format:PARAMETER_FORMULA_TABLE_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    admission,rows};
}
const row = (doc,id) => inspectParameterSheet(doc,parameterSheetRequest(doc))
  .rows.find(item=>item.featureId===id);
const codes = result => result.conflicts.map(item=>item.code);

test('independent newer edit: rebase a stale sheet draft as one undoable revision-fenced CAD change',()=>{
  const base=setup(),original=JSON.stringify(base);
  const draft=edit(base.document,[{eventId:'draft.width',featureId:'p.width',
    formula:'12'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[{eventId:'later.offset',featureId:'p.offset',formula:'20'}]));
  const untouched=JSON.stringify(current);
  const r=rebaseParameterSheetEdit(base.document,current.document,draft,
    current.document.revision);
  assert.equal(r.format,PARAMETER_SHEET_REBASE_FORMAT);
  assert.equal(r.status,'ready');
  assert.deepEqual(r.conflicts,[]);
  assert.equal(r.baseRevision,6);
  assert.equal(r.currentRevision,7);
  assert.equal(r.rebasedRequest.expectedRevision,7);
  assert.equal(r.preview.document.revision,8);
  assert.ok(r.preview.invalidation.invalidatedFeatureIds.includes('cut'));
  assert.ok(r.preview.invalidation.invalidatedFeatureIds.includes('extrude'));
  assert.ok(r.preview.invalidation.unchangedReady.includes('spacer'));
  assert.equal(r.exactGeometryAuthority,false);
  assert.equal(JSON.stringify(base),original);
  assert.equal(JSON.stringify(current),untouched);
  const committed=commitUndoableParameterFormulaTableEdit(current,r.rebasedRequest);
  assert.equal(committed.undoStack.length,3);
  assert.equal(row(committed.document,'p.width').value,12);
  assert.equal(row(committed.document,'p.offset').value,20);
  assert.equal(featuresOf(committed.document).find(f=>f.id==='cut')
    .payload.targetBodyId,'body.plate');
  const reopened=deserializeModelArchive(serializeModelArchive(
    createModelArchive(committed))).history;
  assert.equal(row(reopened.document,'p.width').value,12);
  const undone=undoTransaction(reopened,['undo.width']);
  assert.equal(row(undone.document,'p.width').value,8);
  assert.equal(row(undone.document,'p.offset').value,20);
  const redone=redoTransaction(undone,['redo.width']);
  assert.equal(row(redone.document,'p.width').value,12);
});

test('stale edited row rejects without overwriting external work',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'draft.width',featureId:'p.width',formula:'12'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[{eventId:'later.width',featureId:'p.width',formula:'10'}]));
  const r=rebaseParameterSheetEdit(base.document,current.document,draft,
    current.document.revision);
  assert.equal(r.status,'conflicted');
  assert.deepEqual(codes(r),['edited_row_changed']);
  assert.equal(r.conflicts[0].featureId,'p.width');
  assert.equal(r.preview,null);
  assert.equal(r.rebasedRequest,null);
  assert.equal(row(current.document,'p.width').value,10);
});

test('changed referenced parameter blocks a draft that would inherit new semantics',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'draft.width',featureId:'p.width',
    formula:'offset - 4 mm'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[{eventId:'later.offset',featureId:'p.offset',formula:'22'}]));
  const r=rebaseParameterSheetEdit(base.document,current.document,draft,
    current.document.revision);
  assert.equal(r.status,'conflicted');
  assert.deepEqual(codes(r),['referenced_parameter_changed']);
  assert.equal(r.conflicts[0].relatedId,'p.offset');
  assert.equal(row(current.document,'p.width').value,8);
});

test('draft IDs cannot collide with later authoritative events',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'shared.id',featureId:'p.width',formula:'12'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[{eventId:'shared.id',featureId:'p.offset',formula:'20'}]));
  const r=rebaseParameterSheetEdit(base.document,current.document,draft,
    current.document.revision);
  assert.equal(r.status,'conflicted');
  assert.deepEqual(codes(r),['event_id_taken']);
  assert.equal(r.conflicts[0].relatedId,'shared.id');
});

test('final-name collisions are reported as conflicts, never silently renamed',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'draft.width',featureId:'p.width',
    name:'newWidth'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[{eventId:'later.margin',featureId:'p.margin',
      name:'newWidth'}]));
  const r=rebaseParameterSheetEdit(base.document,current.document,draft,
    current.document.revision);
  assert.equal(r.status,'conflicted');
  assert.deepEqual(codes(r),['candidate_rejected']);
  assert.match(r.conflicts[0].detail,/admission rejected/);
  assert.equal(row(current.document,'p.margin').name,'newWidth');
});

test('same project, exact journal ancestry, source/destination revision fences are mandatory',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'draft.width',featureId:'p.width',
    formula:'12'}]);
  const other=setup();
  const divergent=commitUndoableParameterFormulaTableEdit(other,
    edit(other.document,[{eventId:'other.width',featureId:'p.width',formula:'10'}]));
  assert.throws(()=>rebaseParameterSheetEdit(base.document,
    divergent.document,draft,divergent.document.revision-1),ProjectRevisionError);
  const different=commitUndoableTransaction(
    startUndoHistory(newProject('some.other.project')),[
      param('p.width','width',8),
  ]);
  assert.throws(()=>rebaseParameterSheetEdit(base.document,
    different.document,draft,different.document.revision),ProjectRevisionError);
  const old=commitUndoableTransaction(startUndoHistory(
    newProject('sheet.rebase.plate')),[
      param('p.width','width',9),param('p.offset','offset',16),
      param('p.margin','margin',4),
      create('create.extrude',{id:'extrude',kind:'extrude',
        dependsOn:['p.width'],writeTargets:['body.plate'],
        payload:{thicknessMm:8}}),
      create('create.cut',{id:'cut',kind:'cut',
        dependsOn:['extrude','p.offset'],writeTargets:['body.plate'],
        payload:{targetBodyId:'body.plate'}}),
      create('create.spacer',{id:'spacer',kind:'extrude',
        dependsOn:[],writeTargets:['body.spacer'],payload:{thicknessMm:3}}),
  ]);
  assert.throws(()=>rebaseParameterSheetEdit(base.document,
    old.document,draft,old.document.revision),ProjectRevisionError);
  assert.throws(()=>rebaseParameterSheetEdit(base.document,
    base.document,{...draft,expectedRevision:base.document.revision-1},
    base.document.revision),ProjectRevisionError);
  assert.throws(()=>rebaseParameterSheetEdit(base.document,
    base.document,edit(base.document,[{eventId:'bad',featureId:'p.width',
      formula:'unboundUnknownName'}]),base.document.revision),ProjectFormatError);
});

test('existing real solved-SKETCH/extrude/cut RUNTIME flow executes with stale sheet rebasing',()=>{
  const report=runParameterSheetRebasePlate();
  assert.equal(report.thicknessAfterMm,12);
  assert.equal(report.holeOffsetAfterMm,20);
  assert.equal(report.archiveUndoRedo,true);
  assert.equal(report.nativeExact,false);
});
