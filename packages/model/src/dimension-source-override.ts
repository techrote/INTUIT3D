/**
 * @intuit3d/model/dimension-source-override/v1
 * User-chosen detachment of a resolved formula/literal binding, replacing its
 * effective dimension with a new authored scalar in ONE undoable journal event.
 * Parameter consumers and stable feature/body IDs are not rewritten.
 */
import { featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError } from './index.ts';
import type { JournalEvent, JsonRecord, ProjectDocument } from './index.ts';
import { DIMENSION_EDIT_FORMAT, previewDimensionEdit } from './dimension-edit.ts';
import { DIMENSION_DEPENDENCY_RECONCILE_FORMAT, previewDimensionDependencyReconciliation } from './dimension-dependency-reconcile.ts';
import { inspectDimensionValue } from './dimension-value-edit.ts';
import { evaluateDimensionBindingPlan } from './dimension-bindings.ts';
import type { DimensionBindingEvaluation, DimensionFeatureGate } from './dimension-bindings.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import type { ParameterUnit } from './parameters.ts';
import { previewTransaction, parseUndoHistory, commitUndoableTransaction } from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const DIMENSION_SOURCE_OVERRIDE_FORMAT = 'intuit3d.dimension-source-override' as const;
export const DIMENSION_SOURCE_OVERRIDE_VERSION = 1 as const;
export interface DimensionSourceOverrideRequest {
  readonly format: typeof DIMENSION_SOURCE_OVERRIDE_FORMAT;
  readonly version: typeof DIMENSION_SOURCE_OVERRIDE_VERSION;
  readonly action: 'detach_and_set_scalar';
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly eventId: string;
  readonly featureId: string;
  readonly field: string;
  readonly unit: ParameterUnit;
  /** Exact effective value as inspected, not rounded UI text. */
  readonly expectedEffectiveValue: number;
  readonly value: number;
  /** Explicitly named edges; NEVER automatically infer exclusive ownership. */
  readonly releaseDependencies: readonly string[];
  readonly confirmIndependentIntentReviewed: boolean;
  readonly admission: 'require_admissible' | 'permit_unresolved';
}
export interface DimensionSourceOverridePreview {
  readonly format: 'intuit3d.dimension-source-override-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly evaluation: DimensionBindingEvaluation;
  readonly editedGate: DimensionFeatureGate;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly previousEffectiveValue: number;
  readonly previousAuthoredValue: number;
  readonly newAuthoredValue: number;
  readonly releasedDependencies: readonly string[];
  readonly retainedDependencies: readonly string[];
  readonly requiresSketchAdmission: true;
  readonly requiresNativeRebuild: true;
  readonly exactGeometryAuthority: false;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(message: string): never { throw new ProjectFormatError('dimension source override: ' + message); }
function plain(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}
function exact(v: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(v).length === fields.length && fields.every((f) => Object.hasOwn(v, f));
}
function admitted(g: DimensionFeatureGate | undefined): boolean {
  return g?.status === 'admissible' || g?.status === 'bound';
}
function probeId(doc: ProjectDocument): string {
  const existing = new Set(doc.journal.map((e) => e.eventId));
  let i = 0;
  while (existing.has('intuitOverrideProbe' + i)) i++;
  return 'intuitOverrideProbe' + i;
}

/** Single canonical event; no committed intermediate fallback or guessed inverse. */
export function previewDimensionSourceOverride(
  input: ProjectDocument, request: DimensionSourceOverrideRequest,
): DimensionSourceOverridePreview {
  const doc = parseProject(input);
  if (!plain(request) || !exact(request, [
    'format','version','action','expectedProjectId','expectedRevision','eventId',
    'featureId','field','unit','expectedEffectiveValue','value',
    'releaseDependencies','confirmIndependentIntentReviewed','admission',
  ]) || request.format !== DIMENSION_SOURCE_OVERRIDE_FORMAT ||
    request.version !== DIMENSION_SOURCE_OVERRIDE_VERSION ||
    request.action !== 'detach_and_set_scalar' ||
    typeof request.eventId !== 'string' || !ID.test(request.eventId) ||
    typeof request.featureId !== 'string' || !ID.test(request.featureId) ||
    typeof request.field !== 'string' ||
    typeof request.expectedEffectiveValue !== 'number' || !Number.isFinite(request.expectedEffectiveValue) ||
    typeof request.value !== 'number' || !Number.isFinite(request.value) ||
    !Array.isArray(request.releaseDependencies) || request.releaseDependencies.length > 64 ||
    request.releaseDependencies.some((id) => typeof id !== 'string' || !ID.test(id)) ||
    new Set(request.releaseDependencies).size !== request.releaseDependencies.length ||
    typeof request.confirmIndependentIntentReviewed !== 'boolean' ||
    (request.releaseDependencies.length > 0 && !request.confirmIndependentIntentReviewed) ||
    (request.admission !== 'require_admissible' && request.admission !== 'permit_unresolved')) {
    fail('unsupported or malformed explicit override request');
  }
  if (request.expectedProjectId !== doc.projectId || request.expectedRevision !== doc.revision) {
    throw new ProjectRevisionError('dimension source override: stale project/revision');
  }
  const inspected = inspectDimensionValue(doc, request.featureId, request.field, request.unit);
  if ((inspected.availability !== 'literal_parameter' &&
       inspected.availability !== 'formula_requires_parameter_edit') ||
      inspected.currentValue === null) {
    fail('only a resolved bound dimension can be explicitly detached');
  }
  if (inspected.currentValue !== request.expectedEffectiveValue) {
    throw new ProjectRevisionError('dimension source override: inspected value changed');
  }
  // Preflight the existing binding editor with a transient journal revision.
  const unbound = previewDimensionEdit(doc, {
    format: DIMENSION_EDIT_FORMAT, version: 1,
    eventId: request.eventId, featureId: request.featureId, field: request.field,
    binding: null, expectedRevision: doc.revision, admission: 'permit_unresolved',
  });
  const source = featuresOf(unbound.document).find((f) => f.id === request.featureId);
  if (!source) fail('edited feature disappeared');
  let dependsOn = [...source.dependsOn];
  if (request.releaseDependencies.length) {
    // The reconciler checks real journal introduction witnesses, remaining
    // bindings, independently authored edges and user confirmation. Its probe
    // does not get committed.
    const release = previewDimensionDependencyReconciliation(unbound.document, {
      format: DIMENSION_DEPENDENCY_RECONCILE_FORMAT, version: 1,
      eventId: probeId(unbound.document), featureId: request.featureId,
      expectedRevision: unbound.document.revision,
      release: request.releaseDependencies, confirmIndependentIntentReviewed: true,
      admission: 'permit_unresolved',
    });
    dependsOn = [...release.retainedDependencies];
  }
  const payload: JsonRecord = { ...source.payload, [request.field]: request.value };
  const event: JournalEvent = {
    type: 'feature.edit', eventId: request.eventId, featureId: request.featureId,
    patch: { dependsOn, payload },
  };
  const final = previewTransaction(doc, [event], doc.revision);
  const evaluation = evaluateDimensionBindingPlan(final.plan);
  const editedGate = evaluation.featureGates.find((g) => g.featureId === request.featureId);
  if (!editedGate) fail('edited feature missing from evaluation');
  const invalidation = planIncrementalEvaluation(doc, final.document);
  if (request.admission === 'require_admissible') {
    if (!admitted(editedGate)) fail('detachment is not dimension-admissible');
    const previous = evaluateDimensionBindingPlan(planProject(doc));
    const before = new Map(previous.featureGates.map((g) => [g.featureId, g] as const));
    const after = new Map(evaluation.featureGates.map((g) => [g.featureId, g] as const));
    for (const id of invalidation.invalidatedFeatureIds) {
      if (admitted(before.get(id)) && !admitted(after.get(id))) {
        fail('detachment regresses previously admitted feature ' + id);
      }
    }
  }
  return {
    format: 'intuit3d.dimension-source-override-preview', version: 1,
    event: final.document.journal[final.document.journal.length - 1]!,
    document: final.document, evaluation, editedGate, invalidation,
    previousEffectiveValue: inspected.currentValue, previousAuthoredValue: inspected.authoredValue,
    newAuthoredValue: request.value,
    releasedDependencies: [...request.releaseDependencies], retainedDependencies: dependsOn,
    requiresSketchAdmission: true, requiresNativeRebuild: true, exactGeometryAuthority: false,
  };
}
export function commitUndoableDimensionSourceOverride(
  input: UndoHistory, request: DimensionSourceOverrideRequest,
): UndoHistory {
  const history = parseUndoHistory(input);
  const preview = previewDimensionSourceOverride(history.document, request);
  return commitUndoableTransaction(history, [preview.event], request.expectedRevision);
}
