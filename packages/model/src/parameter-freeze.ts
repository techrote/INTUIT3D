/**
 * @intuit3d/model/parameter-freeze/v1
 *
 * Make selected parametric dimensions independent without jumping back to their
 * obsolete authored fallback values. Snapshot the CURRENT resolved scalars into
 * authoritative numeric fields, remove the selected bindings, optionally
 * release explicitly reviewed binding-introduced edges, and optionally retire
 * an unused parameter. Everything is one journal/undo transaction.
 *
 * This is scalar intent only; geometric admission remains SKETCH/KERNEL-owned.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, ProjectDocument, JsonRecord } from './index.ts';
import {
  previewDimensionEdit, DIMENSION_EDIT_FORMAT, DIMENSION_EDIT_VERSION,
} from './dimension-edit.ts';
import {
  previewDimensionDependencyReconciliation,
  DIMENSION_DEPENDENCY_RECONCILE_FORMAT,
  DIMENSION_DEPENDENCY_RECONCILE_VERSION,
} from './dimension-dependency-reconcile.ts';
import { evaluateDimensionBindingPlan } from './dimension-bindings.ts';
import type { DimensionBindingEvaluation, DimensionFeatureGate } from './dimension-bindings.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import {
  previewTransaction, parseUndoHistory, commitUndoableTransaction,
  MAX_TRANSACTION_EVENTS,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const PARAMETER_FREEZE_FORMAT = 'intuit3d.parameter-freeze' as const;
export const PARAMETER_FREEZE_VERSION = 1 as const;
export const MAX_PARAMETER_FREEZE_FIELDS = 32;

export interface ParameterFreezeRequest {
  readonly format: typeof PARAMETER_FREEZE_FORMAT;
  readonly version: typeof PARAMETER_FREEZE_VERSION;
  readonly expectedRevision: number;
  readonly admission: 'require_admissible';
  /** One current bound numeric field per entry. IDs are durable journal IDs. */
  readonly edits: readonly {
    readonly eventId: string;
    readonly featureId: string;
    readonly field: string;
  }[];
  /**
   * Optional removal of binding-introduced edges. No edge is auto-released:
   * every entry must pass the existing journal-witness reconciliation contract.
   */
  readonly release: readonly {
    readonly eventId: string;
    readonly featureId: string;
    readonly dependencies: readonly string[];
  }[];
  readonly confirmIndependentIntentReviewed: boolean;
  /** Optional retirement after every dependent has been explicitly detached. */
  readonly retire: { readonly eventId: string; readonly parameterId: string } | null;
}

export interface ParameterFreezePreview {
  readonly format: 'intuit3d.parameter-freeze-preview';
  readonly version: 1;
  readonly events: readonly JournalEvent[];
  readonly document: ProjectDocument;
  readonly evaluation: DimensionBindingEvaluation;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly baked: readonly {
    readonly featureId: string;
    readonly field: string;
    readonly value: number;
  }[];
  readonly released: readonly {
    readonly featureId: string;
    readonly dependencyId: string;
    readonly introducedByEventId: string;
  }[];
  readonly retiredParameterId: string | null;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
function fail(message: string): never { throw new ProjectFormatError('parameter freeze: ' + message); }
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = Object.getPrototypeOf(value);
  return p === Object.prototype || p === null;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((f) => Object.hasOwn(value, f));
}
function admissible(gate: DimensionFeatureGate | undefined): boolean {
  return gate?.status === 'bound' || gate?.status === 'admissible';
}

/**
 * A zero-fallback, revision-fenced detach. If the selected binding is pending,
 * conflicting, or cannot resolve to a finite number, it is NOT frozen.
 *
 * A release requires explicit confirmation and a replay-verifiable witness
 * that the edge first appeared alongside a binding. Potential independently
 * meaningful dependencies remain untouched unless the user reviews them.
 */
