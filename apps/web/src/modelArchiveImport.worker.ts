import { reopenModelSession } from './runtimeSession';
import type { ModelSession } from './runtimeSession';

const MAX_MODEL_ARCHIVE_BYTES = 4 * 1024 * 1024;
type WorkerRequest = { source: string };
type WorkerReply =
  | { kind: 'accepted'; history: ModelSession }
  | { kind: 'refused'; reason: string };

/**
 * This worker is single-use. The parent terminates it after the first reply
 * or on timeout/cancellation. No STEP, mesh or document mutation occurs here.
 */
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  let reply: WorkerReply;
  try {
    const source = event.data?.source;
    if (typeof source !== 'string' ||
        new Blob([source]).size > MAX_MODEL_ARCHIVE_BYTES)
      throw Error('Model archive exceeds 4 MiB workbench limit.');
    reply = { kind: 'accepted', history: reopenModelSession(source) };
  } catch (error) {
    reply = {
      kind: 'refused',
      reason: error instanceof Error ? error.message : 'Archive validation failed.',
    };
  }
  self.postMessage(reply);
};
