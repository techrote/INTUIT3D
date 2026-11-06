/**
 * Cross-lane consumer qualification of versioned INTENT transactions and
 * SKETCH snaps. Semantic commands and snap predictions never certify a B-rep.
 * This test imports package-public subpaths instead of private source paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newProject, featuresOf, planProject, serializeProject
} from '@intuit3d/model';
import {
  previewTransaction, commitTransaction, startUndoHistory,
  commitUndoableTransaction, undoTransaction, redoTransaction,
  serializeUndoHistory, deserializeUndoHistory
} from '@intuit3d/model/transactions';
import {
  plateSketchFixture, editConstraint, serializeSketch, parseSketch
} from '@intuit3d/sketch';
import { suggestSketchSnaps } from '@intuit3d/sketch/snapping/v1';

const create=(eventId,id,dependsOn=[],writeTargets=[])=>({
  eventId,type:'feature.create',feature:{
    id,kind:'fixture',dependsOn,writeTargets,payload:{thicknessMm:8}
  }
});
const ids=doc=>featuresOf(doc).map(f=>f.id);

test('public INTENT package: grouped out-of-order dependency is planned, undone, reopened and redone',()=>{
  const start=newProject('consumer.project');
  const history=startUndoHistory(start);
  const committed=commitUndoableTransaction(history,[
    create('event.cut','feature.cut',['feature.plate'],['body.plate']),
    create('event.plate','feature.plate',[],['body.plate'])
  ]);
  assert.equal(start.revision,0);
  assert.deepEqual(planProject(committed.document).executableOrder,['feature.plate','feature.cut']);
  assert.deepEqual(ids(committed.document),['feature.cut','feature.plate']);
  const reopened=deserializeUndoHistory(serializeUndoHistory(committed));
  assert.equal(reopened.document.revision,2);
  const undone=undoTransaction(reopened,['event.undo.plate','event.undo.cut']);
  assert.equal(undone.document.revision,4);
  assert.deepEqual(ids(undone.document),[]);
  const redone=redoTransaction(deserializeUndoHistory(serializeUndoHistory(undone)),
    ['event.redo.cut','event.redo.plate']);
  assert.equal(redone.document.revision,6);
  assert.deepEqual(ids(redone.document),['feature.cut','feature.plate']);
  assert.deepEqual(planProject(redone.document).executableOrder,['feature.plate','feature.cut']);
});

test('public INTENT package: invalid second command and stale expected revision are atomic failures',()=>{
  const doc=newProject('consumer.atomic');
  const first=create('event.valid','feature.valid');
  const bad={eventId:'event.bad',type:'feature.edit',featureId:'feature.missing',
    patch:{payload:{n:1}}};
  const before=serializeProject(doc);
  assert.throws(()=>previewTransaction(doc,[first,bad]));
  assert.throws(()=>commitTransaction(doc,[first,bad]));
  assert.throws(()=>commitTransaction(doc,[first],3));
  assert.equal(serializeProject(doc),before);
});

test('public INTENT package: diverged persisted sidecar is rejected rather than replayed',()=>{
  const saved=JSON.parse(serializeUndoHistory(startUndoHistory(newProject('consumer.fenced'))));
  saved.documentFence='different project snapshot';
  assert.throws(()=>deserializeUndoHistory(JSON.stringify(saved)));
  const correct=startUndoHistory(newProject('consumer.version'));
  const badVersion={...correct,version:2};
  assert.throws(()=>deserializeUndoHistory(JSON.stringify(badVersion)));
});

test('public SKETCH package: retrospective dimensions change revision-fenced snap candidates',()=>{
  const original=plateSketchFixture();
  const signature=serializeSketch(original);
  const a=suggestSketchSnaps(original,{x:120,y:0},{radiusMm:2});
  assert.equal(a.version,1);
  assert.equal(a.previewOnly,true);
  assert.equal(a.status,'ready');
  assert.equal(a.inputSignature,signature);
  assert.equal(a.selected?.entityId,'p1');
  const updated=parseSketch(serializeSketch(editConstraint(original,'width',{value:140})));
  const b=suggestSketchSnaps(updated,{x:140,y:0},{radiusMm:2});
  assert.equal(b.status,'ready');
  assert.equal(b.selected?.entityId,'p1');
  assert.equal(b.selected?.x,140);
  assert.notEqual(b.inputSignature,a.inputSignature);
  assert.equal(serializeSketch(original),signature);
});

test('public SKETCH package: contradictory and budget-exhausted sketches cannot supply selectable snaps',()=>{
  const contradiction=plateSketchFixture();
  contradiction.constraints.push({
    id:'opposed-width',kind:'distanceX',a:'p0',b:'p1',value:140
  });
  const broken=suggestSketchSnaps(contradiction,{x:120,y:0});
  assert.equal(broken.status,'source_unsolved');
  assert.deepEqual(broken.candidates,[]);
  assert.equal(broken.selected,null);
  const budget=suggestSketchSnaps(plateSketchFixture(),{x:0,y:0},{maxEntities:1});
  assert.equal(budget.status,'budget_exceeded');
  assert.deepEqual(budget.candidates,[]);
  assert.equal(budget.selected,null);
});
