import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featuresOf,newProject,planProject,ProjectFormatError,ProjectRevisionError,
  serializeProject,
} from '../src/index.ts';
import {
  startUndoHistory,commitUndoableTransaction,undoTransaction,redoTransaction,
} from '../src/transactions.ts';
import {
  createModelArchive,serializeModelArchive,deserializeModelArchive,
} from '../src/archive.ts';
import { evaluateDimensionBindingPlan } from '../src/dimension-bindings.ts';
import { formatParameterFormula } from '../src/parameter-formula.ts';
import {
  PARAMETER_FORMULA_TABLE_FORMAT,PARAMETER_FORMULA_TABLE_VERSION,
  previewParameterFormulaTableEdit,commitUndoableParameterFormulaTableEdit,
} from '../src/parameter-formula-table.ts';
import { runParameterFormulaTablePlate } from '../examples/parameter-formula-table-plate.mjs';

const literal=value=>({op:'literal',value,unit:'mm'});
const ref=featureId=>({op:'ref',featureId});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const feature=(document,id)=>featuresOf(document).find(f=>f.id===id);
const gate=(document,id)=>evaluateDimensionBindingPlan(planProject(document))
  .featureGates.find(g=>g.featureId===id);
function project() {
  let h=startUndoHistory(newProject('project.formula.table'));
  h=commitUndoableTransaction(h,[
    create('create.a',{id:'p.a',kind:'parameter',dependsOn:[],
      writeTargets:[],payload:{parameter:{
        name:'width',unit:'mm',expression:literal(8)}}}),
    create('create.b',{id:'p.b',kind:'parameter',dependsOn:[],
      writeTargets:[],payload:{parameter:{
        name:'depth',unit:'mm',expression:literal(16)}}}),
    create('create.extrude',{id:'extrude',kind:'extrude',
      dependsOn:['p.a'],writeTargets:['body.plate'],
      payload:{thicknessMm:8,dimensionBindings:{
        format:'intuit3d.dimension-bindings',version:1,entries:[
          {field:'thicknessMm',unit:'mm',expression:ref('p.a')},
        ]}}}),
    create('create.cut',{id:'cut',kind:'cut',
      dependsOn:['extrude','p.b'],writeTargets:['body.plate'],
      payload:{targetBodyId:'body.plate',holeOffsetMm:16,
        dimensionBindings:{format:'intuit3d.dimension-bindings',version:1,
          entries:[{field:'holeOffsetMm',unit:'mm',expression:ref('p.b')}]}}}),
    create('create.spacer',{id:'spacer',kind:'extrude',
      dependsOn:[],writeTargets:['body.spacer'],payload:{thicknessMm:2}}),
  ]);
  return h;
}
const request=(h,rows,admission='require_admissible')=>({
  format:PARAMETER_FORMULA_TABLE_FORMAT,version:PARAMETER_FORMULA_TABLE_VERSION,
  expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
  admission,rows,
});
const edit=[
  {eventId:'swap.a',featureId:'p.a',name:'depth',formula:'width - 4 mm'},
  {eventId:'swap.b',featureId:'p.b',name:'width',formula:'20'},
];

test('atomic name exchange compiles all formulas against final namespace and stable IDs',()=>{
  const h=project(),original=serializeProject(h.document);
  const preview=previewParameterFormulaTableEdit(h.document,request(h,edit));
  assert.equal(preview.events.length,2);
  assert.equal(preview.document.revision,h.document.revision+2);
  assert.deepEqual(preview.renamedParameterIds,['p.a','p.b']);
  assert.deepEqual(preview.expressionChangedParameterIds,['p.a','p.b']);
  assert.deepEqual(preview.formulaReferences[0],{
    featureId:'p.a',referencedParameterIds:['p.b']});
  assert.deepEqual(feature(preview.document,'p.a').dependsOn,['p.b']);
  assert.equal(gate(preview.document,'extrude').resolvedPayload.thicknessMm,16);
  assert.equal(gate(preview.document,'cut').resolvedPayload.holeOffsetMm,20);
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('extrude'));
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('cut'));
  assert.ok(preview.invalidation.unchangedReady.includes('spacer'));
  assert.equal(formatParameterFormula(preview.document,'p.a',
    feature(preview.document,'p.a').payload.parameter.expression),'(width - 4 mm)');
  assert.equal(preview.exactGeometryAuthority,false);
  assert.equal(serializeProject(h.document),original);
});

