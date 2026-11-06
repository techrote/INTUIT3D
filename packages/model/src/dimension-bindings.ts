/**
 * Versioned, derived feature-dimension binding over authoritative model journal.
 *
 * Input expressions stay in feature.payload.dimensionBindings. A resolved numeric
 * payload is a transient provider/workbench adapter, NEVER a journal mutation,
 * cached exact shape, or evidence of an admissible Boolean/STEP operation.
 *
 * This intentionally reuses the model's audited scalar expression evaluator by
 * evaluating private transient parameter nodes; no arithmetic/tolerance rules
 * or semantic feature IDs are invented by this adapter.
 */
import type { EvaluationPlan, JsonRecord } from './index.ts';
import { evaluateParameterPlan } from './parameters.ts';
import type { ParameterDiagnosticCode, ParameterUnit, ParameterExpression } from './parameters.ts';

export const DIMENSION_BINDINGS_FORMAT = 'intuit3d.dimension-bindings' as const;
export const DIMENSION_BINDINGS_VERSION = 1 as const;
export const MAX_DIMENSION_BINDINGS_PER_FEATURE = 64;
export const MAX_DIMENSION_BINDINGS_PER_PLAN = 1024;

export interface DimensionBinding {
  /** Existing top-level numeric payload field. No implicit object-path traversal. */
  readonly field: string;
  readonly unit: ParameterUnit;
  readonly expression: ParameterExpression;
}
export interface DimensionBindingManifest {
  readonly format: typeof DIMENSION_BINDINGS_FORMAT;
  readonly version: typeof DIMENSION_BINDINGS_VERSION;
  readonly entries: readonly DimensionBinding[];
}
export type DimensionGateStatus = 'admissible' | 'bound' | 'unready' | 'invalid_binding' | 'blocked_binding';
export type DimensionDiagnosticCode = 'INVALID_BINDING_FORMAT' | 'INVALID_TARGET' |
  'DUPLICATE_TARGET' | 'BINDING_LIMIT' | 'EXPRESSION_FAILED' | 'UPSTREAM_BLOCKED' | 'MODEL_UNREADY';
export interface DimensionDiagnostic {
  readonly code: DimensionDiagnosticCode;
  readonly message: string;
  readonly relatedIds: readonly string[];
  readonly parameterCode?: ParameterDiagnosticCode;
}
export interface DimensionFeatureGate {
  readonly featureId: string;
  readonly status: DimensionGateStatus;
  /** Null for ANY non-admissible state: do not use authored numeric fallback. */
  readonly resolvedPayload: Readonly<JsonRecord> | null;
  readonly diagnostics: readonly DimensionDiagnostic[];
}
export interface DimensionBindingEvaluation {
  readonly format: 'intuit3d.dimension-binding-evaluation';
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  /** Original model dependency order with all binding/parameter failures removed. */
  readonly admissibleExecutableOrder: readonly string[];
  readonly featureGates: readonly DimensionFeatureGate[];
}

const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const UNITS = new Set(['mm', 'deg', 'unitless']);
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
function diagnostic(code: DimensionDiagnosticCode, message: string,
  relatedIds: readonly string[] = [], parameterCode?: ParameterDiagnosticCode): DimensionDiagnostic {
  return { code, message, relatedIds, ...(parameterCode === undefined ? {} : { parameterCode }) };
}

interface PreparedBinding {
  readonly field: string;
  readonly unit: ParameterUnit;
  readonly expression: ParameterExpression;
  readonly syntheticId: string;
}
interface PreparedFeature {
  readonly bindings: readonly PreparedBinding[];
  readonly errors: readonly DimensionDiagnostic[];
}

/**
 * Admits only explicit, versioned bindings to pre-existing scalar payload fields.
 * Full expression/ref syntax and unit rules are enforced by evaluateParameterPlan.
 * There is no valid partially-bound payload: one error invalidates the feature
 * and transitive dependents, even when the authored fallback number looks valid.
 */
