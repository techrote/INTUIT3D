/**
 * @intuit3d/model/parameter-formula/v1
 *
 * Convert human-entered arithmetic into the authoritative, typed parameter AST.
 * Names are resolved once to stable semantic feature IDs, never stored as
 * dependencies. No JS evaluation, implicit geometry tolerance or numeric
 * fallback is permitted. Native/STEP proof is a separate provider gate.
 */
import {
  featuresOf, parseProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, ProjectDocument } from './index.ts';
import type { ParameterExpression, ParameterUnit } from './parameters.ts';
import {
  PARAMETER_TABLE_FORMAT, previewParameterTableEdit,
} from './parameter-table.ts';
import type { ParameterTablePreview } from './parameter-table.ts';
import {
  commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const PARAMETER_FORMULA_FORMAT = 'intuit3d.parameter-formula-edit' as const;
export const PARAMETER_FORMULA_VERSION = 1 as const;
const MAX_FORMULA_CHARACTERS = 4096;
const MAX_FORMULA_TOKENS = 512;
const MAX_FORMULA_DEPTH = 64;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const UNITS = new Set<ParameterUnit>(['mm', 'deg', 'unitless']);

export interface ParameterFormulaRequest {
  readonly format: typeof PARAMETER_FORMULA_FORMAT;
  readonly version: typeof PARAMETER_FORMULA_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly eventId: string;
  readonly featureId: string;
  /** Example: "2 * plateThickness + 1 mm" or "12" (target-unit literal). */
  readonly formula: string;
  readonly admission: 'require_admissible' | 'permit_unresolved';
}

export interface ParameterFormulaPreview {
  readonly format: 'intuit3d.parameter-formula-preview';
  readonly version: 1;
  readonly expression: ParameterExpression;
  readonly referencedParameterIds: readonly string[];
  readonly document: ProjectDocument;
  readonly events: readonly JournalEvent[];
  readonly evaluation: ParameterTablePreview['evaluation'];
  readonly invalidation: ParameterTablePreview['invalidation'];
  readonly exactGeometryAuthority: false;
}

type Token = { readonly kind: 'number' | 'name' | 'symbol' | 'end'; readonly text: string };
type NameTable = {
  readonly unit: ParameterUnit;
  readonly byName: ReadonlyMap<string, string>;
  readonly byId: ReadonlyMap<string, string>;
};
const end: Token = { kind: 'end', text: '' };
function fail(reason: string): never {
  throw new ProjectFormatError('parameter formula: ' + reason);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function names(source: ProjectDocument, targetId: string): NameTable {
  const project = parseProject(source);
  const living = featuresOf(project);
  const target = living.find((item) => item.id === targetId && item.kind === 'parameter');
  if (!target) fail('selected parameter does not exist: ' + targetId);
  const authored = target.payload.parameter;
  if (!plain(authored) || !UNITS.has(authored.unit as ParameterUnit)) {
    fail('selected parameter unit is invalid');
  }
  const byName = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const feature of living) {
    if (feature.kind !== 'parameter') continue;
    const parameter = feature.payload.parameter;
    if (!plain(parameter) || typeof parameter.name !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(parameter.name)) {
      fail('invalid live parameter display name at ' + feature.id);
    }
    if (byName.has(parameter.name)) fail('ambiguous parameter name: ' + parameter.name);
    byName.set(parameter.name, feature.id);
    byId.set(feature.id, parameter.name);
  }
  return { unit: authored.unit as ParameterUnit, byName, byId };
}
function lex(formula: string): Token[] {
  if (typeof formula !== 'string' || !formula.trim() ||
      formula.length > MAX_FORMULA_CHARACTERS) {
    fail('formula must contain 1-' + MAX_FORMULA_CHARACTERS + ' characters');
  }
  const tokens: Token[] = [];
  let index = 0;
  while (index < formula.length) {
    if (/\s/.test(formula[index]!)) { index++; continue; }
    const remainder = formula.slice(index);
    const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(remainder);
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(remainder);
    let token: Token;
    if (numeric) token = { kind: 'number', text: numeric[0] };
    else if (name) token = { kind: 'name', text: name[0] };
    else if ('+-*/()'.includes(formula[index]!)) {
      token = { kind: 'symbol', text: formula[index]! };
    } else fail('unsupported character at offset ' + index);
    tokens.push(token);
    if (tokens.length > MAX_FORMULA_TOKENS) fail('formula token limit exceeded');
    index += token.text.length;
  }
  return [...tokens, end];
}
function numericLiteral(text: string, unit: ParameterUnit): ParameterExpression {
  const value = Number(text);
  if (!Number.isFinite(value) ||
      (value === 0 && /[1-9]/.test(text.replace(/[eE].*$/, '')))) {
    fail('nonfinite or underflowed numeric literal');
  }
  return { op: 'literal', value, unit };
}
function referenced(expression: ParameterExpression): string[] {
  const seen = new Set<string>();
  const visit = (node: ParameterExpression): void => {
    if (node.op === 'ref') seen.add(node.featureId);
    else if (node.op === 'negate') visit(node.operand);
    else if (node.op !== 'literal') { visit(node.left); visit(node.right); }
  };
  visit(expression);
  return [...seen];
}

/**
 * Parse +, -, *, /, parentheses, signed numbers and explicit mm/deg suffixes.
 * Bare numbers are unitless multipliers, except when the ENTIRE formula is
 * a numeric literal, in which case it uses the target parameter's unit.
 * Unknown parameter names are refused; unresolved references require explicit
 * semantic feature authoring rather than guessing a future feature ID.
 */
export function parseParameterFormula(
  source: ProjectDocument, targetParameterId: string, formula: string,
): ParameterExpression {
  const table = names(source, targetParameterId);
  const tokens = lex(formula);
  let offset = 0;
  let nodes = 0;
  const peek = (): Token => tokens[offset] ?? end;
  const consume = (): Token => tokens[offset++] ?? end;
  const node = <T extends ParameterExpression>(value: T): T => {
    if (++nodes > MAX_FORMULA_TOKENS) fail('formula AST limit exceeded');
    return value;
  };
  const expression = (minimum: number, depth: number): ParameterExpression => {
    if (depth > MAX_FORMULA_DEPTH) fail('formula nesting limit exceeded');
    let left: ParameterExpression;
    const first = consume();
    if (first.kind === 'symbol' && (first.text === '-' || first.text === '+')) {
      const operand = expression(3, depth + 1);
      left = first.text === '-' ? node({ op: 'negate', operand }) : operand;
    } else if (first.kind === 'symbol' && first.text === '(') {
      left = expression(0, depth + 1);
      if (consume().text !== ')') fail('missing closing parenthesis');
    } else if (first.kind === 'number') {
      let unit: ParameterUnit = 'unitless';
      if (peek().kind === 'name' && (peek().text === 'mm' || peek().text === 'deg')) {
        unit = consume().text as ParameterUnit;
      }
      left = node(numericLiteral(first.text, unit));
    } else if (first.kind === 'name') {
      const featureId = table.byName.get(first.text);
      if (!featureId) fail('unknown named parameter: ' + first.text);
      left = node({ op: 'ref', featureId });
    } else fail('expected number, parameter or parenthesized expression');
    while (peek().kind === 'symbol') {
      const operator = peek().text;
      const precedence = operator === '+' || operator === '-' ? 1 :
        operator === '*' || operator === '/' ? 2 : 0;
      if (!precedence || precedence < minimum) break;
      consume();
      const right = expression(precedence + 1, depth + 1);
      const op = operator === '+' ? 'add' : operator === '-' ? 'subtract' :
        operator === '*' ? 'multiply' : 'divide';
      left = node({ op, left, right });
    }
    return left;
  };
  let parsed = expression(0, 0);
  if (peek().kind !== 'end') fail('unexpected trailing token: ' + peek().text);
  // Pure literal entry in a numeric parameter field should behave like a
  // scalar CAD inspector. Inside formulas, all units remain explicit.
  if (parsed.op === 'literal' && parsed.unit === 'unitless') {
    parsed = { ...parsed, unit: table.unit };
  } else if (parsed.op === 'negate' && parsed.operand.op === 'literal' &&
             parsed.operand.unit === 'unitless') {
    parsed = { op: 'negate', operand: { ...parsed.operand, unit: table.unit } };
  }
  return parsed;
}

/** Render a stored AST using CURRENT display names, preserving stable ID references. */
export function formatParameterFormula(
  source: ProjectDocument, targetParameterId: string,
  expression: ParameterExpression,
): string {
  const table = names(source, targetParameterId);
  let count = 0;
  const print = (value: ParameterExpression, depth: number): string => {
    if (++count > MAX_FORMULA_TOKENS || depth > MAX_FORMULA_DEPTH) {
      fail('stored expression exceeds display limits');
    }
    switch (value.op) {
      case 'literal':
        if (!Number.isFinite(value.value) || !UNITS.has(value.unit)) fail('invalid stored literal');
        return String(value.value) + (value.unit === 'unitless' ? '' : ' ' + value.unit);
      case 'ref': {
        const name = table.byId.get(value.featureId);
        if (!name) fail('unresolved stored parameter reference: ' + value.featureId);
        return name;
      }
      case 'negate': return '-(' + print(value.operand, depth + 1) + ')';
      case 'add': case 'subtract': case 'multiply': case 'divide': {
        const symbol = { add: '+', subtract: '-', multiply: '*', divide: '/' }[value.op];
        return '(' + print(value.left, depth + 1) + ' ' + symbol + ' ' +
          print(value.right, depth + 1) + ')';
      }
      default: return fail('unsupported stored expression');
    }
  };
  return print(expression, 0);
}

/**
 * Preview an edit in its authoritative journal/rebuild context. The existing
 * parameter-table contract validates expression dependencies, final scalar
 * units, dependent gates, and exactly one undoable mutation.
 */
export function previewParameterFormulaEdit(
  source: ProjectDocument, request: ParameterFormulaRequest,
): ParameterFormulaPreview {
  const original = parseProject(source);
  if (!plain(request) || Object.keys(request).length !== 8 ||
      !['format','version','expectedProjectId','expectedRevision','eventId',
        'featureId','formula','admission'].every((key) => Object.hasOwn(request, key)) ||
      request.format !== PARAMETER_FORMULA_FORMAT ||
      request.version !== PARAMETER_FORMULA_VERSION ||
      typeof request.eventId !== 'string' || !ID.test(request.eventId) ||
      typeof request.featureId !== 'string' || !ID.test(request.featureId)) {
    fail('unsupported or malformed edit request');
  }
  if (request.expectedProjectId !== original.projectId ||
      request.expectedRevision !== original.revision) {
    throw new ProjectRevisionError('parameter formula: stale project/revision');
  }
  const target = featuresOf(original).find((feature) => feature.id === request.featureId);
  if (!target || target.kind !== 'parameter' || !plain(target.payload.parameter) ||
      typeof target.payload.parameter.name !== 'string') {
    fail('target is not a live named parameter');
  }
  const expression = parseParameterFormula(original, request.featureId, request.formula);
  const table = previewParameterTableEdit(original, {
    format: PARAMETER_TABLE_FORMAT, version: 1,
    expectedProjectId: request.expectedProjectId,
    expectedRevision: request.expectedRevision,
    admission: request.admission,
    edits: [{ eventId: request.eventId, featureId: request.featureId,
      name: target.payload.parameter.name, expression }],
  });
  return {
    format: 'intuit3d.parameter-formula-preview', version: 1,
    expression, referencedParameterIds: referenced(expression),
    document: table.document, events: table.events,
    evaluation: table.evaluation, invalidation: table.invalidation,
    exactGeometryAuthority: false,
  };
}

export function commitUndoableParameterFormulaEdit(
  history: UndoHistory, request: ParameterFormulaRequest,
): UndoHistory {
  const session = parseUndoHistory(history);
  const preview = previewParameterFormulaEdit(session.document, request);
  return commitUndoableTransaction(session, preview.events, request.expectedRevision);
}
