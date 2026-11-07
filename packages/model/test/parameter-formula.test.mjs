import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featuresOf, newProject, planProject, ProjectFormatError,
  ProjectRevisionError, serializeProject,
} from '../src/index.ts';
import {
  commitUndoableTransaction, startUndoHistory, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import { evaluateDimensionBindingPlan } from '../src/dimension-bindings.ts';
import {
  PARAMETER_FORMULA_FORMAT, PARAMETER_FORMULA_VERSION,
  parseParameterFormula, formatParameterFormula,
  previewParameterFormulaEdit, commitUndoableParameterFormulaEdit,
} from '../src/parameter-formula.ts';
import {
  commitUndoableParameterTableEdit, PARAMETER_TABLE_FORMAT,
} from '../src/parameter-table.ts';
import { runParameterFormulaPlate } from '../examples/parameter-formula-plate.mjs';

const lit = (value, unit='mm') => ({ op: 'literal', value, unit });
const ref = featureId => ({ op: 'ref', featureId });
const create = (eventId, feature) => ({ type:'feature.create', eventId, feature });
const param = (id, name, value) => ({
  id, kind:'parameter', dependsOn:[], writeTargets:[],
  payload:{ parameter:{ name,unit:'mm',expression:lit(value) } },
});
const gate = (doc,id) => evaluateDimensionBindingPlan(planProject(doc))
  .featureGates.find(g => g.featureId === id);
const feature = (doc,id) => featuresOf(doc).find(f => f.id === id);
const request = (doc,formula,eventId='formula.edit',featureId='p.thickness',
                 admission='require_admissible') => ({
  format:PARAMETER_FORMULA_FORMAT,version:PARAMETER_FORMULA_VERSION,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  eventId,featureId,formula,admission,
});
function plate() {
  let h=startUndoHistory(newProject('project.formula.plate'));
  h=commitUndoableTransaction(h,[
    create('create.sketch',{id:'sketch',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{}}),
    create('create.extrude',{id:'extrude',kind:'extrude',
      dependsOn:['sketch','p.thickness'],writeTargets:['body.plate'],
      payload:{ thicknessMm:8,dimensionBindings:{
        format:'intuit3d.dimension-bindings',version:1,entries:[
          {field:'thicknessMm',unit:'mm',expression:ref('p.thickness')},
        ],
      }}}),
    create('create.cut',{id:'cut',kind:'cut',
      dependsOn:['extrude','p.offset'],writeTargets:['body.plate'],
      payload:{targetBodyId:'body.plate',holeOffsetMm:16,
        dimensionBindings:{format:'intuit3d.dimension-bindings',version:1,
          entries:[{field:'holeOffsetMm',unit:'mm',expression:ref('p.offset')}]}}}),
    create('create.spacer',{id:'spacer',kind:'extrude',
      dependsOn:[],writeTargets:['body.spacer'],payload:{ thicknessMm:3 }}),
    create('create.thickness',param('p.thickness','plateThickness',8)),
    create('create.offset',param('p.offset','holeOffset',16)),
  ]);
  return h;
}

test('formulas resolve named parameters to IDs with operator precedence and dimensions', () => {
  const source=plate().document;
  assert.deepEqual(parseParameterFormula(source,'p.thickness',
    '2 * holeOffset + 1 mm'),{
      op:'add',left:{op:'multiply',left:lit(2,'unitless'),right:ref('p.offset')},
      right:lit(1),
    });
  assert.deepEqual(parseParameterFormula(source,'p.thickness','12'),lit(12));
  assert.deepEqual(parseParameterFormula(source,'p.thickness','-12'),{
    op:'negate',operand:lit(12),
  });
  assert.deepEqual(parseParameterFormula(source,'p.thickness',
    '12 / 2 + 3 mm'),{
      op:'add',left:{op:'divide',left:lit(12,'unitless'),right:lit(2,'unitless')},
      right:lit(3),
    });
  assert.deepEqual(parseParameterFormula(source,'p.thickness','1 - 2 - 3'),{
    op:'subtract',left:{op:'subtract',left:lit(1,'unitless'),right:lit(2,'unitless')},
      right:lit(3,'unitless'),
  });
  assert.equal(formatParameterFormula(source,'p.thickness',lit(12)),'12 mm');
});

test('user formula changes only affected model branch; archive, undo and redo retain IDs', () => {
  const before=plate(), original=serializeProject(before.document);
  const req=request(before.document,'holeOffset * 0.5');
  const preview=previewParameterFormulaEdit(before.document,req);
  assert.equal(preview.exactGeometryAuthority,false);
  assert.deepEqual(preview.referencedParameterIds,['p.offset']);
  assert.deepEqual(feature(preview.document,'p.thickness').dependsOn,['p.offset']);
  assert.equal(gate(preview.document,'extrude').resolvedPayload.thicknessMm,8);
  assert.equal(gate(preview.document,'cut').resolvedPayload.holeOffsetMm,16);
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('extrude'));
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('cut'));
  assert.ok(preview.invalidation.unchangedReady.includes('spacer'));
  assert.equal(serializeProject(before.document),original);
  const edited=commitUndoableParameterFormulaEdit(before,request(before.document,
    '2 * holeOffset - 8 mm'));
  assert.equal(edited.undoStack.length,before.undoStack.length+1);
  assert.equal(edited.undoStack.at(-1).length,1);
  assert.equal(gate(edited.document,'extrude').resolvedPayload.thicknessMm,24);
  assert.equal(feature(edited.document,'cut').payload.targetBodyId,'body.plate');
  const save=serializeModelArchive(createModelArchive(edited));
  const reopened=deserializeModelArchive(save).history;
  assert.equal(formatParameterFormula(reopened.document,'p.thickness',
    feature(reopened.document,'p.thickness').payload.parameter.expression),
    '((2 * holeOffset) - 8 mm)');
  const undone=undoTransaction(reopened,['undo.formula']);
  assert.equal(gate(undone.document,'extrude').resolvedPayload.thicknessMm,8);
  const redone=redoTransaction(undone,['redo.formula']);
  assert.equal(gate(redone.document,'extrude').resolvedPayload.thicknessMm,24);
  assert.equal(feature(redone.document,'cut').id,'cut');
});

