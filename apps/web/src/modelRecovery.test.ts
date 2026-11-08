import test from 'node:test';
import assert from 'node:assert/strict';
import {editModelDimension,newModelPlateSession,serializeModelSession} from './runtimeSession.ts';
import {makeLocalRecoveryRecord,listLocalRecoveries} from './modelRecovery.ts';
import {MAX_MODEL_ARCHIVE_BYTES} from './modelArchiveImport.ts';

test('browser recovery copies authentic journal, undo frames and export-request status',()=>{
  const original=newModelPlateSession('recovery.test');
  const edited=editModelDimension(original,'thickness',12);
  const archive=serializeModelSession(edited);
  const snap=makeLocalRecoveryRecord(edited,'session.test-1',archive,false,123456);
  assert.equal(snap.format,'intuit3d.local-recovery');
  assert.equal(snap.version,1);
  assert.equal(snap.archive,archive);
  assert.equal(snap.projectId,edited.document.projectId);
  assert.equal(snap.revision,edited.document.revision);
  assert.equal(snap.undoFrames,edited.undoStack.length);
  assert.equal(snap.redoFrames,edited.redoStack.length);
  assert.equal(snap.updatedAt,123456);
  assert.equal(snap.bytes,new Blob([archive]).size);
  assert.equal(snap.exportRequested,false);
  assert.equal(makeLocalRecoveryRecord(edited,'session.test-1',archive,true).exportRequested,true);
  assert.notEqual(snap.archive,serializeModelSession(original));
});

test('recovery limits IDs, timestamps and maximum restorable archive size',()=>{
  const model=newModelPlateSession('recovery.validation');
  assert.throws(()=>makeLocalRecoveryRecord(model,'../../escape','{}',false),/session key/);
  assert.throws(()=>makeLocalRecoveryRecord(model,'session.ok','{}',false,-1),/timestamp/);
  assert.throws(()=>makeLocalRecoveryRecord(model,'session.ok',
    'a'.repeat(MAX_MODEL_ARCHIVE_BYTES+1),false),/4 MiB/);
});

test('without IndexedDB, storage is explicitly unavailable rather than silently successful',async()=>{
  if(typeof indexedDB==='undefined')
    await assert.rejects(listLocalRecoveries(),/IndexedDB disabled/);
});
