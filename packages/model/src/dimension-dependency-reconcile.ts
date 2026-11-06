/**
 * @intuit3d/model/dimension-dependency-reconcile — conservative v1 repair
 * of orphaned dependency edges introduced alongside retrospective bindings.
 *
 * An explicit author confirmation and a replay-verifiable binding-introduction
 * witness are BOTH required. Co-occurrence is not proof that an edge has no
 * independent meaning: the caller must inspect it before confirming release.
 * Nothing is removed automatically when a binding is cleared/replaced.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError,
  ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, JsonRecord, ProjectDocument } from './index.ts';
import {
  DIMENSION_BINDINGS_FORMAT, DIMENSION_BINDINGS_VERSION,
  MAX_DIMENSION_BINDINGS_PER_FEATURE, evaluateDimensionBindingPlan,
} from './dimension-bindings.ts';
import type {
  DimensionBindingEvaluation, DimensionFeatureGate,
} from './dimension-bindings.ts';
import { collectDimensionParameterReferences } from './dimension-edit.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import {
  previewTransaction, parseUndoHistory, commitUndoableTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const DIMENSION_DEPENDENCY_RECONCILE_FORMAT =
  'intuit3d.dimension-dependency-reconcile' as const;
export const DIMENSION_DEPENDENCY_RECONCILE_VERSION = 1 as const;
export const MAX_RECONCILED_DEPENDENCIES = 64;

export interface DimensionDependencyReconcileRequest {
  readonly format: typeof DIMENSION_DEPENDENCY_RECONCILE_FORMAT;
  readonly version: typeof DIMENSION_DEPENDENCY_RECONCILE_VERSION;
  readonly eventId: string;
  readonly featureId: string;
  readonly expectedRevision: number;
  /** Never inferred: list of precisely named, journal-authored edges to release. */
  readonly release: readonly string[];
  /** Caller examined potential independent meaning. Cannot be silently defaulted. */
  readonly confirmIndependentIntentReviewed: true;
  readonly admission: 'require_admissible' | 'permit_unresolved';
}

export interface ReleasedDimensionDependency {
  readonly dependencyId: string;
  /** Authoritative event introducing this edge together with a binding. */
  readonly introducedByEventId: string;
}
export interface DimensionDependencyReconcilePreview {
  readonly format: 'intuit3d.dimension-dependency-reconcile-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly released: readonly ReleasedDimensionDependency[];
  readonly retainedDependencies: readonly string[];
  readonly beforeGate: DimensionFeatureGate;
  readonly afterGate: DimensionFeatureGate;
  readonly evaluation: DimensionBindingEvaluation;
  readonly invalidation: IncrementalEvaluationPlan;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const UNITS: ReadonlySet<string> = new Set(['mm', 'deg', 'unitless']);
function fail(message: string): never { throw new ProjectFormatError(message); }
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key));
}

/** Validate the complete manifest, not just the field being unbound. */
function bindingReferences(payload: Readonly<JsonRecord>): Set<string> {
  const refs = new Set<string>();
  if (!Object.hasOwn(payload, 'dimensionBindings')) return refs;
  const manifest = payload.dimensionBindings;
  if (!plain(manifest) || !exact(manifest, ['format', 'version', 'entries']) ||
      manifest.format !== DIMENSION_BINDINGS_FORMAT ||
      manifest.version !== DIMENSION_BINDINGS_VERSION ||
      !Array.isArray(manifest.entries) ||
      manifest.entries.length > MAX_DIMENSION_BINDINGS_PER_FEATURE) {
    fail('unsupported dimension binding manifest: preserve dependency for recovery');
  }
  const fields = new Set<string>();
  for (const entry of manifest.entries) {
    if (!plain(entry) || !exact(entry, ['field', 'unit', 'expression']) ||
        typeof entry.field !== 'string' || !FIELD.test(entry.field) ||
        entry.field === 'dimensionBindings' || fields.has(entry.field) ||
        !UNITS.has(entry.unit as string) ||
        !Object.hasOwn(payload, entry.field) ||
        typeof payload[entry.field] !== 'number' ||
        !Number.isFinite(payload[entry.field])) {
      fail('invalid dimension binding entry: preserve dependency for recovery');
    }
    fields.add(entry.field);
    for (const id of collectDimensionParameterReferences(entry.expression)) refs.add(id);
  }
  return refs;
}

/**
 * Examine the latest introduction of each edge in the *authoritative journal*.
 * A pre-existing/independently authored edge cannot become releasable merely
 * because a later binding also references it. Reintroductions supersede older
 * witnesses; a generic graph edit without a matching binding invalidates one.
 *
 * Binding coincidence is only an audit witness, NOT a proof of exclusive
 * ownership: the API additionally requires deliberate caller confirmation.
 */
function introductionWitnesses(
  document: ProjectDocument, featureId: string,
): Map<string, string> {
  const witnesses = new Map<string, string>();
  let edges: readonly string[] = [];
  for (const event of document.journal) {
    if (event.type === 'feature.create' && event.feature.id === featureId) {
      edges = event.feature.dependsOn;
      witnesses.clear(); // dependencies on creation are never assumed binding-owned
    } else if (event.type === 'feature.edit' && event.featureId === featureId &&
        event.patch.dependsOn !== undefined) {
      const next = event.patch.dependsOn;
      const previous = new Set(edges);
      const current = new Set(next);
      for (const old of edges) if (!current.has(old)) witnesses.delete(old);
      const introduced = next.filter((id) => !previous.has(id));
      if (introduced.length) {
        const refs = event.patch.payload === undefined ?
          new Set<string>() : bindingReferences(event.patch.payload);
        for (const id of introduced) {
          witnesses.delete(id);
          if (refs.has(id)) witnesses.set(id, event.eventId);
        }
      }
      edges = next;
    }
  }
  return witnesses;
}

