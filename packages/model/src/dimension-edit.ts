/**
 * @intuit3d/model/dimension-edit — versioned, undoable authoring of
 * retrospective dimension bindings.
 *
 * Builds one journal edit, rather than changing numeric payload values or
 * inferred shape state. Newly referenced parameters add explicit dependency
 * edges; existing edges are never guessed to be binding-owned and removed.
 * An unsatisfied forward reference may be authored, but never admitted as
 * resolved geometry.
 */
import {
  featuresOf, parseProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, ProjectDocument, JsonRecord } from './index.ts';
import {
  previewTransaction, commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import {
  DIMENSION_BINDINGS_FORMAT, DIMENSION_BINDINGS_VERSION,
  MAX_DIMENSION_BINDINGS_PER_FEATURE, evaluateDimensionBindingPlan,
} from './dimension-bindings.ts';
import type {
  DimensionBinding, DimensionBindingEvaluation, DimensionFeatureGate,
} from './dimension-bindings.ts';
import type { ParameterExpression, ParameterUnit } from './parameters.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';

export const DIMENSION_EDIT_FORMAT = 'intuit3d.dimension-edit' as const;
export const DIMENSION_EDIT_VERSION = 1 as const;

export interface DimensionEditRequest {
  readonly format: typeof DIMENSION_EDIT_FORMAT;
  readonly version: typeof DIMENSION_EDIT_VERSION;
  /** A fresh journal event ID; never an OCCT or renderer identifier. */
  readonly eventId: string;
  readonly featureId: string;
  readonly field: string;
  /** Null removes the binding, not the underlying authored numeric value. */
  readonly binding: Pick<DimensionBinding, 'unit' | 'expression'> | null;
  readonly expectedRevision: number;
  /** A deferred feature remains editable but has no admissible numeric value. */
  readonly admission: 'permit_unresolved' | 'require_admissible';
}

export interface DimensionEditPreview {
  readonly format: 'intuit3d.dimension-edit-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly evaluation: DimensionBindingEvaluation;
  readonly gate: DimensionFeatureGate;
  readonly invalidation: IncrementalEvaluationPlan;
}

const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const UNITS: ReadonlySet<string> = new Set(['mm', 'deg', 'unitless']);
const MAX_EXPRESSION_NODES = 2048;
const MAX_EXPRESSION_DEPTH = 64;

function fail(message: string): never { throw new ProjectFormatError(message); }
function plain(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function exact(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(v).length === keys.length &&
    keys.every(k => Object.hasOwn(v, k)) &&
    Object.keys(v).every(k => keys.includes(k));
}

/**
 * Validate expression structure independently of whether a parameter exists
 * yet. A future target cannot hide an oversized, malformed or cyclic AST.
 * This collects explicit semantic references, not inferred topological roles.
 */
function references(root: unknown): string[] {
  const refs: string[] = [];
  const seenRefs = new Set<string>();
  const seenNodes = new Set<object>();
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++count > MAX_EXPRESSION_NODES || depth > MAX_EXPRESSION_DEPTH) {
      fail('dimension expression complexity/depth limit exceeded');
    }
    if (!plain(value) || seenNodes.has(value)) fail('dimension expression must be an acyclic plain object');
    seenNodes.add(value);
    switch (value.op) {
      case 'literal':
        if (!exact(value, ['op', 'value', 'unit']) ||
            typeof value.value !== 'number' || !Number.isFinite(value.value) ||
            !UNITS.has(value.unit as string)) fail('invalid dimension literal');
        break;
      case 'ref':
        if (!exact(value, ['op', 'featureId']) ||
            typeof value.featureId !== 'string' || !ID.test(value.featureId)) {
          fail('invalid dimension semantic parameter reference');
        }
        if (!seenRefs.has(value.featureId)) {
          refs.push(value.featureId); seenRefs.add(value.featureId);
        }
        break;
      case 'negate':
        if (!exact(value, ['op', 'operand'])) fail('invalid dimension negation');
        pending.push({ value: value.operand, depth: depth + 1 });
        break;
      case 'add':
      case 'subtract':
      case 'multiply':
      case 'divide':
        if (!exact(value, ['op', 'left', 'right'])) fail('invalid dimension binary expression');
        pending.push({ value: value.right, depth: depth + 1 });
        pending.push({ value: value.left, depth: depth + 1 });
        break;
      default:
        fail('unsupported dimension expression operator');
    }
  }
  return refs;
}

/**
 * Preflight one binding edit. Strict admission rejects any changed-feature
 * binding/parameter/model failure. Permissive admission records unresolved
 * intent with explicit null derived payload; no fallback may be used.
 */
