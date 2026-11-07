/**
 * @intuit3d/model/selection-repair/v1 — explicit, undoable CAD selection repair.
 *
 * A UI can repair several split/deleted face or edge references in ONE user
 * action. Old provider reports are only evidence for offering choices; fresh
 * observation is required for replacement of a deleted role. Neither provider
 * evidence nor any kernel face number enters the authoritative document.
 */
import {
  featuresOf, parseProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { JournalEvent, ProjectDocument } from './index.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import { previewSemanticSelectionEdit, SEMANTIC_SELECTION_EDIT_FORMAT } from './semantic-selection.ts';
import { inspectSelectionInventory } from './selection-inventory.ts';
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
