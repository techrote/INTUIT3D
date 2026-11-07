/**
 * @intuit3d/model/parameter-authoring/v1
 *
 * Create a named scalar parameter and retrospectively bind one or more
 * existing feature dimensions in ONE authoritative, undoable journal frame.
 * The source expression and dependency edges survive archive/replay; derived
 * scalar values are not saved and do not certify B-rep or STEP geometry.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, ProjectDocument } from './index.ts';
import {
  collectDimensionParameterReferences,
} from './dimension-edit.ts';
import {
  previewDimensionEditBatch,
  DIMENSION_BATCH_EDIT_FORMAT,
  DIMENSION_BATCH_EDIT_VERSION,
} from './dimension-batch-edit.ts';
import {
  evaluateDimensionBindingPlan,
} from './dimension-bindings.ts';
import type {
  DimensionBindingEvaluation, DimensionFeatureGate,
} from './dimension-bindings.ts';
import type { ParameterExpression, ParameterUnit } from './parameters.ts';
import {
  previewTransaction, parseUndoHistory, commitUndoableTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';

export const PARAMETER_AUTHORING_FORMAT = 'intuit3d.parameter-authoring' as const;
export const PARAMETER_AUTHORING_VERSION = 1 as const;
export const MAX_PARAMETER_AUTHORING_BINDINGS = 32;

export interface ParameterAuthoringRequest {
  readonly format: typeof PARAMETER_AUTHORING_FORMAT;
  readonly version: typeof PARAMETER_AUTHORING_VERSION;
  readonly expectedRevision: number;
  readonly admission: 'require_admissible' | 'permit_unresolved';
  readonly parameter: {
    readonly eventId: string;
    readonly featureId: string;
    /** Display label only; expressions always refer to the immutable featureId. */
    readonly name: string;
    readonly unit: ParameterUnit;
    readonly expression: ParameterExpression;
  };
  /** One existing top-level numeric feature payload field per target. */
  readonly bindings: readonly {
    readonly eventId: string;
    readonly featureId: string;
    readonly field: string;
  }[];
}

export interface ParameterAuthoringPreview {
  readonly format: 'intuit3d.parameter-authoring-preview';
  readonly version: 1;
  readonly events: readonly JournalEvent[];
  readonly document: ProjectDocument;
  readonly evaluation: DimensionBindingEvaluation;
  readonly parameterGate: DimensionFeatureGate;
  readonly bindingGates: readonly DimensionFeatureGate[];
  readonly invalidation: IncrementalEvaluationPlan;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SYMBOL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const UNITS = new Set(['mm', 'deg', 'unitless']);
function fail(message: string): never { throw new ProjectFormatError('parameter authoring: ' + message); }
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field));
}
function admitted(gate: DimensionFeatureGate | undefined): boolean {
  return gate?.status === 'admissible' || gate?.status === 'bound';
}

/**
 * Validate a complete user action before exposing any events for commitment.
 * Permit unresolved forward parameter references only when requested: there
 * is never an invented numeric fallback or implicit chronological dependency.
 */
