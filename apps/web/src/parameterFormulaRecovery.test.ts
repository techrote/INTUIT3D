import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commitModelParameterFormulaTable,commitResolvedModelParameterFormulaRecovery,
  inspectModelParameterFormulaRecovery,inspectModelSession,modelDimensionValues,
  modelParameterFormulaRows,newModelPlateSession,redoModelSession,
  reopenModelSession,resolveModelParameterFormulaRecovery,runtime,
  serializeModelSession,undoModelSession,
} from './runtimeSession.ts';

function threeParameters(){
  let h=newModelPlateSession('workbench.recovery.test');
  const make=(id:string,name:string,value:number)=>({
    eventId:'make.'+id,type:'feature.create' as const,
    feature:{id,kind:'parameter',dependsOn:[],writeTargets:[],
      payload:{parameter:{name,unit:'mm',
        expression:{op:'literal',value,unit:'mm'}}}},
  });
  h=runtime.commit(h,[make('parameter.pitch','pitch',20),
    make('parameter.margin','margin',8)],h.document.revision);
  return h;
}
function draft(h:ReturnType<typeof threeParameters>){
  return modelParameterFormulaRows(h).map(row=>({
    featureId:row.featureId,name:row.name,formula:
      row.featureId==='parameter.t'?'pitch - margin':row.formula,
  }));
}
function change(h:ReturnType<typeof threeParameters>,id:string,value:string){
  return commitModelParameterFormulaTable(h,
    modelParameterFormulaRows(h).map(row=>({
      featureId:row.featureId,name:row.name,
      formula:row.featureId===id?value:row.formula,
    })),h.document.revision);
}

test('stale referenced parameter requires specific approval, reviews changed value, one undo frame and durable archive',()=>{
  const base=threeParameters(),rows=draft(base);
  const original=serializeModelSession(base);
  const current=change(base,'parameter.pitch','26');
  const before=serializeModelSession(current);
  const report=inspectModelParameterFormulaRecovery(base,current,rows);
  assert.equal(report.status,'conflicted');
  assert.deepEqual(report.conflicts.map(item=>item.code),
    ['referenced_parameter_changed']);
  const rejected=resolveModelParameterFormulaRecovery(base,current,rows,[],[]);
  assert.equal(rejected.status,'conflicted');
  assert.equal(rejected.resolvedRequest,null);
  const approved=resolveModelParameterFormulaRecovery(base,current,rows,[{
    code:'referenced_parameter_changed',featureId:'parameter.t',
    relatedId:'parameter.pitch',
  }],[]);
  assert.equal(approved.status,'ready');
  assert.equal(approved.preview?.exactGeometryAuthority,false);
  assert.equal(approved.valueComparisons[0]?.baseDraftValue,12);
  assert.equal(approved.valueComparisons[0]?.currentDraftValue,18);
  assert.ok(approved.preview?.invalidation.invalidatedFeatureIds.includes('plate'));
  assert.equal(serializeModelSession(base),original);
  assert.equal(serializeModelSession(current),before,
    'approval is a read-only preview, not an implicit edit');
  const applied=commitResolvedModelParameterFormulaRecovery(current,approved);
  assert.equal(applied.undoStack.length,current.undoStack.length+1);
  assert.equal(modelDimensionValues(applied).thickness,18);
  assert.equal(inspectModelSession(applied).features.find(x=>
    x.featureId==='cut')?.status,'pending_exact_provider');
  const reopened=reopenModelSession(serializeModelSession(applied));
  assert.equal(reopened.document.projectId,base.document.projectId);
  assert.equal(modelDimensionValues(reopened).thickness,18);
  const undone=undoModelSession(reopened);
  assert.equal(modelDimensionValues(undone).thickness,10);
  assert.equal(modelParameterFormulaRows(undone).find(x=>
    x.featureId==='parameter.pitch')?.value,26);
  assert.equal(modelDimensionValues(redoModelSession(undone)).thickness,18);
});

test('concurrent unrelated model edit safely rebases without consent, but commits only after explicit final step',()=>{
  const base=threeParameters(),rows=draft(base);
  const current=change(base,'parameter.margin','9');
  const report=inspectModelParameterFormulaRecovery(base,current,rows);
  assert.equal(report.status,'conflicted',
    'an upstream referenced edit must not be treated as unrelated');
  const cleanRows=modelParameterFormulaRows(base).map(row=>({
    featureId:row.featureId,name:row.name,
    formula:row.featureId==='parameter.t'?'12':row.formula,
  }));
  const clean=inspectModelParameterFormulaRecovery(base,current,cleanRows);
  assert.equal(clean.status,'ready');
  const ready=resolveModelParameterFormulaRecovery(base,current,cleanRows,[],[]);
  assert.equal(ready.status,'ready');
  assert.equal(modelDimensionValues(current).thickness,10);
  const result=commitResolvedModelParameterFormulaRecovery(current,ready);
  assert.equal(modelDimensionValues(result).thickness,12);
  const raced=change(current,'parameter.pitch','21');
  assert.throws(()=>commitResolvedModelParameterFormulaRecovery(raced,ready),/stale/);
});

test('edited row and occupied event ID need exact approvals and an explicit fresh identity',()=>{
  const base=threeParameters(),rows=draft(base);
  const current=change(base,'parameter.t','13');
  const report=inspectModelParameterFormulaRecovery(base,current,rows);
  assert.deepEqual(report.conflicts.map(item=>item.code),
    ['edited_row_changed','event_id_taken']);
  const approvals=report.conflicts.map(item=>({
    code:item.code,featureId:item.featureId,relatedId:item.relatedId,
  }));
  assert.throws(()=>resolveModelParameterFormulaRecovery(
    base,current,rows,approvals,[]),/replacement/i);
  const resolved=resolveModelParameterFormulaRecovery(base,current,rows,
    approvals,[{featureId:'parameter.t',eventId:'workbench.reviewed.thickness'}]);
  assert.equal(resolved.status,'ready');
  const applied=commitResolvedModelParameterFormulaRecovery(current,resolved);
  assert.equal(modelDimensionValues(applied).thickness,12);
  assert.equal(modelDimensionValues(undoModelSession(applied)).thickness,13);
  assert.throws(()=>resolveModelParameterFormulaRecovery(base,current,rows,[
    {code:'edited_row_changed',featureId:'parameter.margin',relatedId:null},
    approvals[1],
  ],[{featureId:'parameter.t',eventId:'workbench.reviewed.thickness'}]),
  /duplicate or unreported/i);
  assert.throws(()=>resolveModelParameterFormulaRecovery(base,current,rows,
    approvals,[{featureId:'parameter.t',eventId:report.conflicts[1]!.relatedId!}]),
  /occupied/i);
});

test('another project or divergent journal may never recover a stale draft',()=>{
  const base=threeParameters(),rows=draft(base);
  const other=newModelPlateSession('workbench.recovery.other-project');
  assert.throws(()=>inspectModelParameterFormulaRecovery(base,other,rows),
    /different project|divergent/i);
});
