/** Privacy-respecting evidence for an actual browser import attempt.
 * Never include a filename, archive bytes, project identity, journal or GPU details.
 * A stage observation is not evidence that Firefox has completed the next stage.
 */
export const IMPORT_TRACE_FORMAT = 'intuit3d.browser-import-stage-trace' as const;
export type ImportTraceStage =
  | 'file_selected' | 'worker_reading' | 'worker_validating'
  | 'worker_transferring' | 'confirmation_ready'
  | 'replacement_confirmed' | 'cancelled' | 'rejected';
export type ImportTraceEntry = Readonly<{stage:ImportTraceStage;elapsedMs:number}>;

const stages:readonly ImportTraceStage[] = [
  'file_selected','worker_reading','worker_validating','worker_transferring',
  'confirmation_ready','replacement_confirmed','cancelled','rejected',
];

/** Retain a bounded, monotonic sequence. No untrusted error text is stored. */
export function appendImportTrace(
  previous:readonly ImportTraceEntry[],stage:ImportTraceStage,elapsedMs:number,
):readonly ImportTraceEntry[] {
  if(!stages.includes(stage) || !Number.isFinite(elapsedMs) || elapsedMs<0)
    throw Error('Invalid import stage observation.');
  if(previous.at(-1)?.stage===stage)return previous;
  const elapsed=Math.max(Math.round(elapsedMs),previous.at(-1)?.elapsedMs??0);
  return [...previous,{stage,elapsedMs:elapsed}].slice(-24);
}

/** A copyable/downloadable local diagnostic, intentionally without source data. */
export function serializeImportTrace(entries:readonly ImportTraceEntry[]):string {
  if(!entries.length || entries.length>24 || entries.some(entry=>
    !stages.includes(entry.stage)||!Number.isSafeInteger(entry.elapsedMs)||
    entry.elapsedMs<0))
    throw Error('No valid browser import stage observations.');
  return JSON.stringify({
    format:IMPORT_TRACE_FORMAT,version:1,
    scope:'Browser event/isolated Worker stage observation only',
    stages:entries.map(({stage,elapsedMs})=>({stage,elapsedMs})),
    privacy:'No selected path, filename, archive bytes, project identity or journal values.',
    limitations:'A stage marker does not prove OS file-picker, Firefox GPU or runtime correctness.',
  },null,2)+'\n';
}
