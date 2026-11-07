import type { ModelSession } from './runtimeSession';
import { MAX_MODEL_ARCHIVE_BYTES } from './modelArchiveImport.ts';

/** Generate an OS-safe download basename from the authoritative project ID. */
export function modelArchiveDownloadName(history: Pick<ModelSession,'document'>): string {
  const stem=history.document.projectId.replace(/[^a-zA-Z0-9._-]+/g,'-')
    .replace(/\.{2,}/g,'.').replace(/^[._-]+|[._-]+$/g,'')
    .slice(0,72).replace(/[._-]+$/g,'') || 'project';
  return 'intuit3d-'+stem+'-r'+history.document.revision+'.i3d-model.json';
}

/** A display projection, never a browser-authoritative journal or solver. */
export function modelArchiveSummary(history: ModelSession) {
  return { projectId:history.document.projectId,revision:history.document.revision,
    undoFrames:history.undoStack.length,redoFrames:history.redoStack.length };
}

/** Disallow a download that the same app would reject on reopening. */
export function checkedModelArchiveSize(source:string):number {
  const size=new Blob([source]).size; // UTF-8 bytes, not JavaScript characters.
  if(size>MAX_MODEL_ARCHIVE_BYTES)
    throw Error('Archive exceeds 4 MiB import limit; no unusable file was downloaded. Reduce project history before exporting or use a supported larger archive workflow.');
  return size;
}
