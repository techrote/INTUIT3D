import assert from 'node:assert/strict';
import test from 'node:test';
import { newProject, ProjectFormatError, ProjectRevisionError } from '../src/index.ts';
import { startUndoHistory, commitUndoableTransaction } from '../src/transactions.ts';
import { createModelArchive, serializeModelArchive, deserializeModelArchive } from '../src/archive.ts';
import { PARAMETER_FORMULA_TABLE_FORMAT,
  commitUndoableParameterFormulaTableEdit } from '../src/parameter-formula-table.ts';
import { PARAMETER_SHEET_FORMAT, parameterSheetRequest,
  inspectParameterSheet, previewParameterSheetEdit } from '../src/parameter-sheet.ts';
import { runParameterFormulaTablePlate } from '../examples/parameter-formula-table-plate.mjs';

const literal = value => ({ op:'literal',value,unit:'mm' });
const ref = featureId => ({ op:'ref',featureId });
const create = (eventId,feature) => ({ eventId,type:'feature.create',feature });
function source() {
  let h = startUndoHistory(newProject('example.parameter.sheet'));
  h = commitUndoableTransaction(h, [
    create('create.width',{id:'p.width',kind:'parameter',dependsOn:[],
      writeTargets:[],payload:{parameter:{name:'width',unit:'mm',
        expression:literal(8)}}}),
    create('create.offset',{id:'p.offset',kind:'parameter',dependsOn:[],
      writeTargets:[],payload:{parameter:{name:'holeOffset',unit:'mm',
        expression:literal(16)}}}),
    create('create.extrude',{id:'extrude',kind:'extrude',
      dependsOn:['p.width'],writeTargets:['body.plate'],payload:{
        thicknessMm:8,dimensionBindings:{format:'intuit3d.dimension-bindings',
          version:1,entries:[{field:'thicknessMm',unit:'mm',
            expression:ref('p.width')}]}}}),
    create('create.cut',{id:'cut',kind:'cut',
      dependsOn:['extrude','p.offset'],writeTargets:['body.plate'],
      payload:{targetBodyId:'body.plate',holeOffsetMm:16,
        dimensionBindings:{format:'intuit3d.dimension-bindings',version:1,
          entries:[{field:'holeOffsetMm',unit:'mm',
            expression:ref('p.offset')}]}}}),
    create('create.spacer',{id:'spacer',kind:'extrude',
      dependsOn:[],writeTargets:['body.spacer'],payload:{thicknessMm:3}}),
  ]);
  return h;
}
function changes(h, rows, admission='require_admissible') {
  return {format:PARAMETER_FORMULA_TABLE_FORMAT,version:1,
    expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
    admission,rows};
}
const row = (sheet,id) => sheet.rows.find(item=>item.featureId===id);

