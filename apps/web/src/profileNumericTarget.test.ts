import test from 'node:test';
import assert from 'node:assert/strict';
import type { PointerEditableHandle } from '@intuit3d/sketch/pointer-profile-edit/v1';
import {
  newModelPlateSession, modelSketchDimensionValues, undoModelSession,
  redoModelSession, reopenModelSession, serializeModelSession,
} from './runtimeSession.ts';
import {
  selectModelProfileAtPointer, inspectModelPointerProfile,
  dragModelPointerProfileHandle,
} from './pointerProfileBridge.ts';
import { numericProfileHandleTarget } from './profileNumericTarget.ts';

const handle = (kind: PointerEditableHandle['kind'], dimensionKind: PointerEditableHandle['dimensionKind'],
  valueMm: number | null, x: number, y: number): PointerEditableHandle =>
  ({ handleId:'selected.handle', kind, dimensionKind, constraintIds:['authored.constraint'],
    entityId:'authored.entity', valueMm, position:{x,y} });

test('numeric semantic handle targets preserve the orthogonal axis and signed dimensions',()=>{
  assert.deepEqual(numericProfileHandleTarget(handle('dimension','distanceX',120,120,40),
    {value:'135'}),{x:135,y:40});
  assert.deepEqual(numericProfileHandleTarget(handle('dimension','distanceY',-12,20,30),
    {value:'-20.5'}),{x:20,y:21.5});
  assert.deepEqual(numericProfileHandleTarget(handle('dimension','radius',5,40,15),
    {value:'9.5'}),{x:44.5,y:15});
  assert.deepEqual(numericProfileHandleTarget(handle('hole_center',null,null,20,15),
    {x:'-3.25',y:'16.5'}),{x:-3.25,y:16.5});
});

test('invalid, unchanged or unsupported numeric drafts do not produce a target',()=>{
  const width=handle('dimension','distanceX',120,120,40);
  for(const value of ['', 'Infinity', 'NaN', '10000.1', '120'])
    assert.throws(()=>numericProfileHandleTarget(width,{value}),Error);
  assert.throws(()=>numericProfileHandleTarget(handle('dimension','radius',5,10,5),
    {value:'0'}),/positive/i);
  assert.throws(()=>numericProfileHandleTarget(handle('hole_center',null,null,20,15),
    {x:'20',y:'15'}),/unchanged/i);
  assert.throws(()=>numericProfileHandleTarget(handle('hole_center',null,null,20,15),
    {x:'4',y:' ' }),/required/i);
});

test('selected numeric width edit is one actual RUNTIME journal event with archive undo and redo',()=>{
  const initial=newModelPlateSession('workbench.numeric.selected');
  const chosen=selectModelProfileAtPointer(initial,60,65);
  assert.equal(chosen.kind,'selected');
  if(chosen.kind!=='selected')return;
  const inventory=inspectModelPointerProfile(initial,chosen.selection);
  assert.equal(inventory.kind,'pointer_editable_handles');
  if(inventory.kind!=='pointer_editable_handles')return;
  const width=inventory.handles.find(item=>item.kind==='dimension'&&
    item.dimensionKind==='distanceX'&&item.valueMm===120);
  assert.ok(width,'Selected profile must expose the solver-owned plate width');
  const original=serializeModelSession(initial);
  const target=numericProfileHandleTarget(width,{value:'135'});
  const changed=dragModelPointerProfileHandle(initial,chosen.selection,width.handleId,target);
  assert.equal(changed.history.document.revision,initial.document.revision+1);
  assert.equal(modelSketchDimensionValues(changed.history).width,135);
  assert.equal(serializeModelSession(initial),original,'Prior authoritative journal mutated');
  assert.ok(changed.invalidatedFeatureIds.includes('plate'));
  const restored=reopenModelSession(serializeModelSession(changed.history));
  assert.equal(modelSketchDimensionValues(restored).width,135);
  assert.equal(modelSketchDimensionValues(undoModelSession(restored)).width,120);
  assert.equal(modelSketchDimensionValues(redoModelSession(undoModelSession(restored))).width,135);
  assert.throws(()=>dragModelPointerProfileHandle(changed.history,chosen.selection,
    width.handleId,target),/stale/i,'Old selected handle must not author twice');
});
