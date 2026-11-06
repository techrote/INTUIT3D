/**
 * Derive numerically evaluated user parameters from an intent evaluation plan.
 *
 * Parameter expressions are authoritative JSON in feature payloads; values and
 * execution gates are derived and must never be saved as geometric truth.
 * All references address semantic feature IDs and require explicit dependency
 * edges. Dimensionally invalid or nonfinite expressions fail closed, including
 * consumer features whose upstream parameters cannot be evaluated.
 *
 * This is scalar IEEE-754 arithmetic, NOT a geometry or exact-precision solver.
 */

export type ParameterUnit = 'unitless' | 'mm' | 'deg';
export type ParameterExpression =
  | { readonly op: 'literal'; readonly value: number; readonly unit: ParameterUnit }
  | { readonly op: 'ref'; readonly featureId: string }
  | { readonly op: 'negate'; readonly operand: ParameterExpression }
  | { readonly op: 'add' | 'subtract' | 'multiply' | 'divide'; readonly left: ParameterExpression; readonly right: ParameterExpression };

export interface ParameterFeature {
  readonly id: string;
  readonly kind: string;
  readonly dependsOn: readonly string[];
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Structural shape compatible with EvaluationPlan from model-v1. */
export interface ParameterPlanInput {
  readonly executableOrder: readonly string[];
  readonly features: readonly {
    readonly feature: ParameterFeature;
    readonly status: string;
  }[];
}

export type ParameterDiagnosticCode =
  | 'PARAMETER_FORMAT'
  | 'EXPRESSION_LIMIT'
  | 'UNDECLARED_PARAMETER_DEPENDENCY'
  | 'INVALID_PARAMETER_REFERENCE'
  | 'UNAVAILABLE_PARAMETER'
  | 'UNIT_MISMATCH'
  | 'DIVISION_BY_ZERO'
  | 'NUMERIC_FAILURE'
  | 'DEPENDENCY_FAILED';

export interface ParameterDiagnostic {
  readonly code: ParameterDiagnosticCode;
  readonly message: string;
  readonly relatedIds: readonly string[];
}

export type FeatureGateStatus = 'admissible' | 'unready' | 'invalid_parameter' | 'blocked_parameter';
export interface FeatureGate {
  readonly featureId: string;
  readonly status: FeatureGateStatus;
  readonly diagnostics: readonly ParameterDiagnostic[];
}

export interface ParameterValue {
  readonly featureId: string;
  /** Human-facing label only: references must use the stable featureId. */
  readonly name: string;
  readonly unit: ParameterUnit;
  readonly value: number;
}

export interface ParameterEvaluation {
  /** A subset of the model's dependency-safe order, with invalid parameter chains removed. */
  readonly admissibleExecutableOrder: readonly string[];
  readonly parameterValues: readonly ParameterValue[];
  /** One gate per authored, currently living feature; includes unready features. */
  readonly featureGates: readonly FeatureGate[];
}

type Quantity = { value: number; unit: ParameterUnit };
const UNITS: ReadonlySet<string> = new Set(['unitless', 'mm', 'deg']);
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SYMBOL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_EXPRESSION_NODES = 2048;
const MAX_EXPRESSION_DEPTH = 64;

class ParameterFailure extends Error {
  readonly code: ParameterDiagnosticCode;
  readonly relatedIds: readonly string[];
  constructor(code: ParameterDiagnosticCode, message: string, relatedIds: readonly string[] = []) {
    super(message);
    this.code = code;
    this.relatedIds = relatedIds;
    this.name = 'ParameterFailure';
  }
}

const problem = (code: ParameterDiagnosticCode, message: string, relatedIds: readonly string[] = []): never => {
  throw new ParameterFailure(code, message, relatedIds);
};

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return problem('PARAMETER_FORMAT', 'parameter expression must be a JSON object');
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return problem('PARAMETER_FORMAT', 'parameter expression must be a plain object');
  }
  return value as Record<string, unknown>;
}

function shape(value: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      problem('PARAMETER_FORMAT', 'unsupported parameter key: ' + key);
    }
  }
}

function unit(value: unknown): ParameterUnit {
  if (typeof value !== 'string' || !UNITS.has(value)) {
    return problem('PARAMETER_FORMAT', 'unit must be explicitly unitless, mm or deg');
  }
  return value as ParameterUnit;
}

function checked(value: number, operands: readonly number[] = []): number {
  if (!Number.isFinite(value)) problem('NUMERIC_FAILURE', 'parameter calculation is not finite');
  if (value === 0 && operands.length && operands.every((v) => v !== 0)) {
    problem('NUMERIC_FAILURE', 'nonzero parameter product/quotient underflowed to zero');
  }
  return value;
}