test('all changed rows form one undo unit and retain identity across archive reopening',()=>{
  const h=project();
  const changed=commitUndoableParameterFormulaTableEdit(h,request(h,edit));
  assert.equal(changed.undoStack.length,h.undoStack.length+1);
  assert.equal(changed.undoStack.at(-1).length,2);
  assert.equal(feature(changed.document,'extrude').writeTargets[0],'body.plate');
  assert.equal(feature(changed.document,'cut').payload.targetBodyId,'body.plate');
  const reopened=deserializeModelArchive(
    serializeModelArchive(createModelArchive(changed))).history;
  assert.equal(feature(reopened.document,'p.a').payload.parameter.name,'depth');
  const undone=undoTransaction(reopened,['undo.b','undo.a']);
  assert.equal(gate(undone.document,'extrude').resolvedPayload.thicknessMm,8);
  assert.equal(feature(undone.document,'p.b').payload.parameter.name,'depth');
  const redone=redoTransaction(undone,['redo.a','redo.b']);
  assert.equal(gate(redone.document,'extrude').resolvedPayload.thicknessMm,16);
  assert.equal(feature(redone.document,'p.a').payload.parameter.name,'depth');
  assert.equal(feature(redone.document,'p.a').payload.parameter.expression.right.value,4);
});

test('cycles and invalid dependents are rejected strictly, preserved explicitly if requested',()=>{
  const h=project();
  const rows=[
    {eventId:'cycle.a',featureId:'p.a',formula:'depth + 1 mm'},
    {eventId:'cycle.b',featureId:'p.b',formula:'width + 1 mm'},
  ];
  assert.throws(()=>previewParameterFormulaTableEdit(h.document,request(h,rows)),
    ProjectFormatError);
  const preview=previewParameterFormulaTableEdit(h.document,
    request(h,rows,'permit_unresolved'));
  assert.equal(planProject(preview.document).features.find(f=>f.feature.id==='p.a')
    .status,'conflicted');
  assert.notEqual(gate(preview.document,'extrude').status,'bound');
  assert.equal(gate(preview.document,'extrude').resolvedPayload,null);
  assert.equal(feature(h.document,'p.a').dependsOn.length,0);
});

test('stale fences, ambiguous names, unknown symbols and partial rows refuse without mutation',()=>{
  const h=project(),before=JSON.stringify(h);
  for(const rowset of [
    [{eventId:'dup',featureId:'p.a',name:'depth'}],
    [{eventId:'bad',featureId:'p.a',formula:'missingName + 1 mm'}],
    [{eventId:'bad',featureId:'p.a',formula:'1 mm + 2 deg'}],
    [{eventId:'bad',featureId:'p.a',formula:'width + 1 mm'}],
    [{eventId:'bad',featureId:'p.a'}],
    [{eventId:'bad',featureId:'p.a',formula:'12',extra:true}],
    [{eventId:'bad',featureId:'cut',formula:'12'}],
    [{eventId:'create.a',featureId:'p.a',formula:'12'}],
    [{eventId:'x',featureId:'p.a',formula:'12'},
     {eventId:'y',featureId:'p.a',formula:'13'}],
    [{eventId:'x',featureId:'p.a',formula:'12'},
     {eventId:'x',featureId:'p.b',formula:'20'}],
  ]) {
    assert.throws(()=>commitUndoableParameterFormulaTableEdit(h,request(h,rowset)),
      undefined,JSON.stringify(rowset));
  }
  const valid=request(h,edit);
  assert.throws(()=>previewParameterFormulaTableEdit(h.document,{
    ...valid,expectedRevision:h.document.revision-1,
  }),ProjectRevisionError);
  assert.throws(()=>previewParameterFormulaTableEdit(h.document,{
    ...valid,expectedProjectId:'different',
  }),ProjectRevisionError);
  assert.throws(()=>previewParameterFormulaTableEdit(h.document,{
    ...valid,version:2,
  }),ProjectFormatError);
  assert.equal(JSON.stringify(h),before);
});

test('formula-only and rename-only rows coexist, and old labels cannot silently rebind',()=>{
  const h=project();
  const rows=[
    {eventId:'rename.a',featureId:'p.a',name:'plateThickness'},
    {eventId:'edit.b',featureId:'p.b',formula:'plateThickness * 2'},
  ];
  const result=previewParameterFormulaTableEdit(h.document,request(h,rows));
  assert.equal(gate(result.document,'cut').resolvedPayload.holeOffsetMm,16);
  assert.deepEqual(result.formulaReferences[0].referencedParameterIds,['p.a']);
  assert.deepEqual(result.renamedParameterIds,['p.a']);
  assert.throws(()=>previewParameterFormulaTableEdit(h.document,
    request(h,[{...rows[0]},{...rows[1],formula:'width * 2'}])),
    ProjectFormatError);
});

test('runnable INTENT / SKETCH / RUNTIME plate-and-cut formula table flow',()=>{
  const output=runParameterFormulaTablePlate();
  assert.equal(output.thicknessBeforeMm,8);
  assert.equal(output.thicknessAfterMm,12);
  assert.equal(output.holePitchAfterMm,20);
  assert.equal(output.oneUndoFrame,true);
  assert.equal(output.archiveUndoRedo,true);
  assert.equal(output.bodyId,'body.plate');
  assert.equal(output.nativeExact,false);
});
