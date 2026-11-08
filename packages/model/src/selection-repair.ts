/**
 * @intuit3d/model/selection-repair/v1 — explicit, undoable CAD selection repair.
 *
 * A UI can repair several split/deleted face or edge references in ONE user
 * action. Old provider reports are only evidence for offering choices; fresh
 * observation is required for replacement of a deleted role. Neither provider
 * evidence nor any kernel face number enters the authoritative document.
 */
import {
  featuresOf, parseProject, serializeProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, ProjectDocument } from './index.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import { previewSemanticSelectionEdit, SEMANTIC_SELECTION_EDIT_FORMAT } from './semantic-selection.ts';
import { inspectSelectionInventory, SELECTION_EVIDENCE_FORMAT } from './selection-inventory.ts';
import type { SelectionEvidenceReceipt } from './selection-inventory.ts';
import {
  TOPOLOGY_REFERENCE_FORMAT, resolveSemanticTopologyReference,
} from './topology.ts';
import type {
  SemanticTopologyReference, TopologyAnchor, TopologySnapshot,
} from './topology.ts';
import { commitUndoableTransaction, parseUndoHistory } from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const SELECTION_REPAIR_FORMAT = 'intuit3d.selection-repair' as const;
export const SELECTION_REPAIR_VERSION = 1 as const;
export type SelectionRepairProvider = SelectionEvidenceReceipt['provider'];

export interface ReplacementObservation {
  /** Explicitly a provider observation, never a claim of validated exact B-rep. */
  readonly provider: SelectionRepairProvider;
  readonly snapshot: TopologySnapshot;
}
export interface SelectionRepairAction {
  readonly eventId: string;
  readonly featureId: string;
  readonly field: string;
  readonly selected: TopologyAnchor;
  /** Required only when the former target was deleted. */
  readonly replacementObservation?: ReplacementObservation;
}
export interface SelectionRepairRequest {
  readonly format: typeof SELECTION_REPAIR_FORMAT;
  readonly version: typeof SELECTION_REPAIR_VERSION;
  readonly expectedRevision: number;
  readonly admission: 'require_ready' | 'permit_pending';
  readonly repairs: readonly SelectionRepairAction[];
}
export interface SelectionRepairPreview {
  readonly format: 'intuit3d.selection-repair-preview';
  readonly version: 1;
  readonly document: ProjectDocument;
  readonly events: readonly JournalEvent[];
  readonly invalidation: IncrementalEvaluationPlan;
  readonly repaired: readonly {
    readonly featureId: string;
    readonly field: string;
    readonly previousStatus: 'requires_reconciliation' | 'deleted';
    readonly selected: TopologyAnchor;
  }[];
  /** A semantic repair is not geometric validation. */
  readonly exactGeometryAuthority: false;
}

