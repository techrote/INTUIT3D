/**
 * @intuit3d/model/dimension-value-edit/v1
 *
 * Inspector-facing dimensional edits. A visible dimension might be an authored
 * scalar OR a resolved view of a parameter. Editing an authored fallback when
 * a live binding owns the field produces a misleading "successful" CAD edit;
 * this command instead edits the actual literal parameter or refuses a formula
 * whose inverse cannot be uniquely inferred.
 *
 * All committed changes are normal journal feature.edit events (one undo
 * frame). Derived values/geometry are never persisted as authoritative truth.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, ProjectDocument, JsonRecord } from './index.ts';
import { evaluateDimensionBindingPlan } from './dimension-bindings.ts';
import type { DimensionBindingEvaluation, DimensionFeatureGate } from './dimension-bindings.ts';
import {
  previewParameterEdit, PARAMETER_EDIT_FORMAT,
} from './parameter-edit.ts';
import {
  previewTransaction, commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import type { ParameterUnit } from './parameters.ts';

export const DIMENSION_VALUE_EDIT_FORMAT = 'intuit3d.dimension-value-edit' as const;
export const DIMENSION_VALUE_EDIT_VERSION = 1 as const;

export type DimensionValueEditMode = 'authored_scalar' | 'literal_parameter';
export type DimensionValueEditAvailability =
  DimensionValueEditMode | 'formula_requires_parameter_edit' | 'unavailable';

export interface DimensionValueInspection {
  readonly format: 'intuit3d.dimension-value-inspection';
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly featureId: string;
  readonly field: string;
  readonly unit: ParameterUnit;
  readonly availability: DimensionValueEditAvailability;
  /** Null rather than a stale numeric fallback if any model/binding gate fails. */
  readonly currentValue: number | null;
  /** Original source value, which may not match the bound derived value. */
  readonly authoredValue: number;
  readonly parameterFeatureId: string | null;
  readonly diagnostic: string | null;
  readonly exactGeometryAuthority: false;
}

export interface DimensionValueEditRequest {
  readonly format: typeof DIMENSION_VALUE_EDIT_FORMAT;
  readonly version: typeof DIMENSION_VALUE_EDIT_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly eventId: string;
  readonly featureId: string;
  readonly field: string;
  readonly unit: ParameterUnit;
  /** Exact source scalar from the current inspection, not rounded UI text. */
  readonly expectedValue: number;
  readonly value: number;
  /** Explicit user choice: changing a shared parameter changes ALL consumers. */
  readonly mode: DimensionValueEditMode;
  readonly admission: 'require_admissible' | 'permit_unresolved';
}

export interface DimensionValueEditPreview {
  readonly format: 'intuit3d.dimension-value-edit-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly evaluation: DimensionBindingEvaluation;
  readonly targetGate: DimensionFeatureGate;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly changedSourceFeatureId: string;
  readonly editedFeatureId: string;
  readonly field: string;
  readonly previousValue: number;
  readonly nextValue: number | null;
  readonly mode: DimensionValueEditMode;
  readonly requiresSketchAdmission: true;
  readonly requiresNativeRebuild: true;
  readonly exactGeometryAuthority: false;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const UNITS = new Set(['mm', 'deg', 'unitless']);
function fail(reason: string): never {
  throw new ProjectFormatError('dimension value edit: ' + reason);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field));
}
function validField(field: unknown, unit: unknown): asserts field is string {
  if (typeof field !== 'string' || !FIELD.test(field) ||
      field === 'dimensionBindings' || !UNITS.has(unit as string)) {
    fail('invalid field or unit');
  }
  if ((field.endsWith('Mm') && unit !== 'mm') ||
      (field.endsWith('Deg') && unit !== 'deg') ||
      (!field.endsWith('Mm') && !field.endsWith('Deg') && unit !== 'unitless')) {
    fail('dimension field suffix and units disagree');
  }
}
function admitted(gate: DimensionFeatureGate | undefined): boolean {
  return gate?.status === 'admissible' || gate?.status === 'bound';
}

/**
 * Read the *effective* value through the real dimension evaluator. A numeric
 * authored fallback is never called editable while a binding owns the field.
 * Formula-bound values are visible but require an explicit parameter-editor
 * action because there may be multiple valid upstream changes.
 */