test('revision-fenced editable parameter sheet exposes real dependent cut chain',()=>{
  const h=source(),before=JSON.stringify(h);
  const result=inspectParameterSheet(h.document,parameterSheetRequest(h.document));
  assert.equal(result.format,PARAMETER_SHEET_FORMAT);
  assert.equal(result.revision,h.document.revision);
  assert.deepEqual(result.rows.map(r=>r.featureId),['p.width','p.offset']);
  assert.equal(row(result,'p.width').formulaText,'8 mm');
  assert.equal(row(result,'p.width').value,8);
  assert.equal(row(result,'p.width').dimensionStatus,'admissible');
  assert.deepEqual(row(result,'p.width').directConsumerFeatureIds,['extrude']);
  assert.deepEqual(row(result,'p.width').affectedFeatureIds,['extrude','cut']);
  assert.deepEqual(row(result,'p.offset').directConsumerFeatureIds,['cut']);
  assert.deepEqual(result.needsUserAttention,[]);
  assert.equal(result.exactGeometryAuthority,false);
  assert.equal(JSON.stringify(h),before);
});
test('preview exposes final rename-bound formulas, dependent invalidation, unaffected body',()=>{
  const h=source(),before=JSON.stringify(h);
  const req=changes(h,[
    {eventId:'edit.width',featureId:'p.width',name:'webThickness',
      formula:'holePitch - 8 mm'},
    {eventId:'edit.offset',featureId:'p.offset',name:'holePitch',
      formula:'20'},
  ]);
  const diff=previewParameterSheetEdit(h.document,req);
  assert.equal(row(diff.before,'p.width').value,8);
  assert.equal(row(diff.after,'p.width').formulaText,'(holePitch - 8 mm)');
  assert.equal(row(diff.after,'p.width').value,12);
  assert.equal(row(diff.after,'p.offset').value,20);
  assert.deepEqual(row(diff.after,'p.width').directConsumerFeatureIds,['extrude']);
  assert.deepEqual(diff.changedParameterIds,['p.width','p.offset']);
  assert.ok(diff.invalidatedFeatureIds.includes('extrude'));
  assert.ok(diff.invalidatedFeatureIds.includes('cut'));
  assert.ok(diff.unaffectedReadyFeatureIds.includes('spacer'));
  assert.equal(diff.authoredEvents.length,2);
  assert.equal(diff.exactGeometryAuthority,false);
  assert.equal(JSON.stringify(h),before);
  const changed=commitUndoableParameterFormulaTableEdit(h,req);
  const reopened=deserializeModelArchive(serializeModelArchive(
    createModelArchive(changed))).history;
  const sheet=inspectParameterSheet(reopened.document,
    parameterSheetRequest(reopened.document));
  assert.equal(row(sheet,'p.width').formulaText,'(holePitch - 8 mm)');
  assert.equal(row(sheet,'p.width').value,12);
});
test('unresolved authored reference is retained, not replaced by a stale numeric value',()=>{
  const h=startUndoHistory(newProject('example.pending.sheet'));
  const pending=commitUndoableTransaction(h,[
    create('create.pending',{id:'p.pending',kind:'parameter',
      dependsOn:['p.notCreated'],writeTargets:[],payload:{parameter:{
        name:'pendingWidth',unit:'mm',expression:ref('p.notCreated')}}}),
  ]);
  const sheet=inspectParameterSheet(pending.document,
    parameterSheetRequest(pending.document));
  const found=row(sheet,'p.pending');
  assert.equal(found.formulaText,null);
  assert.match(found.formulaIssue,/unresolved stored parameter reference/);
  assert.equal(found.authoredExpression.featureId,'p.notCreated');
  assert.equal(found.value,null);
  assert.equal(found.requiresUserAttention,true);
  assert.deepEqual(sheet.needsUserAttention,['p.pending']);
});
test('stale revision, wrong project and unsupported read request refuse closed',()=>{
  const doc=source().document;
  const req=parameterSheetRequest(doc);
  assert.throws(()=>inspectParameterSheet(doc,{
    ...req,expectedRevision:doc.revision-1,
  }),ProjectRevisionError);
  assert.throws(()=>inspectParameterSheet(doc,{
    ...req,expectedProjectId:'wrong',
  }),ProjectRevisionError);
  assert.throws(()=>inspectParameterSheet(doc,{...req,version:2}),
    ProjectFormatError);
  assert.throws(()=>inspectParameterSheet(doc,{...req,extra:true}),
    ProjectFormatError);
  assert.throws(()=>previewParameterSheetEdit(doc,changes({document:doc},[
    {eventId:'bad',featureId:'p.width',formula:'unknownName'},
  ])),ProjectFormatError);
});
test('real solved SKETCH/RUNTIME formula-table scenario continues to execute',()=>{
  const output=runParameterFormulaTablePlate();
  assert.equal(output.thicknessAfterMm,12);
  assert.equal(output.archiveUndoRedo,true);
  assert.equal(output.nativeExact,false);
});
