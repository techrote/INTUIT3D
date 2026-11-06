/**
 * @intuit3d/model/transactions — versioned, append-only speculative commands
 * and durable undo/redo of semantic intent.
 *
 * The only authoritative CAD state remains ProjectDocument.journal. History
 * stacks describe reversible user commands, never cached geometric results.
 * Undo/redo append compensating events; they do not erase semantic identities
 * or rewind project revisions.
 */
import {
  commitEvent, featuresOf, newProject, parseProject, planProject,
  ProjectFormatError, ProjectRevisionError, serializeProject,
} from './index.ts';
import type {
  EvaluationPlan, Feature, FeaturePatch, JournalEvent, ProjectDocument,
} from './index.ts';

export const UNDO_HISTORY_FORMAT = 'intuit3d.undo-history' as const;
export const UNDO_HISTORY_VERSION = 1 as const;
export const MAX_TRANSACTION_EVENTS = 64;
export const MAX_HISTORY_FRAMES = 256;

export type IntentCommand =
  | { readonly type: 'feature.create'; readonly feature: Feature }
  | { readonly type: 'feature.edit'; readonly featureId: string; readonly patch: FeaturePatch }
  | { readonly type: 'feature.remove' | 'feature.restore'; readonly featureId: string };

export interface TransactionPreview {
  /** A fully validated speculative revision, not committed by the caller. */
  readonly document: ProjectDocument;
  readonly plan: EvaluationPlan;
  /** Compensating commands in application order, without allocated event IDs. */
  readonly inverseCommands: readonly IntentCommand[];
}

export interface UndoHistory {
  readonly format: typeof UNDO_HISTORY_FORMAT;
  readonly version: typeof UNDO_HISTORY_VERSION;
  readonly document: ProjectDocument;
  /** Exact canonical document snapshot fence; detects accidental session divergence. */
  readonly documentFence: string;
  /** Top frame is last. Each frame is one atomic user transaction. */
  readonly undoStack: readonly (readonly IntentCommand[])[];
  readonly redoStack: readonly (readonly IntentCommand[])[];
}

function assertRevision(doc: ProjectDocument, expectedRevision: number): void {
  if (doc.revision !== expectedRevision) {
    throw new ProjectRevisionError('stale transaction: expected revision ' +
      expectedRevision + ', actual ' + doc.revision);
  }
}

function boundedEvents(events: readonly JournalEvent[]): void {
  if (!Array.isArray(events) || events.length < 1 ||
      events.length > MAX_TRANSACTION_EVENTS) {
    throw new ProjectFormatError('transaction requires 1-' +
      MAX_TRANSACTION_EVENTS + ' events');
  }
}

function commandFromEvent(event: JournalEvent): IntentCommand {
  switch (event.type) {
    case 'feature.create': return { type: event.type, feature: event.feature };
    case 'feature.edit':
      return { type: event.type, featureId: event.featureId, patch: event.patch };
    case 'feature.remove':
    case 'feature.restore': return { type: event.type, featureId: event.featureId };
  }
}

/**
 * Validate a stored compensating command using the authoritative v1 event
 * parser, without demanding that it be applicable to a *different* revision.
 * The real document preconditions are checked atomically during undo/redo.
 */
function canonicalCommand(value: unknown): IntentCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
       Object.getPrototypeOf(value) !== null)) {
    throw new ProjectFormatError('history command must be a plain object');
  }
  const command = value as Record<string, unknown>;
  const type = command.type;
  let scratch = newProject('validation.project');
  if (type !== 'feature.create') {
    const id = command.featureId;
    // The synthetic feature gives edit/remove/restore a valid semantic target.
    scratch = commitEvent(scratch, {
      eventId: 'validation.create', type: 'feature.create',
      feature: { id: id as string, kind: 'validation', dependsOn: [],
        writeTargets: [], payload: {} },
    });
    if (type === 'feature.restore') {
      scratch = commitEvent(scratch, {
        eventId: 'validation.remove', type: 'feature.remove',
        featureId: id as string,
      });
    }
  }
  const accepted = commitEvent(scratch, {
    ...command, eventId: 'validation.command',
  } as JournalEvent);
  return commandFromEvent(accepted.journal[accepted.journal.length - 1]);
}