export function previewParameterAuthoring(
  source: ProjectDocument, request: ParameterAuthoringRequest,
): ParameterAuthoringPreview {
  const document = parseProject(source);
  if (!plain(request) || !exact(request, [
    'format', 'version', 'expectedRevision', 'admission', 'parameter', 'bindings',
  ]) || request.format !== PARAMETER_AUTHORING_FORMAT ||
      request.version !== PARAMETER_AUTHORING_VERSION ||
      (request.admission !== 'require_admissible' &&
       request.admission !== 'permit_unresolved')) {
    fail('unsupported request or admission policy');
  }
  if (request.expectedRevision !== document.revision) {
    throw new ProjectRevisionError('stale parameter creation: expected ' +
      request.expectedRevision + ', actual ' + document.revision);
  }
  const spec = request.parameter;
  if (!plain(spec) || !exact(spec, [
    'eventId', 'featureId', 'name', 'unit', 'expression',
  ]) || !ID.test(spec.eventId) || !ID.test(spec.featureId) ||
      !SYMBOL.test(spec.name) || !UNITS.has(spec.unit) ||
      !Array.isArray(request.bindings) ||
      request.bindings.length < 1 ||
      request.bindings.length > MAX_PARAMETER_AUTHORING_BINDINGS) {
    fail('invalid parameter identity, scalar unit or binding count');
  }
  const existing = featuresOf(document);
  if (existing.some((feature) => feature.id === spec.featureId)) {
    fail('semantic parameter ID already exists');
  }
  // Reused display labels are confusing when selecting parameters in a CAD
  // inspector, even though journal references themselves always use IDs.
  if (existing.some((feature) => feature.kind === 'parameter' &&
      plain(feature.payload.parameter) &&
      feature.payload.parameter.name === spec.name)) {
    fail('parameter display name already exists');
  }
  const refs = collectDimensionParameterReferences(spec.expression);
  if (refs.includes(spec.featureId)) fail('parameter cannot depend on itself');
  for (const dependency of refs) {
    const known = existing.find((feature) => feature.id === dependency);
    if (known && known.kind !== 'parameter') {
      fail('expression refers to a non-parameter feature: ' + dependency);
    }
  }

  const createEvent: JournalEvent = {
    eventId: spec.eventId,
    type: 'feature.create',
    feature: {
      id: spec.featureId,
      kind: 'parameter',
      dependsOn: refs,
      writeTargets: [],
      payload: { parameter: {
        name: spec.name, unit: spec.unit, expression: spec.expression,
      } } as unknown as import('./index.ts').JsonRecord,
    },
  };
  // The parameter is introduced first, so every later binding can be
  // validated using the ordinary, already-admitted DIMENSION edit contract.
  const created = previewTransaction(document, [createEvent]).document;
  const bound = previewDimensionEditBatch(created, {
    format: DIMENSION_BATCH_EDIT_FORMAT,
    version: DIMENSION_BATCH_EDIT_VERSION,
    expectedRevision: created.revision,
    admission: 'permit_unresolved',
    edits: request.bindings.map((binding) => {
      if (!plain(binding) || !exact(binding, [
        'eventId', 'featureId', 'field',
      ])) fail('malformed binding entry');
      return {
        eventId: binding.eventId, featureId: binding.featureId,
        field: binding.field,
        binding: {
          unit: spec.unit,
          expression: { op: 'ref' as const, featureId: spec.featureId },
        },
      };
    }),
  });

  // Revalidate the entire multi-event command on the ORIGINAL revision.
  // One call to commitUndoableTransaction will append exactly these events
  // as one undo frame; no intermediate parameter-only state is committed.
  const events = [createEvent, ...bound.events];
  const final = previewTransaction(document, events, request.expectedRevision);
  const evaluation = evaluateDimensionBindingPlan(final.plan);
  const gates = new Map(evaluation.featureGates.map((gate) => [gate.featureId, gate] as const));
  const parameterGate = gates.get(spec.featureId);
  if (!parameterGate) fail('missing parameter evaluation gate');
  const bindingGates = [...new Set(request.bindings.map((binding) => binding.featureId))]
    .map((featureId) => {
      const gate = gates.get(featureId);
      if (!gate) fail('missing bound dimension gate: ' + featureId);
      return gate;
    });
  const invalidation = planIncrementalEvaluation(document, final.document);

  if (request.admission === 'require_admissible') {
    if (!admitted(parameterGate) || bindingGates.some((gate) => !admitted(gate))) {
      fail('created parameter or dimension binding is not admissible: ' +
        [parameterGate, ...bindingGates].map((gate) =>
          gate.featureId + ':' + gate.status).join(', '));
    }
    const prior = evaluateDimensionBindingPlan(planProject(document));
    const priorGates = new Map(prior.featureGates.map((gate) => [gate.featureId, gate]));
    for (const id of invalidation.invalidatedFeatureIds) {
      if (admitted(priorGates.get(id)) && !admitted(gates.get(id))) {
        fail('binding regresses an admitted dependent feature: ' + id);
      }
    }
  }
  return {
    format: 'intuit3d.parameter-authoring-preview', version: 1,
    events: final.document.journal.slice(document.revision),
    document: final.document,
    evaluation, parameterGate, bindingGates, invalidation,
  };
}

/** Apply a parameter and all its retrospective bindings as ONE undo frame. */
export function commitUndoableParameterAuthoring(
  source: UndoHistory, request: ParameterAuthoringRequest,
): UndoHistory {
  const history = parseUndoHistory(source);
  const preview = previewParameterAuthoring(history.document, request);
  return commitUndoableTransaction(history, preview.events, request.expectedRevision);
}
