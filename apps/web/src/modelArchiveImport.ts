import type { ModelSession } from './runtimeSession';

/**
 * A file supplied by the OS file picker is untrusted. The expensive archive,
 * history and sketch/solver admission MUST run outside the browser UI thread.
 * No fallback to synchronous reopenModelSession is permitted here.
 */
export const MAX_MODEL_ARCHIVE_BYTES = 4 * 1024 * 1024;
export const MODEL_IMPORT_TIMEOUT_MS = 20_000;

export type ModelImportStage = 'reading' | 'validating' | 'transferring';

type ValidationReply =
  | { kind: 'progress'; stage: ModelImportStage }
  | { kind: 'accepted'; history: ModelSession }
  | { kind: 'refused'; reason: string };

type WorkerRequest = { source: string } | { file: File };

type ImportWorker = Pick<Worker, 'postMessage' | 'terminate'> & {
  onmessage: ((event: MessageEvent<ValidationReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
};

export interface ModelImportOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (stage: ModelImportStage) => void;
  /** Only used by deterministic tests. Production always creates a module worker. */
  createWorker?: () => ImportWorker;
}

function makeWorker(): ImportWorker {
  return new Worker(new URL('./modelArchiveImport.worker.ts', import.meta.url), {
    type: 'module',
    name: 'intuit3d-model-archive-validator',
  });
}

/**
 * Complete the same authoritative RUNTIME.reopen + SKETCH inspection used by
 * the app, but inside a disposable, bounded Worker. A failed/aborted archive
 * cannot mutate the current document and a hung validation can be terminated.
 * Successful history is a structured clone of the *validated* journal, not an
 * independently interpreted browser model or a weakened parse.
 */
export function validateModelArchiveInWorker(
  source: string, options: ModelImportOptions = {},
): Promise<ModelSession> {
  if (typeof source !== 'string' || new Blob([source]).size > MAX_MODEL_ARCHIVE_BYTES)
    return Promise.reject(Error('Model archive exceeds 4 MiB workbench limit.'));
  return validateImportRequest({ source }, options);
}

/**
 * Pass the selected File itself to the disposable Worker. Firefox's main/UI
 * thread must never read or decode its text before the replacement modal.
 * File metadata is bounded here, then independently verified in the Worker.
 * A File is structured-cloned as a Blob; the 4 MiB JSON is not duplicated
 * into a main-thread string or synchronously parsed by the app.
 */
export function validateModelFileInWorker(
  file: File, options: ModelImportOptions = {},
): Promise<ModelSession> {
  if (!file || !Number.isSafeInteger(file.size) ||
      file.size > MAX_MODEL_ARCHIVE_BYTES)
    return Promise.reject(Error('Model archive exceeds 4 MiB workbench limit.'));
  return validateImportRequest({ file }, options);
}

function validateImportRequest(
  request: WorkerRequest, options: ModelImportOptions,
): Promise<ModelSession> {
  if (options.signal?.aborted)
    return Promise.reject(Error('Archive import cancelled.'));
  const timeoutMs = options.timeoutMs ?? MODEL_IMPORT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    return Promise.reject(Error('Invalid archive-validation timeout.'));

  return new Promise<ModelSession>((resolve, reject) => {
    let worker: ImportWorker;
    try { worker = (options.createWorker ?? makeWorker)(); }
    catch {
      reject(Error('Archive validation worker could not start; current model is unchanged.'));
      return;
    }
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const finish = (error?: Error, history?: ModelSession) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else if (history) resolve(history);
      else reject(Error('Archive validator returned no history.'));
    };
    const onAbort = () => finish(Error('Archive import cancelled.'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) { onAbort(); return; }
    worker.onmessage = event => {
      const reply = event.data;
      if (reply?.kind === 'progress' &&
          ['reading','validating','transferring'].includes(reply.stage)) {
        try { options.onProgress?.(reply.stage); }
        catch { /* Presentation callbacks cannot invalidate the worker result. */ }
      } else if (reply?.kind === 'refused' && typeof reply.reason === 'string') {
        finish(Error(reply.reason));
      } else if (reply?.kind === 'accepted' &&
          reply.history?.format === 'intuit3d.undo-history' &&
          typeof reply.history.document?.projectId === 'string' &&
          typeof reply.history.documentFence === 'string' &&
          Array.isArray(reply.history.undoStack) &&
          Array.isArray(reply.history.redoStack)) {
        finish(undefined, reply.history);
      } else {
        finish(Error('Archive validator returned an invalid message.'));
      }
    };
    worker.onerror = event => {
      event.preventDefault();
      finish(Error('Archive validation worker failed; current model is unchanged.'));
    };
    worker.onmessageerror = () =>
      finish(Error('Archive validation result could not be transferred.'));
    timer = setTimeout(() =>
      finish(Error('Archive validation timed out; current model is unchanged.')), timeoutMs);
    try { worker.postMessage(request); }
    catch { finish(Error('Archive could not be sent for isolated validation.')); }
  });
}
