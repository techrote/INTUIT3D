/**
 * @intuit3d/model/parameter-table/v1
 *
 * Edit several existing named parameters as ONE authoritative user action.
 * Values and visible names are not independent stores: expressions reference
 * stable parameter feature IDs; all changes append canonical journal edits.
 *
 * A CAD parameter table can change both thickness and hole spacing together,
 * including mutually exchanged display names, without exposing intermediate
 * invalid revisions to RUNTIME/WORKBENCH. Only FINAL scalar admission is
 * authoritative; SKETCH/native B-rep/STEP must be checked separately.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError,
  ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, JsonRecord, ProjectDocument } from './index.ts';
import {
  previewParameterEdit, PARAMETER_EDIT_FORMAT,
} from './parameter-edit.ts';
import type { ParameterExpression } from './parameters.ts';
import {
  evaluateDimensionBindingPlan,
} from './dimension-bindings.ts';
import type {
  DimensionBindingEvaluation, DimensionFeatureGate,
} from './dimension-bindings.ts';
import {
  commitUndoableTransaction, MAX_TRANSACTION_EVENTS,
  parseUndoHistory, previewTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';

export const PARAMETER_TABLE_FORMAT = 'intuit3d.parameter-table-edit' as const;
export const PARAMETER_TABLE_VERSION = 1 as const;
export const MAX_PARAMETER_TABLE_EDITS = Math.min(32, MAX_TRANSACTION_EVENTS);

export interface ParameterTableEdit {
  readonly eventId: string;
  readonly featureId: string;
  /** Final visible display name, not a dependency identifier. */
  readonly name: string;
  /** Omit to keep the existing expression and change only its display name. */
  readonly expression?: ParameterExpression;
}
export interface ParameterTableRequest {
  readonly format: typeof PARAMETER_TABLE_FORMAT;
  readonly version: typeof PARAMETER_TABLE_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly admission: 'require_admissible' | 'permit_unresolved';
  /** 1–32 distinct existing parameter rows, each with a fresh event ID. */
  readonly edits: readonly ParameterTableEdit[];
}
export interface ParameterTablePreview {
  readonly format: 'intuit3d.parameter-table-preview';
  readonly version: 1;
  readonly document: ProjectDocument;
  readonly events: readonly JournalEvent[];
  readonly evaluation: DimensionBindingEvaluation;
  readonly editedParameterGates: readonly DimensionFeatureGate[];
  readonly invalidation: IncrementalEvaluationPlan;
  readonly renamedParameterIds: readonly string[];
  readonly expressionChangedParameterIds: readonly string[];
  readonly exactGeometryAuthority: false;
}

const SYMBOL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(message: string): never {
  throw new ProjectFormatError('parameter table: ' + message);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exactKeys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field));
}
function admitted(value: DimensionFeatureGate | undefined): boolean {
  return value?.status === 'admissible' || value?.status === 'bound';
}

/**
 * Prepare the FINAL design state, without publishing any intermediate row
 * changes. In particular, a two-row name exchange is valid if the final table
 * has unique names; individual inspector edits would reject it prematurely.
 *
 * Every expression still passes the existing full parameter AST/edge parser.
 * This adapter never removes an old dependency edge, guesses a parameter
 * inverse, or substitutes an authored fallback for an unresolved binding.
 */