export function previewDimensionEdit(
  input: ProjectDocument, request: DimensionEditRequest,
): DimensionEditPreview {
  const document = parseProject(input);
  if (!plain(request) || !exact(request, [
    'format', 'version', 'eventId', 'featureId', 'field',
    'binding', 'expectedRevision', 'admission',
  ]) || request.format !== DIMENSION_EDIT_FORMAT ||
      request.version !== DIMENSION_EDIT_VERSION) fail('unsupported dimension edit request');
  if (document.revision !== request.expectedRevision) {
    throw new ProjectRevisionError('stale dimension edit revision: expected ' +
      request.expectedRevision + ', actual ' + document.revision);
  }
  if (request.admission !== 'permit_unresolved' && request.admission !== 'require_admissible') {
    fail('unsupported dimension admission mode');
  }
  if (!FIELD.test(request.field) || request.field === 'dimensionBindings') fail('invalid dimension target field');
  const existing = featuresOf(document);
  const feature = existing.find(f => f.id === request.featureId);
  if (!feature) fail('cannot edit absent semantic feature ' + request.featureId);
  if (feature.kind === 'parameter') fail('cannot bind a parameter feature as a geometric field');
  if (!Object.hasOwn(feature.payload, request.field) ||
      typeof feature.payload[request.field] !== 'number' ||
      !Number.isFinite(feature.payload[request.field])) {
    fail('dimension target must be an existing finite numeric field');
  }

  const payload: JsonRecord = Object.assign(Object.create(null) as JsonRecord, feature.payload);
  const prior = payload.dimensionBindings;
  let entries: DimensionBinding[] = [];
  if (prior !== undefined) {
    if (!plain(prior) || !exact(prior, ['format', 'version', 'entries']) ||
        prior.format !== DIMENSION_BINDINGS_FORMAT ||
        prior.version !== DIMENSION_BINDINGS_VERSION ||
        !Array.isArray(prior.entries) || prior.entries.length > MAX_DIMENSION_BINDINGS_PER_FEATURE) {
      fail('existing binding manifest is unsupported; preserve for manual recovery');
    }
    const seen = new Set<string>();
    for (const entry of prior.entries) {
      if (!plain(entry) || !exact(entry, ['field', 'unit', 'expression']) ||
          typeof entry.field !== 'string' || !FIELD.test(entry.field) ||
          seen.has(entry.field) || !UNITS.has(entry.unit as string)) {
        fail('existing binding manifest has malformed or duplicate entries');
      }
      // Validate all retained expressions even when the edited feature is pending.
      references(entry.expression);
      seen.add(entry.field);
      entries.push(entry as unknown as DimensionBinding);
    }
  }

  const edges = [...feature.dependsOn];
  if (request.binding !== null) {
    if (!plain(request.binding) || !exact(request.binding, ['unit', 'expression']) ||
        !UNITS.has(request.binding.unit)) fail('invalid dimension edit binding');
    const refs = references(request.binding.expression);
    for (const ref of refs) {
      const known = existing.find(f => f.id === ref);
      if (known && known.kind !== 'parameter') fail('dimension references non-parameter feature ' + ref);
      if (!edges.includes(ref)) edges.push(ref);
    }
    const replacement: DimensionBinding = {
      field: request.field, unit: request.binding.unit as ParameterUnit,
      expression: request.binding.expression as ParameterExpression,
    };
    const at = entries.findIndex(e => e.field === request.field);
    if (at < 0) entries.push(replacement);
    else entries[at] = replacement;
  } else {
    entries = entries.filter(e => e.field !== request.field);
  }
  if (entries.length > MAX_DIMENSION_BINDINGS_PER_FEATURE) fail('binding limit exceeded');
  if (entries.length) {
    payload.dimensionBindings = {
      format: DIMENSION_BINDINGS_FORMAT, version: DIMENSION_BINDINGS_VERSION,
      entries,
    } as unknown as JsonRecord; // AST validated above; journal parser revalidates JSON.
  } else {
    delete payload.dimensionBindings;
  }

  const event: JournalEvent = {
    eventId: request.eventId, type: 'feature.edit', featureId: feature.id,
    patch: { dependsOn: edges, payload },
  };
  const preview = previewTransaction(document, [event], request.expectedRevision);
  const evaluation = evaluateDimensionBindingPlan(preview.plan);
  const gate = evaluation.featureGates.find(g => g.featureId === feature.id);
  if (!gate) fail('missing derived dimension gate');
  const admitted = gate.status === 'bound' || (request.binding === null && gate.status === 'admissible');
  if (request.admission === 'require_admissible' && !admitted) {
    fail('dimension edit not admissible: ' + gate.status + ' / ' +
      gate.diagnostics.map(d => d.code).join(','));
  }
  return {
    format: 'intuit3d.dimension-edit-preview', version: 1,
    event: preview.document.journal[preview.document.journal.length - 1],
    document: preview.document, evaluation, gate,
    invalidation: planIncrementalEvaluation(document, preview.document),
  };
}

/** One atomic, undoable journal event. No background or geometry mutation. */
export function commitUndoableDimensionEdit(
  input: UndoHistory, request: DimensionEditRequest,
): UndoHistory {
  const session = parseUndoHistory(input);
  const preview = previewDimensionEdit(session.document, request);
  return commitUndoableTransaction(session, [preview.event], request.expectedRevision);
}

/** Audited expression walker shared by conservative dependency repair. */
export { references as collectDimensionParameterReferences };
