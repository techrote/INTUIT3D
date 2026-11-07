/**
 * @intuit3d/model/parameter-edit — versioned, revision-fenced and undoable
 * re-authoring of an existing scalar parameter expression.
 *
 * This edits the authoritative journal, not a resolved dimension or mesh.
 * Parameter IDs and authored feature chronology are stable. Retrospective
 * bindings in geometry features resolve on the next derived evaluation.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, ProjectDocument, JsonRecord } from './index.ts';
import {
  previewTransaction, commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { collectDimensionParameterReferences } from './dimension-edit.ts';
import { evaluateDimensionBindingPlan } from './dimension-bindings.ts';
import type { DimensionBindingEvaluation, DimensionFeatureGate } from './dimension-bindings.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import type { ParameterExpression } from './parameters.ts';

export const PARAMETER_EDIT_FORMAT = 'intuit3d.parameter-edit' as const;
export const PARAMETER_EDIT_VERSION = 1 as const;

export interface ParameterEditRequest {
  readonly format: typeof PARAMETER_EDIT_FORMAT;
  readonly version: typeof PARAMETER_EDIT_VERSION;
  /** Fresh event ID allocated by the authoring application. */
  readonly eventId: string;
  /** Stable ID of an already-authored parameter feature. */
  readonly featureId: string;
  readonly expectedRevision: number;
  /** New source expression; never a cached evaluated value. */
  readonly expression: ParameterExpression;
  /** Strict mode protects previously admitted dependent scalar features. */
  readonly admission: 'require_admissible' | 'permit_unresolved';
}

export interface ParameterEditPreview {
  readonly format: 'intuit3d.parameter-edit-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly evaluation: DimensionBindingEvaluation;
  readonly parameterGate: DimensionFeatureGate;
  readonly invalidation: IncrementalEvaluationPlan;
}

const UNITS: ReadonlySet<unknown> = new Set(['unitless', 'mm', 'deg']);
const SYMBOL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function fail(message: string): never { throw new ProjectFormatError(message); }
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key));
}
function admitted(gate: DimensionFeatureGate | undefined): boolean {
  return gate?.status === 'admissible' || gate?.status === 'bound';
}

/**
 * Speculatively edit an already-created parameter. A forward reference is
 * preserved as a pending model dependency in permissive mode. Existing edges
 * are NEVER removed: they might encode separately authored ordering intent.
 *
 * Strict mode also checks every *previously admitted* invalidated feature, so
 * a parameter edit cannot silently break a consumer's dimension binding.
 * Geometry validity/positivity remain SKETCH/KERNEL/RUNTIME responsibilities.
 */
export function previewParameterEdit(
  input: ProjectDocument, request: ParameterEditRequest,
): ParameterEditPreview {
  const document = parseProject(input);
  if (!plain(request) || !exactKeys(request, [
    'format', 'version', 'eventId', 'featureId', 'expectedRevision',
    'expression', 'admission',
  ]) || request.format !== PARAMETER_EDIT_FORMAT ||
      request.version !== PARAMETER_EDIT_VERSION) {
    fail('unsupported parameter edit request');
  }
  if (document.revision !== request.expectedRevision) {
    throw new ProjectRevisionError('stale parameter edit revision: expected ' +
      request.expectedRevision + ', actual ' + document.revision);
  }
  if (request.admission !== 'permit_unresolved' &&
      request.admission !== 'require_admissible') fail('unsupported parameter admission mode');

  const features = featuresOf(document);
  const feature = features.find((item) => item.id === request.featureId);
  if (!feature || feature.kind !== 'parameter') {
    fail('parameter edit requires an existing parameter feature: ' + request.featureId);
  }
  const previous = feature.payload.parameter;
  if (!plain(previous) || !exactKeys(previous, ['name', 'unit', 'expression']) ||
      typeof previous.name !== 'string' || !SYMBOL.test(previous.name) ||
      !UNITS.has(previous.unit)) {
    fail('parameter source must have a valid name/unit and explicit expression field');
  }

  // Validate the full new AST *even if its referenced features do not exist*.
  // A deferred reference must not conceal a malformed or cyclic expression.
  const refs = collectDimensionParameterReferences(request.expression);
  const edges = [...feature.dependsOn];
  for (const ref of refs) {
    const target = features.find((item) => item.id === ref);
    if (target && target.kind !== 'parameter') {
      fail('parameter expression references a non-parameter feature: ' + ref);
    }
    if (!edges.includes(ref)) edges.push(ref);
  }

  const payload = {
    ...feature.payload,
    parameter: { name: previous.name, unit: previous.unit, expression: request.expression },
  } as unknown as JsonRecord;
  const event: JournalEvent = {
    eventId: request.eventId,
    type: 'feature.edit',
    featureId: feature.id,
    patch: { dependsOn: edges, payload },
  };
  const preview = previewTransaction(document, [event], request.expectedRevision);
  const evaluation = evaluateDimensionBindingPlan(preview.plan);
  const parameterGate = evaluation.featureGates.find((gate) => gate.featureId === feature.id);
  if (!parameterGate) fail('missing parameter evaluation gate');

  const invalidation = planIncrementalEvaluation(document, preview.document);
  if (request.admission === 'require_admissible') {
    if (!admitted(parameterGate)) {
      fail('parameter edit not admissible: ' + parameterGate.status + ' / ' +
        parameterGate.diagnostics.map((d) => d.code).join(','));
    }
    const prior = evaluateDimensionBindingPlan(planProject(document));
    const priorGates = new Map(prior.featureGates.map((gate) => [gate.featureId, gate]));
    const nextGates = new Map(evaluation.featureGates.map((gate) => [gate.featureId, gate]));
    for (const id of invalidation.invalidatedFeatureIds) {
      if (admitted(priorGates.get(id)) && !admitted(nextGates.get(id))) {
        fail('parameter edit would invalidate an admitted dependent feature: ' + id +
          ' (' + (nextGates.get(id)?.status ?? 'missing') + ')');
      }
    }
  }
  return {
    format: 'intuit3d.parameter-edit-preview', version: 1,
    event: preview.document.journal[preview.document.journal.length - 1],
    document: preview.document, evaluation, parameterGate, invalidation,
  };
}

/** Commit as one durable undo frame without changing the caller's history. */
export function commitUndoableParameterEdit(
  input: UndoHistory, request: ParameterEditRequest,
): UndoHistory {
  const session = parseUndoHistory(input);
  const preview = previewParameterEdit(session.document, request);
  return commitUndoableTransaction(session, [preview.event], request.expectedRevision);
}