function canonicalStack(value: unknown, where: string): IntentCommand[][] {
  if (!Array.isArray(value) || value.length > MAX_HISTORY_FRAMES) {
    throw new ProjectFormatError(where + ' must be a bounded frame array');
  }
  return value.map((frame: unknown, i: number) => {
    if (!Array.isArray(frame) || frame.length < 1 ||
        frame.length > MAX_TRANSACTION_EVENTS) {
      throw new ProjectFormatError(where + '[' + i + '] has invalid frame size');
    }
    return frame.map(canonicalCommand);
  });
}

function inverseOf(doc: ProjectDocument, event: JournalEvent): IntentCommand {
  if (event.type === 'feature.create') {
    return { type: 'feature.remove', featureId: event.feature.id };
  }
  if (event.type === 'feature.remove') {
    return { type: 'feature.restore', featureId: event.featureId };
  }
  if (event.type === 'feature.restore') {
    return { type: 'feature.remove', featureId: event.featureId };
  }
  const before = featuresOf(doc).find((f) => f.id === event.featureId);
  if (!before) {
    // commitEvent will also reject this, but no inverse may be invented.
    throw new ProjectFormatError('cannot invert edit of absent feature ' + event.featureId);
  }
  const patch: {
    kind?: string; dependsOn?: readonly string[];
    writeTargets?: readonly string[]; payload?: Feature['payload'];
  } = {};
  if (event.patch.kind !== undefined) patch.kind = before.kind;
  if (event.patch.dependsOn !== undefined) patch.dependsOn = before.dependsOn;
  if (event.patch.writeTargets !== undefined) patch.writeTargets = before.writeTargets;
  if (event.patch.payload !== undefined) patch.payload = before.payload;
  return { type: 'feature.edit', featureId: event.featureId, patch };
}

/**
 * Validate and preview all staged events as a single immutable transaction.
 * Any invalid command, stale revision or duplicate event ID rejects the entire
 * batch; an invalid dependency plan is *returned*, not silently "repaired".
 */
export function previewTransaction(
  input: ProjectDocument, events: readonly JournalEvent[],
  expectedRevision: number = input.revision,
): TransactionPreview {
  const original = parseProject(input);
  assertRevision(original, expectedRevision);
  boundedEvents(events);
  let working = original;
  const inverse: IntentCommand[] = [];
  for (const event of events) {
    // Syntax and preconditions of the proposed event are checked by commitEvent.
    // Compute the inverse from the previous authoritative semantic state.
    const undo = inverseOf(working, event);
    working = commitEvent(working, event);
    inverse.unshift(canonicalCommand(undo));
  }
  return { document: working, plan: planProject(working),
    inverseCommands: inverse };
}

export function commitTransaction(
  doc: ProjectDocument, events: readonly JournalEvent[],
  expectedRevision: number = doc.revision,
): ProjectDocument {
  return previewTransaction(doc, events, expectedRevision).document;
}

export function startUndoHistory(input: ProjectDocument): UndoHistory {
  const document = parseProject(input);
  return { format: UNDO_HISTORY_FORMAT, version: UNDO_HISTORY_VERSION,
    document, documentFence: serializeProject(document),
    undoStack: [], redoStack: [] };
}

/**
 * Reject corrupt/mismatched sidecar data instead of applying stale compensating
 * commands to a different document. This is an *integrity* fence, not a
 * cryptographic authenticity signature or cross-process CAS.
 */