export function inspectDimensionValue(
  source: ProjectDocument, featureId: string, field: string, unit: ParameterUnit,
): DimensionValueInspection {
  const doc = parseProject(source);
  if (typeof featureId !== 'string' || !ID.test(featureId)) fail('invalid feature ID');
  validField(field, unit);
  const features = featuresOf(doc);
  const feature = features.find((item) => item.id === featureId);
  if (!feature || feature.kind === 'parameter') fail('dimension target must be a living geometric feature');
  const authored = feature.payload[field];
  if (typeof authored !== 'number' || !Number.isFinite(authored)) {
    fail('dimension target must be an authored finite top-level scalar');
  }
  const evaluation = evaluateDimensionBindingPlan(planProject(doc));
  const gate = evaluation.featureGates.find((item) => item.featureId === featureId);
  if (!admitted(gate) || !gate?.resolvedPayload ||
      typeof gate.resolvedPayload[field] !== 'number') {
    return {
      format:'intuit3d.dimension-value-inspection',version:1,
      projectId:doc.projectId,revision:doc.revision,featureId,field,unit,
      availability:'unavailable',currentValue:null,authoredValue:authored,
      parameterFeatureId:null,
      diagnostic:'feature is not dimension-admissible; repair model or binding first',
      exactGeometryAuthority:false,
    };
  }
  const currentValue = gate.resolvedPayload[field] as number;
  const manifest = feature.payload.dimensionBindings;
  let binding: unknown;
  if (plain(manifest) && Array.isArray(manifest.entries)) {
    binding = manifest.entries.find((item: unknown) =>
      plain(item) && item.field === field);
  }
  if (binding === undefined) {
    return {
      format:'intuit3d.dimension-value-inspection',version:1,
      projectId:doc.projectId,revision:doc.revision,featureId,field,unit,
      availability:'authored_scalar',currentValue,authoredValue:authored,
      parameterFeatureId:null,diagnostic:null,exactGeometryAuthority:false,
    };
  }
  // A successfully admitted binding still may depend on a formula, a
  // multiplication, or multiple named parameters. Never guess its inverse.
  const expression = plain(binding) ? binding.expression : null;
  const parameterId = plain(expression) && expression.op === 'ref' &&
    typeof expression.featureId === 'string' ? expression.featureId : null;
  const parameter = features.find((item) => item.id === parameterId);
  const parameterData = parameter?.payload.parameter;
  const literal = plain(parameterData) ? parameterData.expression : null;
  const direct = plain(binding) && binding.unit === unit &&
    parameter?.kind === 'parameter' &&
    plain(parameterData) && parameterData.unit === unit &&
    plain(literal) && exact(literal, ['op','value','unit']) &&
    literal.op === 'literal' && literal.unit === unit &&
    typeof literal.value === 'number' && Number.isFinite(literal.value);
  return {
    format:'intuit3d.dimension-value-inspection',version:1,
    projectId:doc.projectId,revision:doc.revision,featureId,field,unit,
    availability:direct ? 'literal_parameter' : 'formula_requires_parameter_edit',
    currentValue,authoredValue:authored,
    parameterFeatureId:direct ? parameterId : null,
    diagnostic:direct ? null :
      'bound dimension is not a direct same-unit literal parameter; edit its expression explicitly',
    exactGeometryAuthority:false,
  };
}

/**
 * The inspector emits exactly ONE feature edit. Strict mode checks all
 * previously admissible invalidated consumers; permissive mode preserves
 * explicit unresolved states. Neither mode claims SKETCH/B-rep admission.
 */
