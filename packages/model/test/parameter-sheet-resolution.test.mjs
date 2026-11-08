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
  PARAMETER_FORMULA_TABLE_FORMAT,commitUndoableParameterFormulaTableEdit,
} from '../src/parameter-formula-table.ts';
import {rebaseParameterSheetEdit} from '../src/parameter-sheet-rebase.ts';
import {
  PARAMETER_SHEET_RESOLUTION_FORMAT,resolveParameterSheetConflict,
} from '../src/parameter-sheet-resolution.ts';
import {
  inspectParameterSheet,parameterSheetRequest,
} from '../src/parameter-sheet.ts';
import {runParameterSheetConflictPlate} from '../examples/parameter-sheet-conflict-plate.mjs';

const literal=value=>({op:'literal',value,unit:'mm'});
const ref=featureId=>({op:'ref',featureId});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const param=(id,name,value)=>create('create.'+id,{
  id,kind:'parameter',dependsOn:[],writeTargets:[],
  payload:{parameter:{name,unit:'mm',expression:literal(value)}},
});
function setup() {
  return commitUndoableTransaction(startUndoHistory(newProject('conflict.plate')),[
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
function edit(doc,rows) {
  return {format:PARAMETER_FORMULA_TABLE_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    admission:'require_admissible',rows};
}
function consent(base,current,approvals=[],eventReplacements=[]) {
  return {format:PARAMETER_SHEET_RESOLUTION_FORMAT,version:1,
    expectedProjectId:base.document.projectId,
    expectedBaseRevision:base.document.revision,
    expectedCurrentRevision:current.document.revision,
    approvals,eventReplacements};
}
const row=(doc,id)=>inspectParameterSheet(doc,parameterSheetRequest(doc))
  .rows.find(item=>item.featureId===id);
const changedRef={code:'referenced_parameter_changed',
  featureId:'p.width',relatedId:'p.offset'};

test('user-reviewed changed upstream value becomes a fenced, atomic, undoable sheet edit',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'draft.width',featureId:'p.width',
    formula:'offset - 4 mm'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[{eventId:'later.offset',featureId:'p.offset',formula:'22'}]));
  const immutableBase=JSON.stringify(base);
  const immutableCurrent=JSON.stringify(current);
  const before=rebaseParameterSheetEdit(base.document,current.document,
    draft,current.document.revision);
  assert.equal(before.status,'conflicted');
  assert.deepEqual(before.conflicts.map(c=>c.code),['referenced_parameter_changed']);
  const rejected=resolveParameterSheetConflict(base.document,current.document,
    draft,consent(base,current));
  assert.equal(rejected.status,'conflicted');
  assert.equal(rejected.resolvedRequest,null);
  assert.equal(rejected.preview,null);
  assert.deepEqual(rejected.conflicts.map(c=>c.code),['referenced_parameter_changed']);

  const approved=resolveParameterSheetConflict(base.document,current.document,
    draft,consent(base,current,[changedRef]));
  assert.equal(approved.status,'ready');
  assert.deepEqual(approved.conflicts,[]);
  assert.deepEqual(approved.acknowledgedConflicts.map(c=>c.code),
    ['referenced_parameter_changed']);
  assert.deepEqual(approved.valueComparisons,[{
    featureId:'p.width',baseDraftValue:12,currentDraftValue:18,
    baseDraftUnit:'mm',currentDraftUnit:'mm',
  }]);
  assert.equal(approved.exactGeometryAuthority,false);
  assert.ok(approved.preview.invalidation.invalidatedFeatureIds.includes('extrude'));
  assert.ok(approved.preview.invalidation.invalidatedFeatureIds.includes('cut'));
  assert.ok(approved.preview.invalidation.unchangedReady.includes('spacer'));
  assert.equal(approved.resolvedRequest.expectedRevision,current.document.revision);
  assert.equal(JSON.stringify(base),immutableBase);
  assert.equal(JSON.stringify(current),immutableCurrent);

  const applied=commitUndoableParameterFormulaTableEdit(current,approved.resolvedRequest);
  assert.equal(row(applied.document,'p.width').value,18);
  assert.equal(row(applied.document,'p.offset').value,22);
  assert.equal(featuresOf(applied.document).find(f=>f.id==='cut')
    .payload.targetBodyId,'body.plate');
  const reopened=deserializeModelArchive(serializeModelArchive(
    createModelArchive(applied))).history;
  assert.equal(row(reopened.document,'p.width').value,18);
  const undone=undoTransaction(reopened,['undo.width']);
  assert.equal(row(undone.document,'p.width').value,8);
  assert.equal(row(undone.document,'p.offset').value,22);
  const redone=redoTransaction(undone,['redo.width']);
  assert.equal(row(redone.document,'p.width').value,18);
});