export function parseUndoHistory(value: unknown): UndoHistory {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
       Object.getPrototypeOf(value) !== null)) {
    throw new ProjectFormatError('undo history must be an object');
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!['format', 'version', 'document', 'documentFence',
          'undoStack', 'redoStack'].includes(key)) {
      throw new ProjectFormatError('unsupported undo history field ' + key);
    }
  }
  if (obj.format !== UNDO_HISTORY_FORMAT || obj.version !== UNDO_HISTORY_VERSION) {
    throw new ProjectFormatError('unsupported undo history format/version');
  }
  const document = parseProject(obj.document);
  const fence = serializeProject(document);
  if (obj.documentFence !== fence) {
    throw new ProjectRevisionError('undo history document diverged from saved fence');
  }
  return { format: UNDO_HISTORY_FORMAT, version: UNDO_HISTORY_VERSION,
    document, documentFence: fence,
    undoStack: canonicalStack(obj.undoStack, 'undoStack'),
    redoStack: canonicalStack(obj.redoStack, 'redoStack') };
}

export function serializeUndoHistory(value: UndoHistory): string {
  return JSON.stringify(parseUndoHistory(value));
}

export function deserializeUndoHistory(text: string): UndoHistory {
  let source: unknown;
  try { source = JSON.parse(text); }
  catch { throw new ProjectFormatError('invalid undo history JSON'); }
  return parseUndoHistory(source);
}

function nextHistory(
  document: ProjectDocument, undoStack: readonly (readonly IntentCommand[])[],
  redoStack: readonly (readonly IntentCommand[])[],
): UndoHistory {
  return { format: UNDO_HISTORY_FORMAT, version: UNDO_HISTORY_VERSION,
    document, documentFence: serializeProject(document), undoStack, redoStack };
}

/** Group 1-64 authored events as one undoable edit. A new edit clears redo. */
export function commitUndoableTransaction(
  value: UndoHistory, events: readonly JournalEvent[],
  expectedRevision: number = value.document.revision,
): UndoHistory {
  const session = parseUndoHistory(value);
  assertRevision(session.document, expectedRevision);
  if (session.undoStack.length >= MAX_HISTORY_FRAMES) {
    throw new ProjectFormatError('undo history capacity reached; explicit checkpoint required');
  }
  const preview = previewTransaction(session.document, events, expectedRevision);
  return nextHistory(preview.document,
    [...session.undoStack, preview.inverseCommands], []);
}

function applyCompensating(
  document: ProjectDocument, commands: readonly IntentCommand[],
  allocatedEventIds: readonly string[],
): TransactionPreview {
  if (!Array.isArray(allocatedEventIds) ||
      allocatedEventIds.length !== commands.length) {
    throw new ProjectFormatError('supply exactly one fresh event ID per compensating command');
  }
  const events = commands.map((command, i) =>
    ({ ...command, eventId: allocatedEventIds[i] } as JournalEvent));
  return previewTransaction(document, events);
}

/** Undo always appends fresh events; IDs and journal ancestry remain durable. */
export function undoTransaction(
  value: UndoHistory, eventIds: readonly string[],
  expectedRevision: number = value.document.revision,
): UndoHistory {
  const session = parseUndoHistory(value);
  assertRevision(session.document, expectedRevision);
  const commands = session.undoStack[session.undoStack.length - 1];
  if (!commands) throw new ProjectRevisionError('no transaction to undo');
  if (session.redoStack.length >= MAX_HISTORY_FRAMES) {
    throw new ProjectFormatError('redo history capacity reached');
  }
  const result = applyCompensating(session.document, commands, eventIds);
  return nextHistory(result.document, session.undoStack.slice(0, -1),
    [...session.redoStack, result.inverseCommands]);
}

/** Redo applies newly derived semantic commands, not the original create IDs. */
export function redoTransaction(
  value: UndoHistory, eventIds: readonly string[],
  expectedRevision: number = value.document.revision,
): UndoHistory {
  const session = parseUndoHistory(value);
  assertRevision(session.document, expectedRevision);
  const commands = session.redoStack[session.redoStack.length - 1];
  if (!commands) throw new ProjectRevisionError('no transaction to redo');
  if (session.undoStack.length >= MAX_HISTORY_FRAMES) {
    throw new ProjectFormatError('undo history capacity reached');
  }
  const result = applyCompensating(session.document, commands, eventIds);
  return nextHistory(result.document,
    [...session.undoStack, result.inverseCommands], session.redoStack.slice(0, -1));
}