export function previewDimensionValueEdit(
  input: ProjectDocument, request: DimensionValueEditRequest,
): DimensionValueEditPreview {
  const document = parseProject(input);
  if (!plain(request) || !exact(request, [
    'format','version','expectedProjectId','expectedRevision','eventId',
    'featureId','field','unit','expectedValue','value','mode','admission',
  ]) || request.format !== DIMENSION_VALUE_EDIT_FORMAT ||
    request.version !== DIMENSION_VALUE_EDIT_VERSION ||
    typeof request.eventId !== 'string' || !ID.test(request.eventId) ||
    typeof request.featureId !== 'string' || !ID.test(request.featureId) ||
    (request.mode !== 'authored_scalar' && request.mode !== 'literal_parameter') ||
    (request.admission !== 'require_admissible' && request.admission !== 'permit_unresolved') ||
    !Number.isFinite(request.expectedValue) || !Number.isFinite(request.value)) {
    fail('unsupported or malformed dimension value request');
  }
  validField(request.field, request.unit);
  if (request.expectedProjectId !== document.projectId ||
      request.expectedRevision !== document.revision) {
    throw new ProjectRevisionError('dimension value edit: stale project or revision');
  }
  const inspection = inspectDimensionValue(document, request.featureId,
    request.field, request.unit);
  if (inspection.currentValue === null ||
      inspection.availability !== request.mode) {
    fail('requested edit cannot change this dimension without explicit source repair');
  }
  if (inspection.currentValue !== request.expectedValue) {
    throw new ProjectRevisionError('dimension value edit: displayed source value changed');
  }
  if (request.value === request.expectedValue) fail('dimension value edit is unchanged');
  let event: JournalEvent;
  let working: ProjectDocument;
  let changedSourceFeatureId: string;
  if (request.mode === 'literal_parameter') {
    const parameterFeatureId = inspection.parameterFeatureId;
    if (!parameterFeatureId) fail('literal source parameter unavailable');
    const step = previewParameterEdit(document, {
      format: PARAMETER_EDIT_FORMAT, version: 1,
      eventId:request.eventId,featureId:parameterFeatureId,
      expectedRevision:document.revision,
      expression:{op:'literal',value:request.value,unit:request.unit},
      admission:request.admission,
    });
    working = step.document;
    event = step.event;
    changedSourceFeatureId = parameterFeatureId;
  } else {
    const feature = featuresOf(document).find((item) =>
      item.id === request.featureId)!;
    const payload: JsonRecord = { ...feature.payload, [request.field]:request.value };
    const staged = previewTransaction(document,[{
      type:'feature.edit',eventId:request.eventId,featureId:feature.id,
      patch:{payload},
    }],document.revision);
    working = staged.document;
    event = working.journal[working.journal.length-1]!;
    changedSourceFeatureId = feature.id;
  }
  const evaluation = evaluateDimensionBindingPlan(planProject(working));
  const targetGate = evaluation.featureGates.find((g) =>
    g.featureId === request.featureId);
  if (!targetGate) fail('edited dimension lost its feature');
  const invalidation = planIncrementalEvaluation(document, working);
  if (request.admission === 'require_admissible') {
    const prior = evaluateDimensionBindingPlan(planProject(document));
    const priorGates = new Map(prior.featureGates.map((g) => [g.featureId,g] as const));
    const nextGates = new Map(evaluation.featureGates.map((g) => [g.featureId,g] as const));
    if (!admitted(targetGate)) fail('edited dimension is not admissible');
    for (const id of invalidation.invalidatedFeatureIds) {
      if (admitted(priorGates.get(id)) && !admitted(nextGates.get(id))) {
        fail('previously admitted dependent dimension became unresolved: '+id);
      }
    }
  }
  const nextValue = admitted(targetGate) && targetGate.resolvedPayload &&
    typeof targetGate.resolvedPayload[request.field] === 'number'
      ? targetGate.resolvedPayload[request.field] as number : null;
  return {
    format:'intuit3d.dimension-value-edit-preview',version:1,
    event,document:working,evaluation,targetGate,invalidation,
    changedSourceFeatureId,editedFeatureId:request.featureId,field:request.field,
    previousValue:request.expectedValue,nextValue,mode:request.mode,
    requiresSketchAdmission:true,requiresNativeRebuild:true,exactGeometryAuthority:false,
  };
}

export function commitUndoableDimensionValueEdit(
  source: UndoHistory, request: DimensionValueEditRequest,
): UndoHistory {
  const session = parseUndoHistory(source);
  const preview = previewDimensionValueEdit(session.document, request);
  return commitUndoableTransaction(session,[preview.event],request.expectedRevision);
}
