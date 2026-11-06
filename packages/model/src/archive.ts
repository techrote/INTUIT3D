/**
 * @intuit3d/model/archive — self-contained, versioned semantic project/undo
 * snapshots with explicit, non-destructive recovery classification.
 *
 * A serialized archive holds the authoritative project AND its undo sidecar in
 * one logical write unit. Callers must still use crash-atomic file replacement;
 * neither a JSON string nor a browser localStorage write is an atomic disk save.
 * No evaluated geometry, preview mesh, provider cache or STEP claim is stored.
 */
import {
  ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { JournalEvent } from './index.ts';
import {
  parseUndoHistory, serializeUndoHistory, startUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const MODEL_ARCHIVE_FORMAT = 'intuit3d.model-archive' as const;
export const MODEL_ARCHIVE_VERSION = 1 as const;
/** Explicit input bound; larger projects require a new, qualified storage format. */
export const MAX_MODEL_ARCHIVE_BYTES = 32 * 1024 * 1024;

export interface ModelArchive {
  readonly format: typeof MODEL_ARCHIVE_FORMAT;
  readonly version: typeof MODEL_ARCHIVE_VERSION;
  readonly projectId: string;
  readonly revision: number;
  /** Includes authoritative journal and its revision-fenced undo/redo frames. */
  readonly history: UndoHistory;
}

export type ArchiveRecoveryStatus =
  | 'primary_current'
  | 'backup_recovery'
  | 'backup_ahead'
  | 'history_ambiguity'
  | 'diverged'
  | 'unrecoverable';

export interface ArchiveRecoveryInspection {
  readonly status: ArchiveRecoveryStatus;
  /** Validated candidates, never silently promoted or written to disk. */
  readonly primary: ModelArchive | null;
  readonly backup: ModelArchive | null;
  readonly diagnostics: readonly string[];
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectFormatError('model archive must be an object');
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new ProjectFormatError('model archive must be a plain object');
  }
  return value as Record<string, unknown>;
}

function boundedText(text: string): void {
  if (typeof text !== 'string' || text.length > MAX_MODEL_ARCHIVE_BYTES ||
      new TextEncoder().encode(text).byteLength > MAX_MODEL_ARCHIVE_BYTES) {
    throw new ProjectFormatError('model archive exceeds UTF-8 size bound');
  }
}

/** Capture a detached, validated snapshot from the in-memory undo session. */
export function createModelArchive(value: UndoHistory): ModelArchive {
  const history = parseUndoHistory(value);
  return {
    format: MODEL_ARCHIVE_FORMAT, version: MODEL_ARCHIVE_VERSION,
    projectId: history.document.projectId,
    revision: history.document.revision, history,
  };
}

/** Strictly validate all archive keys, schema, journal and undo integrity fence. */
export function parseModelArchive(value: unknown): ModelArchive {
  const obj = object(value);
  const keys = ['format', 'version', 'projectId', 'revision', 'history'];
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) {
      throw new ProjectFormatError('unsupported model archive field ' + key);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(obj, key)) {
      throw new ProjectFormatError('model archive missing required field ' + key);
    }
  }
  if (obj.format !== MODEL_ARCHIVE_FORMAT || obj.version !== MODEL_ARCHIVE_VERSION) {
    throw new ProjectFormatError('unsupported model archive format/version');
  }
  const history = parseUndoHistory(obj.history);
  if (obj.projectId !== history.document.projectId ||
      obj.revision !== history.document.revision) {
    throw new ProjectRevisionError('model archive metadata disagrees with journal');
  }
  return createModelArchive(history);
}

export function serializeModelArchive(value: ModelArchive): string {
  const text = JSON.stringify(parseModelArchive(value));
  boundedText(text);
  return text;
}

export function deserializeModelArchive(text: string): ModelArchive {
  boundedText(text);
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { throw new ProjectFormatError('invalid model archive JSON'); }
  return parseModelArchive(data);
}

