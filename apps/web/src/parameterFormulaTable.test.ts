import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commitModelParameterFormulaTable, inspectModelSession,
  inspectNamedThicknessParameter, modelDimensionValues,
  modelParameterFormulaRows, newModelPlateSession,
  previewModelParameterFormulaTable, redoModelSession, reopenModelSession,
  runtime, serializeModelSession, undoModelSession, editModelDimension,
} from './runtimeSession.ts';

function threeParameters() {
  let h=newModelPlateSession('workbench.formula.test');
  const make=(id:string,name:string,value:number)=>({
    eventId:'make.'+id,type:'feature.create' as const,
    feature:{
      id,kind:'parameter',dependsOn:[],writeTargets:[],
      payload:{parameter:{name,unit:'mm',expression:{
        op:'literal',value,unit:'mm',
      }}},
    },
  });
  h=runtime.commit(h,[make('parameter.pitch','pitch',20),make('parameter.margin','margin',8)],
    h.document.revision);
  return h;
}

test('real plate parameter spreadsheet previews final semantic dependencies and commits one undo frame',()=>{
  const h=threeParameters();
  const original=serializeModelSession(h);
  const rows=modelParameterFormulaRows(h);
  assert.deepEqual(rows.map(x=>x.featureId),[
    'parameter.t','parameter.pitch','parameter.margin']);
  assert.equal(rows[0]?.value,10);
  const next=rows.map(x=>({
    featureId:x.featureId,
    name:x.featureId==='parameter.t'?'plateThickness':
      x.featureId==='parameter.pitch'?'holePitch':
      x.featureId==='parameter.margin'?'holeMargin':x.name,
    formula:x.featureId==='parameter.t'?'holePitch - holeMargin':x.formula,
  }));
  const preview=previewModelParameterFormulaTable(h,next,h.document.revision);
  assert.equal(preview.events.length,3);
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('plate'));
  assert.ok(preview.invalidation.invalidatedFeatureIds.includes('cut'));
  assert.deepEqual(preview.formulaReferences[0]?.referencedParameterIds,
    ['parameter.pitch','parameter.margin']);
  assert.equal(serializeModelSession(h),original,'preview must not mutate source');
  const applied=commitModelParameterFormulaTable(h,next,h.document.revision);
  assert.equal(applied.undoStack.length,h.undoStack.length+1);
  assert.equal(applied.undoStack.at(-1)?.length,3);
  assert.equal(applied.document.revision,h.document.revision+3);
  assert.equal(modelDimensionValues(applied).thickness,12,
    'resolved binding, not AST literal, must drive browser dimensions');
  assert.equal(inspectNamedThicknessParameter(applied)?.valueMm,12);
  assert.equal(inspectModelSession(applied).features
    .find(f=>f.featureId==='cut')?.status,'pending_exact_provider');
  const summary=modelParameterFormulaRows(applied);
  assert.equal(summary[0]?.name,'plateThickness');
  assert.equal(summary[0]?.formula,'(holePitch - holeMargin)');
  assert.equal(summary[0]?.value,12);
  assert.equal(summary[1]?.value,20);
  assert.equal(summary[2]?.value,8);
  const reopened=reopenModelSession(serializeModelSession(applied));
  assert.equal(reopened.document.projectId,applied.document.projectId);
  assert.equal(modelDimensionValues(reopened).thickness,12);
  assert.equal(modelParameterFormulaRows(reopened)[0]?.formula,'(holePitch - holeMargin)');
  const undo=undoModelSession(reopened);
  assert.equal(modelDimensionValues(undo).thickness,10);
  assert.equal(modelParameterFormulaRows(undo)[0]?.name,'thickness');
  const redo=redoModelSession(undo);
  assert.equal(modelDimensionValues(redo).thickness,12);
  assert.deepEqual(modelParameterFormulaRows(redo).map(x=>x.featureId),
    rows.map(x=>x.featureId));
  assert.throws(()=>editModelDimension(applied,'thickness',15),
    /editable literal|literal named|parameter/i,
    'direct thickness grip must not overwrite a user-authored formula');
});

test('stale, ambiguous, invalid, cyclic, no-op formula drafts refuse atomically',()=>{
  const h=threeParameters();
  const source=serializeModelSession(h);
  const rows=modelParameterFormulaRows(h).map(x=>({
    featureId:x.featureId,name:x.name,formula:x.formula,
  }));
  const cases=[
    rows,
    rows.map(x=>x.featureId==='parameter.t'?{...x,name:'invalid name'}:x),
    rows.map(x=>x.featureId==='parameter.t'?{...x,formula:'notAuthored + 2 mm'}:x),
    rows.map(x=>x.featureId==='parameter.t'?{...x,formula:'10 mm / 0'}:x),
    rows.map(x=>x.featureId==='parameter.t'?{...x,name:'pitch'}:x),
    rows.map(x=>x.featureId==='parameter.t'?{...x,formula:'pitch'}:
      x.featureId==='parameter.pitch'?{...x,formula:'thickness'}:x),
  ];
  for(const draft of cases){
    assert.throws(()=>commitModelParameterFormulaTable(h,draft,h.document.revision));
    assert.equal(serializeModelSession(h),source);
  }
  assert.throws(()=>previewModelParameterFormulaTable(
    h,[{featureId:'parameter.t',name:'alt',formula:'12 mm'}],
    h.document.revision-1),/stale/);
  assert.equal(serializeModelSession(h),source);
});

test('single-row numeric table remains interoperable with prior named parameter inspector',()=>{
  const h=newModelPlateSession('workbench.formula.single');
  const old=modelParameterFormulaRows(h)[0]!;
  const next=commitModelParameterFormulaTable(h,[{
    featureId:old.featureId,name:'plateThickness',formula:'12',
  }],h.document.revision);
  assert.equal(modelDimensionValues(next).thickness,12);
  assert.equal(inspectNamedThicknessParameter(next)?.name,'plateThickness');
  assert.equal(modelDimensionValues(reopenModelSession(serializeModelSession(next))).thickness,12);
  assert.equal(modelDimensionValues(undoModelSession(next)).thickness,10);
});