function fail(reason: string): never {
  throw new ProjectFormatError('selection repair: ' + reason);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exact(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}
function sameAnchor(a: TopologyAnchor, b: TopologyAnchor): boolean {
  return a.featureId === b.featureId && a.roleId === b.roleId && a.kind === b.kind;
}
function validateAction(value: unknown): asserts value is SelectionRepairAction {
  if (!plain(value) || !Object.keys(value).every((key) => [
    'eventId', 'featureId', 'field', 'selected', 'replacementObservation',
  ].includes(key)) || !['eventId', 'featureId', 'field', 'selected']
    .every((key) => Object.hasOwn(value, key))) {
    fail('unsupported repair action');
  }
}
/**
 * Build a multi-selection repair from exact-revision inventory observations.
 * The before/after document and its partial invalidation are immediately
 * usable by RUNTIME and WORKBENCH. No repair is silently selected.
 *
 * Split: chosen role MUST be one of the provider-observed successors.
 * Deleted: require a separately observed CURRENT role and an active authoring
 * feature. For a body role, that feature must actually own the body write target.
 * These observations never certify geometry or STEP interchange.
 */
export function previewSelectionRepairBatch(
  source: ProjectDocument, request: SelectionRepairRequest,
  evidence: readonly SelectionEvidenceReceipt[],
): SelectionRepairPreview {
  const doc = parseProject(source);
  if (!plain(request) || !exact(request, [
    'format', 'version', 'expectedRevision', 'admission', 'repairs',
  ]) || request.format !== SELECTION_REPAIR_FORMAT ||
    request.version !== SELECTION_REPAIR_VERSION ||
    !['require_ready', 'permit_pending'].includes(String(request.admission)) ||
    !Array.isArray(request.repairs) || request.repairs.length < 1 ||
    request.repairs.length > 32) {
    fail('invalid request or repair count');
  }
  if (request.expectedRevision !== doc.revision) {
    throw new ProjectRevisionError('selection repair: stale document revision');
  }
  const inventory = inspectSelectionInventory(doc, evidence);
  const living = new Map(featuresOf(doc).map((feature) => [feature.id, feature]));
  const seen = new Set<string>();
  const events: JournalEvent[] = [];
  const repaired: SelectionRepairPreview['repaired'][number][] = [];
  let working = doc;

  for (const action of request.repairs) {
    validateAction(action);
    const entry = inventory.selections.find((row) =>
      row.featureId === action.featureId && row.field === action.field);
    if (!entry) fail('target is not an authored semantic selection');
    const key = action.featureId + '\u0000' + action.field;
    if (seen.has(key)) fail('same selection repaired twice');
    seen.add(key);
    const replacement = action.replacementObservation;
    if (entry.action === 'choose_successor') {
      if (replacement !== undefined) fail('split repair must use observed successors');
      if (!entry.recoveryCandidates.some((candidate) => sameAnchor(candidate, action.selected))) {
        fail('chosen successor is not in the complete split/merge report');
      }
    } else if (entry.action === 'replace_deleted_reference') {
      if (!plain(replacement) || !exact(replacement, ['provider', 'snapshot']) ||
        !['deterministic_fixture', 'experimental_native', 'native']
          .includes(String(replacement.provider))) {
        fail('deleted target requires a fresh, attributed replacement observation');
      }
      const producer = living.get(action.selected.featureId);
      if (!producer) fail('replacement producer is not an active feature');
      if (action.selected.kind === 'body' &&
          !producer.writeTargets.includes(action.selected.roleId)) {
        fail('replacement body is not a semantic write target of the producer');
      }
      const newReference: SemanticTopologyReference = {
        format: TOPOLOGY_REFERENCE_FORMAT, version: 1,
        projectId: doc.projectId, atRevision: doc.revision, anchor: action.selected,
      };
      // Validates project, revision, bounded roles and actual observation.
      const resolution = resolveSemanticTopologyReference(
        newReference, replacement.snapshot, [], doc.revision);
      if (resolution.status !== 'resolved') {
        fail('replacement has not been observed in the current revision');
      }
    } else {
      fail('only observed split/merge or deleted selections can be repaired');
    }

    const reference: SemanticTopologyReference = {
      format: TOPOLOGY_REFERENCE_FORMAT, version: 1,
      projectId: doc.projectId, atRevision: doc.revision, anchor: action.selected,
    };
    const preview = previewSemanticSelectionEdit(working, {
      format: SEMANTIC_SELECTION_EDIT_FORMAT, version: 1,
      eventId: action.eventId, featureId: action.featureId, field: action.field,
      expectedRevision: working.revision, admission: request.admission, reference,
    });
    working = preview.document;
    events.push(preview.event);
    repaired.push({
      featureId: action.featureId, field: action.field,
      previousStatus: entry.status as 'requires_reconciliation' | 'deleted',
      selected: action.selected,
    });
  }

  return {
    format: 'intuit3d.selection-repair-preview', version: 1,
    document: working, events, repaired,
    invalidation: planIncrementalEvaluation(doc, working),
    exactGeometryAuthority: false,
  };
}

/** Commit all chosen repairs as ONE undo frame, or none if any choice fails. */
export function commitUndoableSelectionRepairBatch(
  source: UndoHistory, request: SelectionRepairRequest,
  evidence: readonly SelectionEvidenceReceipt[],
): UndoHistory {
  const history = parseUndoHistory(source);
  const preview = previewSelectionRepairBatch(history.document, request, evidence);
  return commitUndoableTransaction(history, preview.events, request.expectedRevision);
}


/**
 * @intuit3d/model/selection-repair-fenced/v2
 *
 * User-selected split/deleted replacements are only valid for the canonical
 * document on which the provider made its observations. Revision numbers alone
 * are insufficient: undo/replay or diverging journal branches can produce
 * different solids at the SAME project ID and revision. This additive v2 entry
 * point rejects that ambiguity before delegating the unchanged v1 semantic
 * repair/undo engine. V1 remains available for existing consumers, but callers
 * requiring divergent-history protection must use v2 end to end.
 *
 * Fences are source identity assertions, not cryptographic provenance or
 * evidence that the native provider produced an exact physical B-rep.
 */
export const SELECTION_REPAIR_FENCED_FORMAT =
  'intuit3d.selection-repair-fenced' as const;
export const SELECTION_EVIDENCE_FENCED_FORMAT =
  'intuit3d.selection-evidence-fenced' as const;
export const SELECTION_REPAIR_FENCED_VERSION = 2 as const;

export interface FencedSelectionEvidenceReceipt
  extends Omit<SelectionEvidenceReceipt, 'format' | 'version'> {
  readonly format: typeof SELECTION_EVIDENCE_FENCED_FORMAT;
  readonly version: typeof SELECTION_REPAIR_FENCED_VERSION;
  /** Canonical model document observed, not merely its revision number. */
  readonly documentFence: string;
}
export interface FencedReplacementObservation extends ReplacementObservation {
  /** Must match the same current document as the split/merge receipts. */
  readonly documentFence: string;
}
export interface FencedSelectionRepairAction
  extends Omit<SelectionRepairAction, 'replacementObservation'> {
  readonly replacementObservation?: FencedReplacementObservation;
}
export interface FencedSelectionRepairRequest
  extends Omit<SelectionRepairRequest, 'format' | 'version' | 'repairs'> {
  readonly format: typeof SELECTION_REPAIR_FENCED_FORMAT;
  readonly version: typeof SELECTION_REPAIR_FENCED_VERSION;
  readonly expectedProjectId: string;
  readonly expectedDocumentFence: string;
  readonly repairs: readonly FencedSelectionRepairAction[];
}
export interface FencedSelectionRepairPreview
  extends Omit<SelectionRepairPreview, 'format' | 'version'> {
  readonly format: 'intuit3d.selection-repair-fenced-preview';
  readonly version: 2;
  readonly sourceProjectId: string;
  readonly sourceRevision: number;
  readonly sourceDocumentFence: string;
  readonly requiresNativeRebuild: true;
}

/** Fail closed before applying ANY candidate, including a deleted-role observation. */
export function previewFencedSelectionRepairBatch(
  source: ProjectDocument, request: FencedSelectionRepairRequest,
  evidence: readonly FencedSelectionEvidenceReceipt[],
): FencedSelectionRepairPreview {
  const doc = parseProject(source);
  if (!plain(request) || !exact(request, [
    'format', 'version', 'expectedProjectId', 'expectedRevision',
    'expectedDocumentFence', 'admission', 'repairs',
  ]) || request.format !== SELECTION_REPAIR_FENCED_FORMAT ||
    request.version !== SELECTION_REPAIR_FENCED_VERSION ||
    !Array.isArray(request.repairs) ||
    request.repairs.length < 1 || request.repairs.length > 32) {
    fail('unsupported source-fenced selection repair request');
  }
  const canonical = serializeProject(doc);
  if (request.expectedProjectId !== doc.projectId ||
      request.expectedRevision !== doc.revision ||
      request.expectedDocumentFence !== canonical) {
    throw new ProjectRevisionError(
      'selection repair: project, revision or canonical document fence differs');
  }
  if (!Array.isArray(evidence) || evidence.length > 4096) {
    fail('source-fenced evidence must be a bounded array');
  }
  const legacyEvidence: SelectionEvidenceReceipt[] = evidence.map((receipt) => {
    if (!plain(receipt) || !exact(receipt, [
      'format', 'version', 'documentFence', 'projectId', 'revision',
      'featureId', 'field', 'reference', 'provider', 'snapshot', 'steps',
    ]) || receipt.format !== SELECTION_EVIDENCE_FENCED_FORMAT ||
        receipt.version !== SELECTION_REPAIR_FENCED_VERSION) {
      fail('unsupported source-fenced provider receipt');
    }
    if (receipt.documentFence !== canonical) {
      throw new ProjectRevisionError(
        'selection repair: provider receipt belongs to another document');
    }
    // The runtime structural guard above narrows keys to unknown values.
    // Recover the declared v2 type only after exact-key/format/fence checks;
    // the v1 inventory still validates every value and entire topology trace.
    const verified = receipt as FencedSelectionEvidenceReceipt;
    return {
      format: SELECTION_EVIDENCE_FORMAT, version: 1 as const,
      projectId: verified.projectId, revision: verified.revision,
      featureId: verified.featureId, field: verified.field,
      reference: verified.reference, provider: verified.provider,
      snapshot: verified.snapshot, steps: verified.steps,
    };
  });
  const legacyRepairs: SelectionRepairAction[] = request.repairs.map((action) => {
    validateAction(action);
    let replacementObservation: ReplacementObservation | undefined;
    if (action.replacementObservation !== undefined) {
      const observed = action.replacementObservation;
      if (!plain(observed) || !exact(observed, [
        'provider', 'snapshot', 'documentFence',
      ])) {
        fail('unsupported source-fenced replacement observation');
      }
      if (observed.documentFence !== canonical) {
        throw new ProjectRevisionError(
          'selection repair: replacement observed on another document');
      }
      const checked = observed as FencedReplacementObservation;
      replacementObservation = {
        provider: checked.provider, snapshot: checked.snapshot,
      };
    }
    return {
      eventId: action.eventId, featureId: action.featureId,
      field: action.field, selected: action.selected,
      ...(replacementObservation === undefined ? {} : { replacementObservation }),
    };
  });
  const preview = previewSelectionRepairBatch(doc, {
    format: SELECTION_REPAIR_FORMAT, version: SELECTION_REPAIR_VERSION,
    expectedRevision: request.expectedRevision,
    admission: request.admission, repairs: legacyRepairs,
  }, legacyEvidence);
  return {
    ...preview,
    format: 'intuit3d.selection-repair-fenced-preview', version: 2,
    sourceProjectId: doc.projectId, sourceRevision: doc.revision,
    sourceDocumentFence: canonical, requiresNativeRebuild: true,
    exactGeometryAuthority: false,
  };
}

/** Identical all-or-none persisted undo semantics; every receipt is fenced. */
export function commitUndoableFencedSelectionRepairBatch(
  source: UndoHistory, request: FencedSelectionRepairRequest,
  evidence: readonly FencedSelectionEvidenceReceipt[],
): UndoHistory {
  const history = parseUndoHistory(source);
  const preview = previewFencedSelectionRepairBatch(
    history.document, request, evidence);
  return commitUndoableTransaction(
    history, preview.events, request.expectedRevision);
}