export function previewParameterFreeze(
  input: ProjectDocument, request: ParameterFreezeRequest,
): ParameterFreezePreview {
  const original = parseProject(input);
  if (!plain(request) || !exact(request, [
    'format', 'version', 'expectedRevision', 'admission', 'edits', 'release',
    'confirmIndependentIntentReviewed', 'retire',
  ]) || request.format !== PARAMETER_FREEZE_FORMAT ||
      request.version !== PARAMETER_FREEZE_VERSION ||
      request.admission !== 'require_admissible' ||
      !Array.isArray(request.edits) ||
      request.edits.length < 1 || request.edits.length > MAX_PARAMETER_FREEZE_FIELDS ||
      !Array.isArray(request.release) ||
      request.release.length > MAX_PARAMETER_FREEZE_FIELDS ||
      typeof request.confirmIndependentIntentReviewed !== 'boolean') {
    fail('unsupported request or edit count');
  }
  if (request.expectedRevision !== original.revision) {
    throw new ProjectRevisionError('stale parameter freeze: expected ' +
      request.expectedRevision + ', actual ' + original.revision);
  }
  if (request.release.length && !request.confirmIndependentIntentReviewed) {
    fail('dependency release requires explicit independent-intent review');
  }
  if (request.edits.length + request.release.length + (request.retire ? 1 : 0) >
      MAX_TRANSACTION_EVENTS) {
    fail('transaction exceeds journal event budget');
  }

  const before = evaluateDimensionBindingPlan(planProject(original));
  const beforeGates = new Map(before.featureGates.map((g) => [g.featureId, g] as const));
  const baked: Array<{ featureId: string; field: string; value: number }> = [];
  const released: Array<{
    featureId: string; dependencyId: string; introducedByEventId: string;
  }> = [];
  const seenTargets = new Set<string>();
  const seenReleaseFeatures = new Set<string>();
  const events: JournalEvent[] = [];
  let working = original;

  for (const entry of request.edits) {
    if (!plain(entry) || !exact(entry, ['eventId', 'featureId', 'field']) ||
        typeof entry.eventId !== 'string' ||
        typeof entry.featureId !== 'string' || typeof entry.field !== 'string' ||
        !ID.test(entry.eventId) || !ID.test(entry.featureId) ||
        !FIELD.test(entry.field)) fail('invalid bound field entry');
    const edit = entry as { eventId: string; featureId: string; field: string };
    const target = edit.featureId + '\u0000' + edit.field;
    if (seenTargets.has(target)) fail('duplicate bound field ' + edit.featureId + '.' + edit.field);
    seenTargets.add(target);
    const originalFeature = featuresOf(original).find((f) => f.id === edit.featureId);
    const originalGate = beforeGates.get(edit.featureId);
    const manifest = originalFeature?.payload.dimensionBindings;
    if (!plain(manifest) || !Array.isArray(manifest.entries) ||
        !manifest.entries.some((e: unknown) =>
          plain(e) && e.field === edit.field)) {
      fail('field is not currently bound: ' + edit.featureId + '.' + edit.field);
    }
    const value = originalGate?.resolvedPayload?.[edit.field];
    if (originalGate?.status !== 'bound' ||
        typeof value !== 'number' || !Number.isFinite(value)) {
      fail('cannot bake an unresolved/invalid dimension: ' +
        edit.featureId + '.' + edit.field);
    }

    // Reuse DIMENSION's audited manifest/expression parser. Override only its
    // obsolete static fallback with the actual resolved scalar in the SAME
    // feature-edit event; subsequent edits see this authoritative numeric.
    const step = previewDimensionEdit(working, {
      format: DIMENSION_EDIT_FORMAT, version: DIMENSION_EDIT_VERSION,
      eventId: edit.eventId, featureId: edit.featureId, field: edit.field,
      binding: null, expectedRevision: working.revision,
      admission: 'permit_unresolved',
    });
    if (step.event.type !== 'feature.edit' || !step.event.patch.payload) {
      fail('dimension editor returned no editable payload');
    }
    const payload: JsonRecord = { ...step.event.patch.payload, [edit.field]: value };
    const event: JournalEvent = {
      ...step.event, patch: { ...step.event.patch, payload },
    };
    working = previewTransaction(working, [event]).document;
    events.push(event);
    baked.push({ featureId: edit.featureId, field: edit.field, value });
  }

  for (const entry of request.release) {
    if (!plain(entry) || !exact(entry, ['eventId', 'featureId', 'dependencies']) ||
        typeof entry.eventId !== 'string' || typeof entry.featureId !== 'string' ||
        !ID.test(entry.eventId) || !ID.test(entry.featureId) ||
        !Array.isArray(entry.dependencies) || !entry.dependencies.length ||
        entry.dependencies.some((id: unknown) => typeof id !== 'string' || !ID.test(id)) ||
        seenReleaseFeatures.has(entry.featureId)) {
      fail('invalid or repeated dependency release');
    }
    const release = entry as {
      eventId: string; featureId: string; dependencies: readonly string[];
    };
    seenReleaseFeatures.add(release.featureId);
    const proposal = previewDimensionDependencyReconciliation(working, {
      format: DIMENSION_DEPENDENCY_RECONCILE_FORMAT,
      version: DIMENSION_DEPENDENCY_RECONCILE_VERSION,
      eventId: release.eventId, featureId: release.featureId,
      expectedRevision: working.revision, release: release.dependencies,
      confirmIndependentIntentReviewed: true, admission: 'require_admissible',
    });
    working = proposal.document;
    events.push(proposal.event);
    for (const edge of proposal.released) {
      released.push({ featureId: release.featureId, ...edge });
    }
  }

  let retiredParameterId: string | null = null;
  if (request.retire !== null) {
    const retire = request.retire;
    if (!plain(retire) || !exact(retire, ['eventId', 'parameterId']) ||
        typeof retire.eventId !== 'string' || typeof retire.parameterId !== 'string' ||
        !ID.test(retire.eventId) || !ID.test(retire.parameterId)) {
      fail('invalid parameter retirement request');
    }
    const retired = retire as { eventId: string; parameterId: string };
    const living = featuresOf(working);
    const parameter = living.find((f) => f.id === retired.parameterId);
    if (!parameter || parameter.kind !== 'parameter') {
      fail('parameter to retire must exist and be a parameter');
    }
    // Preserve explicit intent even if no dimension binding still mentions it.
    // An independent parameter expression or direct dependency blocks removal.
    const consumers = living.filter((f) =>
      f.id !== retired.parameterId && f.dependsOn.includes(retired.parameterId));
    if (consumers.length) {
      fail('parameter still has semantic dependents: ' +
        consumers.map((f) => f.id).join(', '));
    }
    const event: JournalEvent = {
      eventId: retired.eventId, type: 'feature.remove', featureId: retired.parameterId,
    };
    working = previewTransaction(working, [event]).document;
    events.push(event);
    retiredParameterId = retired.parameterId;
  }

  // Recheck as ONE original-revision command, including event uniqueness.
  const final = previewTransaction(original, events, request.expectedRevision);
  const evaluation = evaluateDimensionBindingPlan(final.plan);
  const afterGates = new Map(evaluation.featureGates.map((g) => [g.featureId, g] as const));
  const invalidation = planIncrementalEvaluation(original, final.document);
  for (const entry of request.edits) {
    if (!admissible(afterGates.get(entry.featureId))) {
      fail('baked feature is not scalar-admissible: ' + entry.featureId);
    }
  }
  // Inspect ALL previously admitted consumers, not just those found by the
  // structural invalidation planner: a manually-authored expression might
  // mention a parameter without a corresponding explicit dependency edge.
  // Even malformed historical intent must not become silently admitted.
  for (const [id, priorGate] of beforeGates) {
    if (id === retiredParameterId || !admissible(priorGate)) continue;
    if (!admissible(afterGates.get(id))) {
      fail('freeze regresses an admitted dependent feature: ' + id);
    }
  }
  return {
    format: 'intuit3d.parameter-freeze-preview', version: 1,
    events: final.document.journal.slice(original.revision),
    document: final.document, evaluation, invalidation, baked, released,
    retiredParameterId,
  };
}

export function commitUndoableParameterFreeze(
  input: UndoHistory, request: ParameterFreezeRequest,
): UndoHistory {
  const history = parseUndoHistory(input);
  const preview = previewParameterFreeze(history.document, request);
  return commitUndoableTransaction(history, preview.events, request.expectedRevision);
}
