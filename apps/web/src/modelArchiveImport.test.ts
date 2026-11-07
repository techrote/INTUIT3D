import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MODEL_ARCHIVE_BYTES, validateModelArchiveInWorker,
} from './modelArchiveImport.ts';
import {
  editModelDimension, modelDimensionValues, newModelPlateSession,
  reopenModelSession, redoModelSession, serializeModelSession, undoModelSession,
} from './runtimeSession.ts';

class FakeImportWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  sent: unknown;
  onPost: ((request: unknown) => void) | undefined;
  postMessage(request: unknown) {
    this.sent = request;
    this.onPost?.(request);
  }
  terminate() { this.terminated = true; }
  reply(data: unknown) {
    queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
  }
}
const options = (worker: FakeImportWorker) => ({
  createWorker: () => worker as unknown as Worker,
});

test('isolated import transfers a genuine multi-frame model without erasing journal or undo/redo', async () => {
  let original = newModelPlateSession('workbench.import.worker.multi-edit');
  for (let i = 0; i < 8; i++) {
    original = editModelDimension(original, 'thickness', 11 + i);
  }
  const saved = serializeModelSession(original);
  assert.equal(original.undoStack.length, 8);
  const worker = new FakeImportWorker();
  worker.onPost = request => {
    assert.deepEqual(request, { source: saved });
    // Mirror the actual browser Worker structured-clone boundary.
    worker.reply({kind: 'accepted',
      history: structuredClone(reopenModelSession(saved))});
  };
  const imported = await validateModelArchiveInWorker(saved, options(worker));
  assert.equal(worker.terminated, true, 'completed Worker must not linger');
  assert.equal(serializeModelSession(imported), saved);
  assert.equal(imported.document.projectId, original.document.projectId);
  assert.equal(modelDimensionValues(imported).thickness, 18);
  assert.equal(modelDimensionValues(undoModelSession(imported)).thickness, 17);
  assert.equal(modelDimensionValues(redoModelSession(undoModelSession(imported))).thickness, 18);
});

test('invalid archive is refused without accepting a document', async () => {
  const worker = new FakeImportWorker();
  worker.onPost = () => worker.reply({kind:'refused',reason:'invalid undo history JSON'});
  await assert.rejects(validateModelArchiveInWorker('{',options(worker)),/invalid undo history JSON/);
  assert.equal(worker.terminated,true);
});

test('oversized source never starts a worker', async () => {
  let spawned=false;
  await assert.rejects(validateModelArchiveInWorker('x'.repeat(MAX_MODEL_ARCHIVE_BYTES+1),{
    createWorker:()=>{spawned=true;return new FakeImportWorker() as unknown as Worker;},
  }),/4 MiB/);
  assert.equal(spawned,false);
});

test('a hung worker times out and terminates without publishing a result', async () => {
  const worker = new FakeImportWorker();
  await assert.rejects(validateModelArchiveInWorker('{}',{
    ...options(worker),timeoutMs:10,
  }),/timed out/);
  assert.equal(worker.terminated,true);
  worker.reply({kind:'accepted',history:structuredClone(newModelPlateSession())});
});

test('abort terminates pending validation; old result cannot replace the journal', async () => {
  const worker = new FakeImportWorker();
  const controller = new AbortController();
  const pending = validateModelArchiveInWorker('{}',{
    ...options(worker),signal:controller.signal,
  });
  controller.abort();
  await assert.rejects(pending,/cancelled/);
  assert.equal(worker.terminated,true);
});

test('worker startup, transport and protocol errors fail closed', async () => {
  await assert.rejects(validateModelArchiveInWorker('{}',{
    createWorker:()=>{throw Error('unavailable');},
  }),/could not start/);
  const badWorker = new FakeImportWorker();
  badWorker.onPost=()=>badWorker.reply({kind:'accepted',history:{}});
  await assert.rejects(validateModelArchiveInWorker('{}',options(badWorker)),/invalid message/);
  assert.equal(badWorker.terminated,true);
  const rejectedTransport = new FakeImportWorker();
  rejectedTransport.onPost=()=>{throw Error('DataCloneError');};
  await assert.rejects(validateModelArchiveInWorker('{}',options(rejectedTransport)),/could not be sent/);
  assert.equal(rejectedTransport.terminated,true);
});
