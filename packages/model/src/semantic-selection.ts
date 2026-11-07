/**
 * @intuit3d/model/semantic-selection — versioned v1 authored face/body target.
 *
 * Persistent source anchors live in the model journal. Provider observations
 * and split/merge maps are DERIVED, never persisted as geometric authority.
 * This module cannot assert that an OCCT shape is exact or current.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { FeatureStatus, JournalEvent, JsonRecord, JsonValue, ProjectDocument } from './index.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import {
  parseSemanticTopologyReference, resolveSemanticTopologyReference,
} from './topology.ts';
import type {
  SemanticTopologyReference, TopologyAnchor, TopologyResolution, TopologySnapshot, TopologyStep,
} from './topology.ts';
import {
  previewTransaction, commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const SEMANTIC_SELECTION_EDIT_FORMAT = 'intuit3d.semantic-selection-edit' as const;
export const SEMANTIC_SELECTION_RECOVERY_FORMAT = 'intuit3d.semantic-selection-recovery' as const;
export const SEMANTIC_SELECTION_VERSION = 1 as const;

export interface SemanticSelectionEditRequest {
  readonly format: typeof SEMANTIC_SELECTION_EDIT_FORMAT;
  readonly version: typeof SEMANTIC_SELECTION_VERSION;
  readonly eventId: string;
  /** Existing consumer operation (e.g. cut/fillet) to author the target on. */
  readonly featureId: string;
  /** Existing or new, explicit payload field; never overwrites other data. */
  readonly field: string;
  readonly expectedRevision: number;
  readonly reference: SemanticTopologyReference;
  readonly admission: 'require_ready' | 'permit_pending';
}
export interface SemanticSelectionRecoveryRequest {
  readonly format: typeof SEMANTIC_SELECTION_RECOVERY_FORMAT;
  readonly version: typeof SEMANTIC_SELECTION_VERSION;
  readonly eventId: string;
  readonly featureId: string;
  readonly field: string;
  readonly expectedRevision: number;
  /** Actual source-revision provider observations (not an authority claim). */
  readonly snapshot: TopologySnapshot;
  readonly steps: readonly TopologyStep[];
  /** Explicit user choice among observed split/merge successors. */
  readonly selected: TopologyAnchor;
  readonly admission: 'require_ready' | 'permit_pending';
}
export interface SemanticSelectionPreview {
  readonly format: 'intuit3d.semantic-selection-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly featureStatus: FeatureStatus;
  readonly reference: SemanticTopologyReference;
}
export type SemanticSelectionStatus =
  'unselected' | 'pending_model' | 'pending_evidence' |
  'candidate' | 'requires_reconciliation' | 'deleted';