/** Evaluate a dependency-admissible plan without mutating authoritative features. */
export function evaluateParameterPlan(plan: ParameterPlanInput): ParameterEvaluation {
  const features = new Map(plan.features.map((item) => [item.feature.id, item] as const));
  const values = new Map<string, ParameterValue>();
  const gates = new Map<string, FeatureGate>();
  const gate = (id: string, status: FeatureGateStatus, diagnostics: readonly ParameterDiagnostic[] = []): void => {
    gates.set(id, { featureId: id, status, diagnostics });
  };
  for (const { feature, status } of plan.features) {
    if (status !== 'ready') gate(feature.id, 'unready');
  }
  const referenced = (owner: ParameterFeature, featureId: string): Quantity => {
    if (!owner.dependsOn.includes(featureId)) {
      problem('UNDECLARED_PARAMETER_DEPENDENCY', 'parameter ' + owner.id + ' lacks dependency edge to ' + featureId, [featureId]);
    }
    const candidate = features.get(featureId)?.feature;
    if (!candidate || candidate.kind !== 'parameter') {
      problem('INVALID_PARAMETER_REFERENCE', 'reference ' + featureId + ' does not identify a parameter feature', [featureId]);
    }
    const found = values.get(featureId);
    if (!found) return problem('UNAVAILABLE_PARAMETER', 'parameter ' + featureId + ' has no resolved value', [featureId]);
    return { value: found.value, unit: found.unit };
  };
  const evaluate = (root: unknown, owner: ParameterFeature): Quantity => {
    let remaining = MAX_EXPRESSION_NODES;
    const visit = (value: unknown, depth: number): Quantity => {
      if (--remaining < 0 || depth > MAX_EXPRESSION_DEPTH) {
        problem('EXPRESSION_LIMIT', 'parameter expression exceeds complexity/depth limit');
      }
      const node = object(value);
      switch (node.op) {
        case 'literal': {
          shape(node, ['op', 'value', 'unit']);
          if (typeof node.value !== 'number' || !Number.isFinite(node.value)) {
            problem('PARAMETER_FORMAT', 'literal must contain a finite numerical value');
          }
          return { value: node.value as number, unit: unit(node.unit) };
        }
        case 'ref': {
          shape(node, ['op', 'featureId']);
          if (typeof node.featureId !== 'string' || !ID.test(node.featureId)) {
            problem('PARAMETER_FORMAT', 'ref must contain a valid semantic featureId');
          }
          return referenced(owner, node.featureId as string);
        }
        case 'negate': {
          shape(node, ['op', 'operand']);
          const q = visit(node.operand, depth + 1);
          return { value: -q.value, unit: q.unit };
        }
        case 'add':
        case 'subtract':
        case 'multiply':
        case 'divide': {
          shape(node, ['op', 'left', 'right']);
          const l = visit(node.left, depth + 1);
          const r = visit(node.right, depth + 1);
          if (node.op === 'add' || node.op === 'subtract') {
            if (l.unit !== r.unit) problem('UNIT_MISMATCH', 'addition/subtraction requires identical units');
            return { value: checked(node.op === 'add' ? l.value + r.value : l.value - r.value), unit: l.unit };
          }
          if (node.op === 'multiply') {
            if (l.unit !== 'unitless' && r.unit !== 'unitless') {
              problem('UNIT_MISMATCH', 'multiplication of two dimensional quantities is not represented by v1 units');
            }
            return { value: checked(l.value * r.value, [l.value, r.value]), unit: l.unit === 'unitless' ? r.unit : l.unit };
          }
          if (r.value === 0) problem('DIVISION_BY_ZERO', 'division by zero is not a valid parameter');
          if (r.unit !== 'unitless' && r.unit !== l.unit) {
            problem('UNIT_MISMATCH', 'division requires a unitless divisor or identical units');
          }
          return { value: checked(l.value / r.value, [l.value, r.value]), unit: r.unit === 'unitless' ? l.unit : 'unitless' };
        }
        default:
          return problem('PARAMETER_FORMAT', 'unsupported parameter expression op');
      }
    };
    return visit(root, 0);
  };

  for (const featureId of plan.executableOrder) {
    const source = features.get(featureId);
    if (!source || source.status !== 'ready') continue;
    const feature = source.feature;
    const failed = feature.dependsOn.filter((dep) => gates.has(dep) && gates.get(dep)!.status !== 'admissible');
    if (failed.length) {
      gate(featureId, 'blocked_parameter', [{ code: 'DEPENDENCY_FAILED', message: 'unavailable parameter-dependent upstream feature', relatedIds: failed }]);
      continue;
    }
    if (feature.kind !== 'parameter') { gate(featureId, 'admissible'); continue; }
    try {
      const data = object(feature.payload.parameter);
      shape(data, ['name', 'unit', 'expression']);
      if (typeof data.name !== 'string' || !SYMBOL.test(data.name)) {
        problem('PARAMETER_FORMAT', 'parameter name must be a 1-64 character ASCII symbol');
      }
      const expected = unit(data.unit);
      const result = evaluate(data.expression, feature);
      if (result.unit !== expected) {
        problem('UNIT_MISMATCH', 'parameter ' + featureId + ' resolves to ' + result.unit + ', not declared ' + expected);
      }
      values.set(featureId, { featureId, name: data.name as string, unit: result.unit, value: result.value });
      gate(featureId, 'admissible');
    } catch (e) {
      if (!(e instanceof ParameterFailure)) throw e;
      gate(featureId, 'invalid_parameter', [{ code: e.code, message: e.message, relatedIds: e.relatedIds }]);
    }
  }
  for (const { feature, status } of plan.features) {
    if (!gates.has(feature.id)) gate(feature.id, status === 'ready' ? 'blocked_parameter' : 'unready');
  }
  return {
    admissibleExecutableOrder: plan.executableOrder.filter((id) => gates.get(id)?.status === 'admissible'),
    parameterValues: plan.features.flatMap(({ feature }) => {
      const value = values.get(feature.id);
      return value ? [value] : [];
    }),
    featureGates: plan.features.map(({ feature }) => gates.get(feature.id)!),
  };
}