test('renaming a referenced parameter updates text without changing saved feature IDs', () => {
  const first=plate();
  const edited=commitUndoableParameterFormulaEdit(first,
    request(first.document,'holeOffset + 2 mm'));
  const renamed=commitUndoableParameterTableEdit(edited,{
    format:PARAMETER_TABLE_FORMAT,version:1,
    expectedProjectId:edited.document.projectId,
    expectedRevision:edited.document.revision,admission:'require_admissible',
    edits:[{eventId:'rename.offset',featureId:'p.offset',name:'holePitch'}],
  });
  const expression=feature(renamed.document,'p.thickness').payload.parameter.expression;
  assert.equal(expression.left.featureId,'p.offset');
  assert.equal(formatParameterFormula(renamed.document,'p.thickness',expression),
    '(holePitch + 2 mm)');
  assert.deepEqual(JSON.parse(JSON.stringify(parseParameterFormula(
    renamed.document,'p.thickness','(holePitch + 2 mm)'))),
    JSON.parse(JSON.stringify(expression)));
  assert.equal(gate(renamed.document,'extrude').resolvedPayload.thicknessMm,18);
});

test('bad syntax, unknown name and invalid admitted scalars never mutate document', () => {
  const session=plate(), saved=JSON.stringify(session);
  for(const formula of [
    '', 'Math.max(1, 2)', 'unknown + 1 mm', '1 mm + 2 deg',
    '1 mm * 2 mm', '12 / 0', '2 ** 3', '2 +', '(2 + 1 mm',
    '2 + 1 mm)', '0x10', '1e309 mm', '1e-999 mm',
    '(', 'plateThickness / 0', '12 mm rubbish', '2 ; 3',
  ]) {
    assert.throws(()=>commitUndoableParameterFormulaEdit(session,
      request(session.document,formula)),ProjectFormatError,formula);
  }
  assert.throws(()=>commitUndoableParameterFormulaEdit(session,
    request(session.document,'plateThickness + 1 mm')),ProjectFormatError);
  assert.equal(JSON.stringify(session),saved);
});

test('stale project/revision, unsupported shapes and event collision refuse atomically', () => {
  const h=plate(), valid=request(h.document,'12 mm');
  for(const invalid of [
    {...valid,expectedRevision:h.document.revision-1},
    {...valid,expectedProjectId:'different.project'},
    {...valid,format:'wrong.format'},
    {...valid,version:2},
    {...valid,eventId:'create.sketch'},
    {...valid,featureId:'extrude'},
    {...valid,additional:true},
  ]) assert.throws(()=>previewParameterFormulaEdit(h.document,invalid));
  assert.throws(()=>previewParameterFormulaEdit(h.document,{
    ...valid,expectedRevision:h.document.revision-1,
  }),ProjectRevisionError);
});

test('permissive cycle stays explicitly unresolved, while strict mode refuses it', () => {
  const original=plate();
  const a=commitUndoableParameterFormulaEdit(original,
    request(original.document,'holeOffset + 1 mm'));
  const cycle=request(a.document,'plateThickness + 1 mm','edit.cycle',
    'p.offset');
  assert.throws(()=>previewParameterFormulaEdit(a.document,cycle),ProjectFormatError);
  const snapshot=JSON.stringify(a);
  const pending=previewParameterFormulaEdit(a.document,
    {...cycle,admission:'permit_unresolved'});
  assert.ok(pending.evaluation.featureGates.find(g=>g.featureId==='p.thickness')
    .status !== 'admissible');
  assert.equal(gate(pending.document,'extrude').resolvedPayload,null);
  assert.equal(JSON.stringify(a),snapshot);
});

test('real public INTENT/SKETCH/RUNTIME formula demonstration runs', () => {
  const outcome=runParameterFormulaPlate();
  assert.equal(outcome.thicknessBeforeMm,8);
  assert.equal(outcome.thicknessAfterMm,12);
  assert.equal(outcome.extrudeId,'extrude.plate');
  assert.equal(outcome.bodyId,'body.plate');
  assert.equal(outcome.archiveUndoRedo,true);
  assert.equal(outcome.nativeExact,false);
});
