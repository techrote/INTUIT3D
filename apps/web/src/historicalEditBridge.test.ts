import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import {
  editModelDimension,modelSketchDimensionValues,newModelPlateSession,
  reopenModelSession,serializeModelSession,undoModelSession,redoModelSession,
} from './runtimeSession.ts';
import {
  inspectWorkbenchHistoricalEdits,compensateWorkbenchHistoricalField,
} from './historicalEditBridge.ts';

test('browser journal history reveals an actual edited plate width and reverts one selected field',()=>{
  const source=newModelPlateSession('workbench.history.revert.actual');
  const afterWidth=editModelDimension(source,'width',140);
  const menu=inspectWorkbenchHistoricalEdits(afterWidth);
  const row=menu.rows.find(entry=>entry.featureId==='sketch.plate'&&
    entry.fieldChoices.some(choice=>choice.field==='payload'&&choice.status==='available'));
  assert.ok(row,'an eligible historical SKETCH payload edit should be visible');
  const values=row.fieldTransitions.find(item=>item.field==='payload');
  assert.ok(values&&values.before&&values.authored,'actual authored values are present');
  const snapshot=serializeModelSession(afterWidth);
  const reverted=compensateWorkbenchHistoricalField(afterWidth,row,'payload',
    menu.documentFence,false);
  assert.equal(modelSketchDimensionValues(source).width,120);
  assert.equal(modelSketchDimensionValues(afterWidth).width,140);
  assert.equal(modelSketchDimensionValues(reverted).width,120);
  assert.equal(reverted.document.revision,afterWidth.document.revision+1);
  assert.equal(serializeModelSession(afterWidth),snapshot,'read/commit does not mutate input');
  const restored=reopenModelSession(serializeModelSession(reverted));
  assert.equal(modelSketchDimensionValues(restored).width,120);
  const undo=undoModelSession(restored);
  assert.equal(modelSketchDimensionValues(undo).width,140);
  assert.equal(modelSketchDimensionValues(redoModelSession(undo)).width,120);
});

test('history compensation checks the full document fence and actual source event',()=>{
  const start=newModelPlateSession('workbench.history.revert.stale');
  const changed=editModelDimension(start,'width',140);
  const menu=inspectWorkbenchHistoricalEdits(changed);
  const row=menu.rows.find(entry=>entry.featureId==='sketch.plate'&&
    entry.fieldChoices.some(choice=>choice.field==='payload'&&choice.status!=='blocked'));
  assert.ok(row);
  const latest=editModelDimension(changed,'depth',85);
  assert.throws(()=>compensateWorkbenchHistoricalField(latest,row,'payload',
    menu.documentFence,true),/stale/i);
  assert.equal(modelSketchDimensionValues(latest).depth,85);
  assert.equal(modelSketchDimensionValues(changed).depth,80);
});

test('history inventory is bounded and inspection does not mutate the authoritative journal',()=>{
  const session=editModelDimension(newModelPlateSession('workbench.history.page'),'width',135);
  const original=model.serializeProject(session.document);
  const page=inspectWorkbenchHistoricalEdits(session,null,1);
  assert.equal(page.format,'intuit3d.historical-edit-inventory');
  assert.ok(page.rows.length<=1);
  assert.equal(page.documentFence,original);
  assert.equal(model.serializeProject(session.document),original);
  assert.equal(page.exactGeometryAuthority,false);
});