/**
 * Deliberately discard all undo and redo frames without truncating ONE journal
 * event or changing any stable feature ID. The caller must supply a complete
 * exact session fence and the explicit destructive-history acknowledgement.
 *
 * This is an undo-depth checkpoint, NOT journal compaction or proof of an
 * atomically persisted file. Only call after an application's save/confirm UX.
 */
export function checkpointUndoHistory(
  value: UndoHistory,
  expectedSessionSnapshot: string,
  acknowledgement: 'discard-undo-redo',
): UndoHistory {
  const current = parseUndoHistory(value);
  if (typeof expectedSessionSnapshot !== 'string' ||
      serializeUndoHistory(current) !== expectedSessionSnapshot) {
    throw new ProjectRevisionError('stale undo checkpoint session fence');
  }
  if (acknowledgement !== 'discard-undo-redo') {
    throw new ProjectFormatError('explicit undo/redo history discard required');
  }
  return startUndoHistory(current.document);
}

function journalPrefix(older: readonly JournalEvent[], newer: readonly JournalEvent[]): boolean {
  if (older.length > newer.length) return false;
  for (let i = 0; i < older.length; i++) {
    // Canonical project parser has already validated and cloned all events.
    // Differing JSON member order conservatively requires human reconciliation.
    if (JSON.stringify(older[i]) !== JSON.stringify(newer[i])) return false;
  }
  return true;
}

function candidate(text: string | null | undefined): { archive: ModelArchive | null; reason: string | null } {
  if (text == null) return { archive: null, reason: 'not present' };
  try { return { archive: deserializeModelArchive(text), reason: null }; }
  catch (error) {
    if (error instanceof ProjectFormatError || error instanceof ProjectRevisionError) {
      return { archive: null, reason: error.name + ': ' + error.message };
    }
    throw error;
  }
}

/**
 * Classify primary/backup documents without selecting a potentially stale
 * "last good" value as current. Only primary_current is safe to present as the
 * primary document. Every recovery/ambiguity status requires explicit user
 * reconciliation before changing any disk or in-memory authoritative project.
 */
export function inspectModelArchiveRecovery(
  primaryText: string | null | undefined,
  backupText: string | null | undefined,
): ArchiveRecoveryInspection {
  const p = candidate(primaryText), b = candidate(backupText);
  const diagnostics: string[] = [];
  if (p.reason) diagnostics.push('primary: ' + p.reason);
  if (b.reason) diagnostics.push('backup: ' + b.reason);
  const result = (status: ArchiveRecoveryStatus): ArchiveRecoveryInspection => ({
    status, primary: p.archive, backup: b.archive, diagnostics,
  });
  if (!p.archive) return result(b.archive ? 'backup_recovery' : 'unrecoverable');
  if (!b.archive) return result('primary_current');
  const primary = p.archive, backup = b.archive;
  if (primary.projectId !== backup.projectId) {
    diagnostics.push('different project IDs; do not combine');
    return result('diverged');
  }
  const pJournal = primary.history.document.journal;
  const bJournal = backup.history.document.journal;
  if (primary.revision === backup.revision) {
    if (!journalPrefix(pJournal, bJournal)) {
      diagnostics.push('same revision but incompatible authored journals');
      return result('diverged');
    }
    if (serializeModelArchive(primary) !== serializeModelArchive(backup)) {
      diagnostics.push('same journal but conflicting undo/redo session history');
      return result('history_ambiguity');
    }
    return result('primary_current');
  }
  if (primary.revision > backup.revision && journalPrefix(bJournal, pJournal)) {
    return result('primary_current');
  }
  if (backup.revision > primary.revision && journalPrefix(pJournal, bJournal)) {
    diagnostics.push('backup is newer; explicit recovery admission required');
    return result('backup_ahead');
  }
  diagnostics.push('neither journal extends the other; no automatic recovery');
  return result('diverged');
}