export function previewParameterTableEdit(
  source: ProjectDocument, request: ParameterTableRequest,
): ParameterTablePreview {
  const original = parseProject(source);
  if (!plain(request) || !exactKeys(request, [
    'format', 'version', 'expectedProjectId', 'expectedRevision',
    'admission', 'edits',
  ]) || request.format !== PARAMETER_TABLE_FORMAT ||
      request.version !== PARAMETER_TABLE_VERSION ||
      (request.admission !== 'require_admissible' &&
       request.admission !== 'permit_unresolved')) {
    fail('unsupported request');
  }
  if (request.expectedProjectId !== original.projectId ||
      request.expectedRevision !== original.revision) {
    throw new ProjectRevisionError('parameter table: stale project/revision');
  }
  if (!Array.isArray(request.edits) ||
      request.edits.length < 1 || request.edits.length > MAX_PARAMETER_TABLE_EDITS) {
    fail('requires 1-' + MAX_PARAMETER_TABLE_EDITS + ' parameter rows');
  }
  const seenFeatures = new Set<string>();
  const seenEvents = new Set<string>();
  const renamed: string[] = [];
  const changed: string[] = [];
  const events: JournalEvent[] = [];
  let working = original;

  for (const row of request.edits) {
    if (!plain(row) ||
        !(exactKeys(row, ['eventId', 'featureId', 'name']) ||
          exactKeys(row, ['eventId', 'featureId', 'name', 'expression'])) ||
        typeof row.eventId !== 'string' || !ID.test(row.eventId) ||
        typeof row.featureId !== 'string' || !ID.test(row.featureId) ||
        typeof row.name !== 'string' || !SYMBOL.test(row.name) ||
        ('expression' in row && row.expression === undefined)) {
      fail('malformed parameter table row');
    }
    if (seenFeatures.has(row.featureId)) fail('duplicate parameter row: ' + row.featureId);
    if (seenEvents.has(row.eventId)) fail('duplicate event ID: ' + row.eventId);
    seenFeatures.add(row.featureId);
    seenEvents.add(row.eventId);

    const existing = featuresOf(working).find((feature) => feature.id === row.featureId);
    if (!existing || existing.kind !== 'parameter') {
      fail('row must target a living parameter feature: ' + row.featureId);
    }
    const authored = existing.payload.parameter;
    if (!plain(authored) || typeof authored.name !== 'string' ||
        !SYMBOL.test(authored.name)) {
      fail('parameter source has an invalid name: ' + row.featureId);
    }
    const expression = ('expression' in row
      ? row.expression : authored.expression) as ParameterExpression;
    const expressionChanged =
      JSON.stringify(expression) !== JSON.stringify(authored.expression);
    const renamedNow = authored.name !== row.name;
    if (!expressionChanged && !renamedNow) {
      fail('row has no authored change: ' + row.featureId);
    }

    // Reuse full expression syntax/units/ref checking in permissive mode.
    // Only FINAL state may be required admissible; intermediate rows are private.
    const checked = previewParameterEdit(working, {
      format: PARAMETER_EDIT_FORMAT, version: 1,
      eventId: row.eventId, featureId: row.featureId,
      expectedRevision: working.revision, expression,
      admission: 'permit_unresolved',
    });
    if (checked.event.type !== 'feature.edit') fail('unexpected parameter event');
    const event: JournalEvent = {
      type: 'feature.edit', eventId: row.eventId, featureId: row.featureId,
      patch: {
        dependsOn: checked.event.patch.dependsOn,
        payload: { ...existing.payload,
          parameter: { ...authored, name: row.name, expression } as unknown as JsonRecord },
      },
    };
    working = previewTransaction(working, [event], working.revision).document;
    events.push(event);
    if (renamedNow) renamed.push(row.featureId);
    if (expressionChanged) changed.push(row.featureId);
  }

  // Display labels may be exchanged in one transaction but duplicates in the
  // final table (including untouched parameters) must never be committed.
  const labels = new Set<string>();
  for (const feature of featuresOf(working)) {
    if (feature.kind !== 'parameter') continue;
    const data = feature.payload.parameter;
    if (!plain(data) || typeof data.name !== 'string' || !SYMBOL.test(data.name)) {
      fail('existing parameter has an invalid display name: ' + feature.id);
    }
    if (labels.has(data.name)) fail('duplicate final parameter name: ' + data.name);
    labels.add(data.name);
  }

  const final = previewTransaction(original, events, original.revision);
  const evaluation = evaluateDimensionBindingPlan(final.plan);
  const gates = new Map(evaluation.featureGates.map((gate) =>
    [gate.featureId, gate] as const));
  const editedParameterGates = request.edits.map((row) => {
    const gate = gates.get(row.featureId);
    if (!gate) fail('missing parameter gate: ' + row.featureId);
    return gate;
  });
  const invalidation = planIncrementalEvaluation(original, final.document);
  if (request.admission === 'require_admissible') {
    for (const gate of editedParameterGates) {
      if (!admitted(gate)) {
        fail('final parameter not admissible: ' + gate.featureId + ':' + gate.status);
      }
    }
    const before = evaluateDimensionBindingPlan(planProject(original));
    const old = new Map(before.featureGates.map((gate) =>
      [gate.featureId, gate] as const));
    for (const id of invalidation.invalidatedFeatureIds) {
      if (admitted(old.get(id)) && !admitted(gates.get(id))) {
        fail('final edit regresses an admitted dependent feature: ' + id);
      }
    }
  }
  return {
    format: 'intuit3d.parameter-table-preview', version: 1,
    document: final.document, events: final.document.journal.slice(original.revision),
    evaluation, editedParameterGates, invalidation,
    renamedParameterIds: renamed, expressionChangedParameterIds: changed,
    exactGeometryAuthority: false,
  };
}

/** Commit the entire table edit as ONE undoable journal frame. */
export function commitUndoableParameterTableEdit(
  source: UndoHistory, request: ParameterTableRequest,
): UndoHistory {
  const history = parseUndoHistory(source);
  const preview = previewParameterTableEdit(history.document, request);
  return commitUndoableTransaction(history, preview.events, request.expectedRevision);
}
