import test from 'node:test';
import assert from 'node:assert/strict';
import { editModelDimension, newModelPlateSession } from './runtimeSession.ts';
import { checkedModelArchiveSize, modelArchiveDownloadName, modelArchiveSummary } from './modelFileLifecycle.ts';
import { MAX_MODEL_ARCHIVE_BYTES } from './modelArchiveImport.ts';

test('download filename follows authoritative project and revision, never fixed plate',()=>{
  const first=newModelPlateSession('workbench.sketch.user-12');
  const next=editModelDimension(first,'thickness',12);
  assert.match(modelArchiveDownloadName(first),/^intuit3d-workbench[.]sketch[.]user-12-r\d+[.]i3d-model[.]json$/);
  assert.notEqual(modelArchiveDownloadName(first),modelArchiveDownloadName(next));
  const unsafe=modelArchiveDownloadName(newModelPlateSession('../../folder\\unsafe:;name'));
  assert.match(unsafe,/^intuit3d-[a-zA-Z0-9._-]+-r\d+[.]i3d-model[.]json$/);
  assert.ok(!unsafe.includes('..')&&!unsafe.includes('/')&&!unsafe.includes('\\'));
});

test('replacement review reads actual journal revision and undo/redo frames',()=>{
  const initial=newModelPlateSession('workbench.import.review');
  const edited=editModelDimension(initial,'thickness',15);
  const row=modelArchiveSummary(edited);
  assert.equal(row.projectId,'workbench.import.review');
  assert.equal(row.revision,edited.document.revision);
  assert.equal(row.undoFrames,edited.undoStack.length);
  assert.equal(row.redoFrames,edited.redoStack.length);
  assert.notDeepEqual(row,modelArchiveSummary(initial));
});

test('export size uses UTF-8 bytes and refuses unopenable archives',()=>{
  assert.equal(checkedModelArchiveSize('你好'),6);
  assert.equal(checkedModelArchiveSize('a'.repeat(MAX_MODEL_ARCHIVE_BYTES)),MAX_MODEL_ARCHIVE_BYTES);
  assert.throws(()=>checkedModelArchiveSize('a'.repeat(MAX_MODEL_ARCHIVE_BYTES+1)),/4 MiB import limit/);
  assert.throws(()=>checkedModelArchiveSize('€'.repeat(Math.floor(MAX_MODEL_ARCHIVE_BYTES/3)+1)),/4 MiB import limit/);
});