test('conflicting edited row can be reapplied only with its exact semantic acknowledgement',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'draft.width',featureId:'p.width',
    formula:'12'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[{eventId:'later.width',featureId:'p.width',formula:'10'}]));
  const ack={code:'edited_row_changed',featureId:'p.width',relatedId:null};
  const resolved=resolveParameterSheetConflict(base.document,current.document,
    draft,consent(base,current,[ack]));
  assert.equal(resolved.status,'ready');
  assert.equal(resolved.valueComparisons[0].currentDraftValue,12);
  const applied=commitUndoableParameterFormulaTableEdit(current,resolved.resolvedRequest);
  assert.equal(row(applied.document,'p.width').value,12);
  assert.equal(applied.undoStack.length,3);
  assert.throws(()=>resolveParameterSheetConflict(base.document,current.document,
    draft,consent(base,current,[ack,ack])),ProjectFormatError);
  assert.throws(()=>resolveParameterSheetConflict(base.document,current.document,
    draft,consent(base,current,[{...ack,featureId:'p.offset'}])),ProjectFormatError);
});

test('occupied event ID requires explicit new unique unused identity and acknowledgement',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'shared.event',featureId:'p.width',
    formula:'12'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[{eventId:'shared.event',featureId:'p.offset',formula:'20'}]));
  const ack={code:'event_id_taken',featureId:'p.width',relatedId:'shared.event'};
  assert.throws(()=>resolveParameterSheetConflict(base.document,current.document,
    draft,consent(base,current,[ack])),ProjectFormatError);
  assert.throws(()=>resolveParameterSheetConflict(base.document,current.document,
    draft,consent(base,current,[ack],[{
      featureId:'p.width',eventId:'shared.event'}])),ProjectFormatError);
  const resolved=resolveParameterSheetConflict(base.document,current.document,
    draft,consent(base,current,[ack],[{
      featureId:'p.width',eventId:'replacement.width'}]));
  assert.equal(resolved.status,'ready');
  assert.equal(resolved.resolvedRequest.rows[0].eventId,'replacement.width');
  const applied=commitUndoableParameterFormulaTableEdit(current,resolved.resolvedRequest);
  assert.equal(row(applied.document,'p.width').value,12);
  assert.equal(row(applied.document,'p.offset').value,20);
});

test('explicit reference drift consent never silently rebinds formula to a different ID',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'draft.width',featureId:'p.width',
    formula:'offset + 4 mm'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[
      {eventId:'swap.offset',featureId:'p.offset',name:'margin'},
      {eventId:'swap.margin',featureId:'p.margin',name:'offset'},
    ]));
  const result=resolveParameterSheetConflict(base.document,current.document,draft,
    consent(base,current,[changedRef]));
  assert.equal(result.status,'conflicted');
  assert.deepEqual(result.conflicts.map(c=>c.code),['formula_binding_changed']);
  assert.equal(result.preview,null);
  assert.equal(result.resolvedRequest,null);
  assert.equal(row(current.document,'p.offset').name,'margin');
});

test('final naming collision is not overridable by conflict acknowledgement',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'draft.width',featureId:'p.width',
    name:'futureWidth'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[{eventId:'later.margin',featureId:'p.margin',
      name:'futureWidth'}]));
  const conflict=rebaseParameterSheetEdit(base.document,current.document,draft,
    current.document.revision);
  assert.equal(conflict.conflicts[0].code,'candidate_rejected');
  const resolved=resolveParameterSheetConflict(base.document,current.document,draft,
    consent(base,current));
  assert.equal(resolved.status,'conflicted');
  assert.equal(resolved.conflicts[0].code,'candidate_rejected');
  assert.equal(resolved.resolvedRequest,null);
});

test('second writer revision race and false ancestry fail closed after preview',()=>{
  const base=setup();
  const draft=edit(base.document,[{eventId:'draft.width',featureId:'p.width',
    formula:'12'}]);
  const current=commitUndoableParameterFormulaTableEdit(base,
    edit(base.document,[{eventId:'later.offset',featureId:'p.offset',formula:'20'}]));
  const resolved=resolveParameterSheetConflict(base.document,current.document,
    draft,consent(base,current));
  assert.equal(resolved.status,'ready');
  const newer=commitUndoableParameterFormulaTableEdit(current,
    edit(current.document,[{eventId:'race.margin',featureId:'p.margin',
      formula:'5'}]));
  assert.throws(()=>commitUndoableParameterFormulaTableEdit(
    newer,resolved.resolvedRequest),ProjectRevisionError);
  assert.throws(()=>resolveParameterSheetConflict(base.document,newer.document,
    draft,consent(base,current)),ProjectRevisionError);
  const divergentEvents=structuredClone(base.document.journal);
  divergentEvents[0].feature.payload.parameter.expression.value=9;
  const divergent=commitUndoableTransaction(
    startUndoHistory(newProject('conflict.plate')),divergentEvents);
  assert.throws(()=>resolveParameterSheetConflict(base.document,
    divergent.document,draft,consent(base,divergent)),ProjectRevisionError);
});

test('the actual solved SKETCH / extrude / cut RUNTIME example confirms reviewed value drift and archive',()=>{
  const report=runParameterSheetConflictPlate();
  assert.equal(report.draftThicknessAtBaseMm,12);
  assert.equal(report.draftThicknessAfterConcurrentChangeMm,16);
  assert.equal(report.changedHoleOffsetMm,20);
  assert.equal(report.archiveUndoRedo,true);
  assert.equal(report.nativeExact,false);
});