function admissible(gate: DimensionFeatureGate | undefined): boolean {
  return gate?.status === 'bound' || gate?.status === 'admissible';
}

/**
 * Preflight explicit author-confirmed dependency release. Does NOT clear a
 * binding, rewrite numerical values, choose body targets or certify B-rep.
 */
export function previewDimensionDependencyReconciliation(
  input: ProjectDocument, request: DimensionDependencyReconcileRequest,
): DimensionDependencyReconcilePreview {
  const document = parseProject(input);
  if (!plain(request) || !exact(request, [
    'format', 'version', 'eventId', 'featureId', 'expectedRevision',
    'release', 'confirmIndependentIntentReviewed', 'admission',
  ]) || request.format !== DIMENSION_DEPENDENCY_RECONCILE_FORMAT ||
      request.version !== DIMENSION_DEPENDENCY_RECONCILE_VERSION ||
      request.confirmIndependentIntentReviewed !== true ||
      !ID.test(request.eventId) || !ID.test(request.featureId) ||
      !Array.isArray(request.release) || request.release.length < 1 ||
      request.release.length > MAX_RECONCILED_DEPENDENCIES ||
      request.release.some((id) => typeof id !== 'string' || !ID.test(id)) ||
      new Set(request.release).size !== request.release.length ||
      (request.admission !== 'require_admissible' &&
       request.admission !== 'permit_unresolved')) {
    fail('unsupported or unconfirmed dimension dependency reconciliation');
  }
  if (document.revision !== request.expectedRevision) {
    throw new ProjectRevisionError('stale dependency reconciliation: expected ' +
      request.expectedRevision + ', actual ' + document.revision);
  }
  const existing = featuresOf(document);
  const feature = existing.find((f) => f.id === request.featureId);
  if (!feature || feature.kind === 'parameter') {
    fail('dependency release requires a living non-parameter feature');
  }
  const refs = bindingReferences(feature.payload);
  const witnesses = introductionWitnesses(document, feature.id);
  const released: ReleasedDimensionDependency[] = [];
  for (const dependencyId of request.release) {
    if (!feature.dependsOn.includes(dependencyId)) {
      fail('dependency edge absent: ' + dependencyId);
    }
    if (refs.has(dependencyId)) {
      fail('dependency remains referenced by a live dimension binding: ' + dependencyId);
    }
    const known = existing.find((f) => f.id === dependencyId);
    if (known && known.kind !== 'parameter') {
      fail('cannot release an independently meaningful non-parameter dependency: ' +
        dependencyId);
    }
    const introducedByEventId = witnesses.get(dependencyId);
    if (!introducedByEventId) {
      fail('dependency has no binding-introduction witness: ' + dependencyId);
    }
    released.push({ dependencyId, introducedByEventId });
  }
  const remove = new Set(request.release);
  const retainedDependencies = feature.dependsOn.filter((id) => !remove.has(id));
  const event: JournalEvent = {
    eventId: request.eventId, type: 'feature.edit', featureId: feature.id,
    patch: { dependsOn: retainedDependencies },
  };
  const before = evaluateDimensionBindingPlan(planProject(document));
  const transaction = previewTransaction(document, [event], request.expectedRevision);
  const evaluation = evaluateDimensionBindingPlan(transaction.plan);
  const beforeGate = before.featureGates.find((g) => g.featureId === feature.id);
  const afterGate = evaluation.featureGates.find((g) => g.featureId === feature.id);
  if (!beforeGate || !afterGate) fail('missing derived dimension feature gate');
  const invalidation = planIncrementalEvaluation(document, transaction.document);
  if (request.admission === 'require_admissible') {
    if (!admissible(afterGate)) fail('released dependencies leave feature nonadmissible');
    const beforeById = new Map(before.featureGates.map((g) => [g.featureId, g] as const));
    const afterById = new Map(evaluation.featureGates.map((g) => [g.featureId, g] as const));
    for (const id of invalidation.invalidatedFeatureIds) {
      if (admissible(beforeById.get(id)) && !admissible(afterById.get(id))) {
        fail('dependency release regresses an admissible dependent feature: ' + id);
      }
    }
  }
  return {
    format: 'intuit3d.dimension-dependency-reconcile-preview', version: 1,
    event: transaction.document.journal[transaction.document.journal.length - 1],
    document: transaction.document, released, retainedDependencies,
    beforeGate, afterGate, evaluation, invalidation,
  };
}

/** Append one fully validated journal event and one undo frame, or nothing. */
export function commitUndoableDimensionDependencyReconciliation(
  input: UndoHistory, request: DimensionDependencyReconcileRequest,
): UndoHistory {
  const history = parseUndoHistory(input);
  const preview = previewDimensionDependencyReconciliation(history.document, request);
  return commitUndoableTransaction(history, [preview.event], request.expectedRevision);
}