export interface SemanticSelectionAssessment {
  readonly format: 'intuit3d.semantic-selection-assessment';
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly featureId: string;
  readonly field: string;
  readonly status: SemanticSelectionStatus;
  /** Provider-observed only. Never an exact B-rep/STEP certification. */
  readonly resolution: TopologyResolution | null;
  readonly diagnosticCodes: readonly string[];
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
function fail(message: string): never { throw new ProjectFormatError(message); }
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
function checkField(field: unknown): asserts field is string {
  if (typeof field !== 'string' || !FIELD.test(field) ||
      field === 'dimensionBindings' || field === 'parameter') {
    fail('unsupported semantic selection field');
  }
}
function livingConsumer(doc: ProjectDocument, id: string) {
  const feature = featuresOf(doc).find((f) => f.id === id);
  if (!feature) fail('selection consumer must be a living feature: ' + id);
  return feature;
}
function sameAnchor(a: TopologyAnchor, b: TopologyAnchor): boolean {
  return a.kind === b.kind && a.featureId === b.featureId && a.roleId === b.roleId;
}
function currentReference(doc: ProjectDocument, featureId: string, field: string):
  SemanticTopologyReference | undefined {
  const raw = livingConsumer(doc, featureId).payload[field];
  return raw === undefined ? undefined : parseSemanticTopologyReference(raw);
}

/**
 * Author or replace a selection as ONE journal event. Its dependency is
 * explicit and retained even if a later selection changes (an old edge might
 * also encode independent author intent). No B-rep lineage is inferred.
 */
export function previewSemanticSelectionEdit(
  source: ProjectDocument, request: SemanticSelectionEditRequest,
): SemanticSelectionPreview {
  const doc = parseProject(source);
  if (!plain(request) || !exact(request, [
    'format','version','eventId','featureId','field','expectedRevision','reference','admission',
  ]) || request.format !== SEMANTIC_SELECTION_EDIT_FORMAT ||
      request.version !== SEMANTIC_SELECTION_VERSION ||
      typeof request.eventId !== 'string' || !ID.test(request.eventId) ||
      typeof request.featureId !== 'string' || !ID.test(request.featureId) ||
      (request.admission !== 'require_ready' && request.admission !== 'permit_pending')) {
    fail('unsupported semantic selection edit');
  }
  checkField(request.field);
  if (request.expectedRevision !== doc.revision) {
    throw new ProjectRevisionError('stale semantic selection revision');
  }
  const reference = parseSemanticTopologyReference(request.reference);
  if (reference.projectId !== doc.projectId || reference.atRevision > doc.revision) {
    fail('selection must belong to this project and an existing revision');
  }
  if (reference.anchor.featureId === request.featureId) {
    fail('a feature cannot target its own derived topology');
  }
  const consumer = livingConsumer(doc, request.featureId);
  currentReference(doc, request.featureId, request.field); // reject overwriting unrelated payload
  if (request.admission === 'require_ready') {
    // A source role can only have been seen after its feature was authored.
    const sourceAtReference = parseProject({
      ...doc, revision: reference.atRevision,
      journal: doc.journal.slice(0, reference.atRevision),
    });
    if (!featuresOf(sourceAtReference).some((f) => f.id === reference.anchor.featureId)) {
      fail('strict selection has no source feature at its claimed source revision');
    }
  }
  const dependsOn = [...consumer.dependsOn];
  if (!dependsOn.includes(reference.anchor.featureId)) {
    dependsOn.push(reference.anchor.featureId);
  }
  const payload: JsonRecord = {
    ...consumer.payload, [request.field]: reference as unknown as JsonValue,
  };
  const event: JournalEvent = {
    eventId: request.eventId, type: 'feature.edit', featureId: consumer.id,
    patch: { dependsOn, payload },
  };
  const preview = previewTransaction(doc, [event], request.expectedRevision);
  const state = preview.plan.features.find((f) => f.feature.id === consumer.id);
  if (!state) fail('selection consumer disappeared during preview');
  if (request.admission === 'require_ready' && state.status !== 'ready') {
    fail('selection edit leaves feature ' + state.status + ': ' +
      state.diagnostics.map((d) => d.code).join(','));
  }
  return {
    format: 'intuit3d.semantic-selection-preview', version: 1,
    event: preview.document.journal[preview.document.journal.length - 1],
    document: preview.document,
    invalidation: planIncrementalEvaluation(doc, preview.document),
    featureStatus: state.status, reference,
  };
}

export function commitUndoableSemanticSelectionEdit(
  history: UndoHistory, request: SemanticSelectionEditRequest,
): UndoHistory {
  const session = parseUndoHistory(history);
  const preview = previewSemanticSelectionEdit(session.document, request);
  return commitUndoableTransaction(session, [preview.event], request.expectedRevision);
}

/**
 * Evaluate the stored intent against FRESH provider observations.
 * 'candidate' means a reported one-to-one role, not validated exact geometry.
 * Missing evidence cannot be replaced with same-name or enumeration guesses.
 */
export function assessSemanticSelection(
  source: ProjectDocument, featureId: string, field: string,
  evidence?: { readonly snapshot: TopologySnapshot; readonly steps: readonly TopologyStep[] },
): SemanticSelectionAssessment {
  const doc = parseProject(source);
  checkField(field);
  const reference = currentReference(doc, featureId, field);
  const state = planProject(doc).features.find((f) => f.feature.id === featureId);
  if (!state) fail('selection consumer disappeared');
  let status: SemanticSelectionStatus = 'pending_evidence';
  let resolution: TopologyResolution | null = null;
  const diagnosticCodes: string[] = [];
  if (!reference) status = 'unselected';
  else if (state.status !== 'ready') {
    status = 'pending_model';
    diagnosticCodes.push(...state.diagnostics.map((d) => d.code));
  } else if (evidence) {
    resolution = resolveSemanticTopologyReference(
      reference, evidence.snapshot, evidence.steps, doc.revision);
    status = resolution.status === 'resolved' || resolution.status === 'resolved_manual'
      ? 'candidate' : resolution.status;
    diagnosticCodes.push(...resolution.diagnostics.map((d) => d.code));
  } else {
    diagnosticCodes.push('EVIDENCE_REQUIRED');
  }
  return {
    format:'intuit3d.semantic-selection-assessment',version:1,
    projectId:doc.projectId,revision:doc.revision,featureId,field,
    status,resolution,diagnosticCodes,
  };
}

/**
 * User recovery is an explicit re-anchoring event, NOT a guessed continuation.
 * Require a complete, same-revision provider trace of the old source and
 * require the chosen role to be one of its actual ambiguous candidates.
 * Subsequent edits still require fresh evidence for the newly authored source.
 */
export function previewSemanticSelectionRecovery(
  source: ProjectDocument, request: SemanticSelectionRecoveryRequest,
): SemanticSelectionPreview {
  const doc = parseProject(source);
  if (!plain(request) || !exact(request, [
    'format','version','eventId','featureId','field','expectedRevision',
    'snapshot','steps','selected','admission',
  ]) || request.format !== SEMANTIC_SELECTION_RECOVERY_FORMAT ||
      request.version !== SEMANTIC_SELECTION_VERSION) {
    fail('unsupported semantic selection recovery');
  }
  checkField(request.field);
  if (doc.revision !== request.expectedRevision) {
    throw new ProjectRevisionError('stale semantic selection recovery');
  }
  const existing = currentReference(doc, request.featureId, request.field);
  if (!existing) fail('recovery requires a stored source reference');
  const resolution = resolveSemanticTopologyReference(
    existing, request.snapshot, request.steps, doc.revision);
  if (resolution.status !== 'requires_reconciliation' ||
      !resolution.candidates.some((c) => sameAnchor(c, request.selected))) {
    fail('selected role is not a verified ambiguous successor');
  }
  const corrected: SemanticTopologyReference = {
    format: existing.format, version: 1,
    projectId: existing.projectId, atRevision: doc.revision,
    anchor: request.selected,
  };
  return previewSemanticSelectionEdit(doc, {
    format: SEMANTIC_SELECTION_EDIT_FORMAT, version: 1,
    eventId: request.eventId, featureId: request.featureId, field: request.field,
    expectedRevision: request.expectedRevision, admission: request.admission,
    reference: corrected,
  });
}
export function commitUndoableSemanticSelectionRecovery(
  history: UndoHistory, request: SemanticSelectionRecoveryRequest,
): UndoHistory {
  const session = parseUndoHistory(history);
  const preview = previewSemanticSelectionRecovery(session.document, request);
  return commitUndoableTransaction(session, [preview.event], request.expectedRevision);
}
