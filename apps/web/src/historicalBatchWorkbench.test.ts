import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import {
  editModelDimension,modelDimensionValues,modelSketchDimensionValues,
  newModelPlateSession,reopenModelSession,serializeModelSession,
  undoModelSession,redoModelSession,
} from './runtimeSession.ts';
import {
  inspectWorkbenchHistoricalEdits,previewWorkbenchHistoricalBatch,
  commitWorkbenchHistoricalBatch,
  type BatchHistoricalFieldSelection,
} from './historicalEditBridge.ts';

function fixture(){
  const initial=newModelPlateSession('workbench.history.batch.real');
  const afterWidth=editModelDimension(initial,'width',140);
  const changed=editModelDimension(afterWidth,'thickness',12);
  const menu=inspectWorkbenchHistoricalEdits(changed,null,16);
  const pick=(featureId:string):BatchHistoricalFieldSelection=>{
    const row=menu.rows.find(item=>item.featureId===featureId&&
      item.fieldChoices.some(choice=>choice.field==='payload'&&choice.status!=='blocked'));
    assert.ok(row,'expected actual editable history of '+featureId);
    return {row,field:'payload',sourceFence:menu.documentFence};
  };
  return {initial,changed,menu,selections:[pick('sketch.plate'),pick('plate')]};
}

test('workbench previews two distinct historic CAD features and commits one undo frame',()=>{
  const {initial,changed,menu,selections}=fixture();
  const original=serializeModelSession(changed);
  const {preview,requiresConsent}=previewWorkbenchHistoricalBatch(
    changed,selections,menu.documentFence);
  assert.equal(requiresConsent,false);
  assert.equal(preview.selections.length,2);
  assert.equal(preview.exactGeometryAuthority,false);
  assert.equal(model.serializeProject(changed.document),menu.documentFence);
  const compensated=commitWorkbenchHistoricalBatch(changed,selections,menu.documentFence,false);
  assert.equal(compensated.document.revision,changed.document.revision+2,
    'two revisioned inverse events form one undo frame');
  assert.equal(compensated.undoStack.length,changed.undoStack.length+1);
  assert.equal(modelSketchDimensionValues(compensated).width,
    modelSketchDimensionValues(initial).width);
  assert.equal(modelDimensionValues(compensated).thickness,
    modelDimensionValues(initial).thickness);
  assert.equal(serializeModelSession(changed),original,'read/preview/commit are immutable');
  const reopened=reopenModelSession(serializeModelSession(compensated));
  const undone=undoModelSession(reopened);
  assert.equal(modelSketchDimensionValues(undone).width,140);
  assert.equal(modelDimensionValues(undone).thickness,12);
  const redone=redoModelSession(undone);
  assert.equal(modelSketchDimensionValues(redone).width,
    modelSketchDimensionValues(initial).width);
  assert.equal(modelDimensionValues(redone).thickness,
    modelDimensionValues(initial).thickness);
});

test('workbench refuses stale same-revision source and stale post-edit batch',()=>{
  const {changed,menu,selections}=fixture();
  const newer=editModelDimension(changed,'depth',90);
  assert.throws(()=>previewWorkbenchHistoricalBatch(newer,selections,
    menu.documentFence),/stale/i);
  assert.throws(()=>commitWorkbenchHistoricalBatch(newer,selections,
    menu.documentFence,true),/stale/i);
  const otherFence=model.serializeProject(newer.document);
  assert.throws(()=>previewWorkbenchHistoricalBatch(changed,selections,
    otherFence),/stale/i);
});

test('workbench refuses duplicate feature, blocked input and batches outside 2–8',()=>{
  const {changed,menu,selections}=fixture();
  assert.throws(()=>previewWorkbenchHistoricalBatch(changed,
    [selections[0],selections[0]],menu.documentFence),/one historical field per feature/i);
  assert.throws(()=>previewWorkbenchHistoricalBatch(changed,
    [selections[0]],menu.documentFence),/2–8/i);
  const wrong={...selections[1],row:{
    ...selections[1].row, targetEventId:'nonexistent.event'}};
  assert.throws(()=>previewWorkbenchHistoricalBatch(changed,
    [selections[0],wrong],menu.documentFence),/source event/i);
});
