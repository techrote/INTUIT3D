import { reopenModelSession } from './runtimeSession';
import type { ModelSession } from './runtimeSession';

const MAX_MODEL_ARCHIVE_BYTES = 4 * 1024 * 1024;
type WorkerRequest = { source: string } | { file: File };
type WorkerReply =
  | { kind: 'progress'; stage: 'reading' | 'validating' | 'transferring' }
  | { kind: 'accepted'; history: ModelSession }
  | { kind: 'refused'; reason: string };

/**
 * Single-use, disposable Worker. The OS File is read and parsed here, not
 * inside the React event handler. All RUNTIME/INTENT journal validation and
 * SKETCH evaluation remain authoritative; no fallback main-thread parsing.
 * Stage notifications identify a potential Firefox stall without logging
 * private model contents. The UI can terminate even a stuck validation.
 */
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(reply: WorkerReply): void;
};
workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  let reply: WorkerReply;
  try {
    const request = event.data;
    let source: string;
    if (request && 'file' in request) {
      const file = request.file;
      if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) ||
          file.size > MAX_MODEL_ARCHIVE_BYTES)
        throw Error('Model archive exceeds 4 MiB workbench limit.');
      workerScope.postMessage({ kind: 'progress', stage: 'reading' });
      source = await file.text();
    } else {
      source = request?.source;
    }
    if (typeof source !== 'string' ||
        new Blob([source]).size > MAX_MODEL_ARCHIVE_BYTES)
      throw Error('Model archive exceeds 4 MiB workbench limit.');
    workerScope.postMessage({ kind: 'progress', stage: 'validating' });
    const history = reopenModelSession(source);
    workerScope.postMessage({ kind: 'progress', stage: 'transferring' });
    reply = { kind: 'accepted', history };
  } catch (error) {
    reply = {
      kind: 'refused',
      reason: error instanceof Error ? error.message : 'Archive validation failed.',
    };
  }
  workerScope.postMessage(reply);
};