export function evaluateDimensionBindingPlan(plan: EvaluationPlan): DimensionBindingEvaluation {
  const occupied = new Set(plan.features.map(({ feature }) => feature.id));
  let nextSynthetic = 0;
  const allocateId = (): string => {
    let id: string;
    do { id = 'intuitBindingTmp' + (++nextSynthetic); } while (occupied.has(id));
    occupied.add(id);
    return id;
  };
  let totalBindings = 0;
  const prepared = new Map<string, PreparedFeature>();
  const synthetic: Array<{ feature: { id: string; kind: string; dependsOn: readonly string[]; payload: Readonly<Record<string, unknown>> }; status: string }> = [];
  const syntheticOrder: string[] = [];
  for (const { feature, status } of plan.features) {
    const bindings: PreparedBinding[] = [];
    const errors: DimensionDiagnostic[] = [];
    if (!Object.hasOwn(feature.payload, 'dimensionBindings')) {
      prepared.set(feature.id, { bindings, errors });
      continue;
    }
    const raw = feature.payload.dimensionBindings;
    if (feature.kind === 'parameter' || !plain(raw) ||
      !exactKeys(raw, ['format', 'version', 'entries']) ||
      raw.format !== DIMENSION_BINDINGS_FORMAT || raw.version !== DIMENSION_BINDINGS_VERSION ||
      !Array.isArray(raw.entries)) {
      errors.push(diagnostic('INVALID_BINDING_FORMAT', 'unsupported dimension binding manifest', [feature.id]));
    } else if (raw.entries.length > MAX_DIMENSION_BINDINGS_PER_FEATURE ||
        totalBindings + raw.entries.length > MAX_DIMENSION_BINDINGS_PER_PLAN) {
      errors.push(diagnostic('BINDING_LIMIT', 'dimension binding budget exceeded', [feature.id]));
    } else {
      totalBindings += raw.entries.length;
      const seen = new Set<string>();
      for (const [index, item] of raw.entries.entries()) {
        if (!plain(item) || !exactKeys(item, ['field', 'unit', 'expression']) ||
          typeof item.field !== 'string' || !FIELD.test(item.field) ||
          !UNITS.has(item.unit as string)) {
          errors.push(diagnostic('INVALID_BINDING_FORMAT', 'invalid binding at index ' + index, [feature.id]));
          continue;
        }
        const field = item.field;
        if (field === 'dimensionBindings' || !Object.hasOwn(feature.payload, field) ||
          typeof feature.payload[field] !== 'number' || !Number.isFinite(feature.payload[field])) {
          errors.push(diagnostic('INVALID_TARGET', 'binding target must be an existing finite numeric field: ' + field, [feature.id]));
          continue;
        }
        if (seen.has(field)) {
          errors.push(diagnostic('DUPLICATE_TARGET', 'repeated dimension binding field: ' + field, [feature.id]));
          continue;
        }
        seen.add(field);
        // Invalid/blocked model features must not yield transient values.
        if (status !== 'ready') continue;
        const syntheticId = allocateId();
        bindings.push({field, unit: item.unit as ParameterUnit,
          expression: item.expression as ParameterExpression, syntheticId});
        syntheticOrder.push(syntheticId);
        synthetic.push({
          feature: { id: syntheticId, kind: 'parameter', dependsOn: feature.dependsOn,
            payload: { parameter: { name: 'binding', unit: item.unit, expression: item.expression } } },
          status: 'ready',
        });
      }
    }
    prepared.set(feature.id, { bindings, errors });
  }

  // Evaluate all private scalar expressions in one pass, AFTER the complete
  // original admissible parameter order. Never write synthetic IDs to a journal.
  const parameters = evaluateParameterPlan({
    features: [...plan.features, ...synthetic],
    executableOrder: [...plan.executableOrder, ...syntheticOrder],
  });
  const parameterGates = new Map(parameters.featureGates.map((g) => [g.featureId, g] as const));
  const parameterValues = new Map(parameters.parameterValues.map((v) => [v.featureId, v.value] as const));
  const featureById = new Map(plan.features.map(({ feature }) => [feature.id, feature] as const));
  const modelStatuses = new Map(plan.features.map(({ feature, status }) => [feature.id, status] as const));
  const results = new Map<string, DimensionFeatureGate>();
  for (const { feature, status } of plan.features) {
    if (status !== 'ready') {
      results.set(feature.id, {featureId: feature.id, status: 'unready', resolvedPayload: null,
        diagnostics: [diagnostic('MODEL_UNREADY', 'model dependency state: ' + status, [feature.id])]});
    }
  }
  for (const id of plan.executableOrder) {
    const feature = featureById.get(id)!;
    const preparedFeature = prepared.get(id)!;
    const upstream = feature.dependsOn.filter((dep) => results.get(dep)?.status === 'invalid_binding' ||
      results.get(dep)?.status === 'blocked_binding' || modelStatuses.get(dep) !== 'ready');
    if (upstream.length) {
      results.set(id, {featureId:id, status:'blocked_binding', resolvedPayload:null,
        diagnostics:[diagnostic('UPSTREAM_BLOCKED', 'upstream binding/model state unavailable', upstream)]});
      continue;
    }
    const gate = parameterGates.get(id);
    if (!gate || gate.status !== 'admissible') {
      results.set(id, {featureId:id, status:'blocked_binding', resolvedPayload:null,
        diagnostics: gate?.diagnostics.length ?
          gate.diagnostics.map((d) => diagnostic('EXPRESSION_FAILED', d.message, d.relatedIds, d.code)) :
          [diagnostic('UPSTREAM_BLOCKED', 'parameter gate is not admissible', [id])]});
      continue;
    }
    const errors = [...preparedFeature.errors];
    const replacements: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const binding of preparedFeature.bindings) {
      const expressionGate = parameterGates.get(binding.syntheticId);
      const value = parameterValues.get(binding.syntheticId);
      if (!expressionGate || expressionGate.status !== 'admissible' || value === undefined) {
        const problem = expressionGate?.diagnostics[0];
        errors.push(diagnostic('EXPRESSION_FAILED',
          'dimension expression failed for ' + binding.field + ': ' + (problem?.message ?? 'no resolved value'),
          problem?.relatedIds ?? [], problem?.code));
      } else {
        replacements[binding.field] = value;
      }
    }
    if (errors.length) {
      results.set(id, {featureId:id, status:'invalid_binding', resolvedPayload:null, diagnostics:errors});
      continue;
    }
    const payload: JsonRecord = Object.assign(Object.create(null) as JsonRecord, feature.payload);
    for (const [key, value] of Object.entries(replacements)) payload[key] = value;
    results.set(id, {featureId:id,
      status: preparedFeature.bindings.length ? 'bound' : 'admissible',
      resolvedPayload: payload, diagnostics:[]});
  }
  return {
    format:'intuit3d.dimension-binding-evaluation', version:1,
    projectId:plan.projectId, revision:plan.revision,
    admissibleExecutableOrder:plan.executableOrder.filter((id) => {
      const status = results.get(id)?.status;
      return status === 'bound' || status === 'admissible';
    }),
    featureGates:plan.features.map(({feature}): DimensionFeatureGate => results.get(feature.id) ?? {
      featureId:feature.id,status:'blocked_binding',resolvedPayload:null,
      diagnostics:[diagnostic('UPSTREAM_BLOCKED','not in executable plan',[feature.id])],
    }),
  };
}
