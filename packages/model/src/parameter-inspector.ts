/**
 * @intuit3d/model/parameter-inspector/v1
 *
 * One authoritative inspector command edits a human-visible parameter name
 * and/or its expression without regenerating the parameter's stable ID.
 * Expressions continue to reference immutable feature IDs, not display names.
 * The operation is one undoable feature.edit journal event.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, ProjectDocument, JsonRecord } from './index.ts';
import {
  previewParameterEdit, PARAMETER_EDIT_FORMAT,
} from './parameter-edit.ts';
import {
  previewTransaction, parseUndoHistory, commitUndoableTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { evaluateDimensionBindingPlan } from './dimension-bindings.ts';
import type { DimensionBindingEvaluation, DimensionFeatureGate } from './dimension-bindings.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import type { ParameterExpression } from './parameters.ts';

export const PARAMETER_INSPECTOR_FORMAT = 'intuit3d.parameter-inspector-edit' as const;
export const PARAMETER_INSPECTOR_VERSION = 1 as const;

export interface ParameterInspectorEditRequest {
  readonly format: typeof PARAMETER_INSPECTOR_FORMAT;
  readonly version: typeof PARAMETER_INSPECTOR_VERSION;
  readonly eventId: string;
  readonly featureId: string;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  /** The visible name in the inspector, which is never a dependency key. */
  readonly name: string;
  /** Omit for a pure rename. If supplied, update name/expression atomically. */
  readonly expression?: ParameterExpression;
  readonly admission: 'require_admissible' | 'permit_unresolved';
}

export interface ParameterInspectorEditPreview {
  readonly format: 'intuit3d.parameter-inspector-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly evaluation: DimensionBindingEvaluation;
  readonly parameterGate: DimensionFeatureGate;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly featureId: string;
  readonly previousName: string;
  readonly nextName: string;
  readonly expressionChanged: boolean;
  /** A name-only change cannot change numerical design inputs. Not a B-rep cache attestation. */
  readonly changesGeometricInputs: boolean;
  readonly exactGeometryAuthority: false;
}

const SYMBOL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
function fail(reason: string): never {
  throw new ProjectFormatError('parameter inspector: ' + reason);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function admitted(gate: DimensionFeatureGate | undefined): boolean {
  return gate?.status === 'admissible' || gate?.status === 'bound';
}

/**
 * Admits a visible parameter-table edit using the existing parameter AST,
 * unit, dependency and strict downstream-admission checks. An inspector rename
 * does not rewrite bound expressions or introduce a second source of truth.
 */
export function previewParameterInspectorEdit(
  source: ProjectDocument, request: ParameterInspectorEditRequest,
): ParameterInspectorEditPreview {
  const document = parseProject(source);
  if (!plain(request) ||
      !['format', 'version', 'eventId', 'featureId', 'expectedProjectId',
        'expectedRevision', 'name', 'expression', 'admission']
        .every((key) => key === 'expression' || Object.hasOwn(request, key)) ||
      Object.keys(request).some((key) => ![
        'format', 'version', 'eventId', 'featureId', 'expectedProjectId',
        'expectedRevision', 'name', 'expression', 'admission',
      ].includes(key)) ||
      request.format !== PARAMETER_INSPECTOR_FORMAT ||
      request.version !== PARAMETER_INSPECTOR_VERSION ||
      typeof request.name !== 'string' || !SYMBOL.test(request.name) ||
      (request.admission !== 'require_admissible' &&
       request.admission !== 'permit_unresolved')) {
    fail('malformed or unsupported inspector edit');
  }
  if (document.projectId !== request.expectedProjectId ||
      document.revision !== request.expectedRevision) {
    throw new ProjectRevisionError('parameter inspector: stale project/revision');
  }
  const current = featuresOf(document);
  const target = current.find((item) => item.id === request.featureId);
  if (!target || target.kind !== 'parameter') {
    fail('target must be a living named parameter');
  }
  const data = target.payload.parameter;
  if (!plain(data) || typeof data.name !== 'string' ||
      !SYMBOL.test(data.name)) fail('parameter has no valid authored name');

  if (current.some((item) => item.id !== target.id &&
      item.kind === 'parameter' && plain(item.payload.parameter) &&
      item.payload.parameter.name === request.name)) {
    fail('duplicate parameter display name: ' + request.name);
  }
  const expression = (request.expression === undefined
    ? data.expression : request.expression) as ParameterExpression;
  const expressionChanged =
    JSON.stringify(expression) !== JSON.stringify(data.expression);
  if (data.name === request.name && !expressionChanged) {
    fail('inspector edit does not change authored parameter');
  }

  // Reuse the proven expression parser and dependency-edge policy before
  // constructing the combined one-event edit. The probe is not committed.
  const checked = previewParameterEdit(document, {
    format: PARAMETER_EDIT_FORMAT, version: 1,
    eventId: request.eventId, featureId: request.featureId,
    expectedRevision: request.expectedRevision, expression,
    admission: request.admission,
  });
  if (checked.event.type !== 'feature.edit') fail('unexpected parameter edit event');
  const payload: JsonRecord = {
    ...target.payload,
    parameter: { ...data, name: request.name, expression } as JsonRecord,
  };
  const event: JournalEvent = {
    eventId: request.eventId, type: 'feature.edit', featureId: target.id,
    patch: { dependsOn: checked.event.patch.dependsOn, payload },
  };
  const staged = previewTransaction(document, [event], request.expectedRevision);
  const evaluation = evaluateDimensionBindingPlan(staged.plan);
  const parameterGate = evaluation.featureGates.find((gate) =>
    gate.featureId === request.featureId);
  if (!parameterGate) fail('edited parameter gate is missing');
  const invalidation = planIncrementalEvaluation(document, staged.document);

  if (request.admission === 'require_admissible') {
    if (!admitted(parameterGate)) fail('parameter is not dimension-admissible');
    const before = evaluateDimensionBindingPlan(planProject(document));
    const prior = new Map(before.featureGates.map((gate) =>
      [gate.featureId, gate] as const));
    const next = new Map(evaluation.featureGates.map((gate) =>
      [gate.featureId, gate] as const));
    for (const id of invalidation.invalidatedFeatureIds) {
      if (admitted(prior.get(id)) && !admitted(next.get(id))) {
        fail('edit regresses admitted dependent feature: ' + id);
      }
    }
  }
  return {
    format: 'intuit3d.parameter-inspector-preview', version: 1,
    event: staged.document.journal[staged.document.journal.length - 1]!,
    document: staged.document, evaluation, parameterGate, invalidation,
    featureId: target.id, previousName: data.name, nextName: request.name,
    expressionChanged, changesGeometricInputs: expressionChanged,
    exactGeometryAuthority: false,
  };
}

export function commitUndoableParameterInspectorEdit(
  source: UndoHistory, request: ParameterInspectorEditRequest,
): UndoHistory {
  const session = parseUndoHistory(source);
  const preview = previewParameterInspectorEdit(session.document, request);
  return commitUndoableTransaction(session, [preview.event], request.expectedRevision);
}
