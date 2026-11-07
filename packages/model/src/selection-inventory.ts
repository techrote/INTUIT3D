/**
 * @intuit3d/model/selection-inventory/v1
 *
 * Project-wide, revision-fenced view of authored body/face/edge references for
 * RUNTIME and WORKBENCH. It never converts provider hints into exact geometry.
 * No provider receipt, observation or provisional kernel role is persisted.
 */
import { featuresOf, parseProject, ProjectFormatError, ProjectRevisionError } from './index.ts';
import type { ProjectDocument } from './index.ts';
import { assessSemanticSelection } from './semantic-selection.ts';
import type { SemanticSelectionStatus } from './semantic-selection.ts';
import {
  TOPOLOGY_REFERENCE_FORMAT, parseSemanticTopologyReference,
  resolveSemanticTopologyReference,
} from './topology.ts';
import type {
  SemanticTopologyReference, TopologyAnchor, TopologySnapshot, TopologyStep,
} from './topology.ts';

export const SELECTION_INVENTORY_FORMAT = 'intuit3d.selection-inventory' as const;
export const SELECTION_INVENTORY_VERSION = 1 as const;
export const SELECTION_EVIDENCE_FORMAT = 'intuit3d.selection-evidence' as const;

/**
 * Model-adapter wrapper over existing v1 topology observations. A real provider
 * must supply independently observed roles; its name is only provenance text.
 * Deterministic fixtures must be labelled as such. There is NO exactness flag.
 */
export interface SelectionEvidenceReceipt {
  readonly format: typeof SELECTION_EVIDENCE_FORMAT;
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly featureId: string;
  readonly field: string;
  /** The exact authored source reference evaluated by this receipt. */
  readonly reference: SemanticTopologyReference;
  readonly provider: 'deterministic_fixture' | 'experimental_native' | 'native';
  readonly snapshot: TopologySnapshot;
  readonly steps: readonly TopologyStep[];
}

export type SelectionAction =
  'no_action' | 'await_provider' | 'repair_model' |
  'choose_successor' | 'replace_deleted_reference';
export interface SelectionInventoryRow {
  readonly featureId: string;
  readonly field: string;
  readonly reference: SemanticTopologyReference;
  readonly status: SemanticSelectionStatus;
  readonly action: SelectionAction;
  readonly observedProvider: SelectionEvidenceReceipt['provider'] | null;
  /** One reported semantic candidate, never a trusted kernel face identifier. */
  readonly provisionalTarget: TopologyAnchor | null;
  /** Present only when user choice can repair an observed split/merge. */
  readonly recoveryCandidates: readonly TopologyAnchor[];
  readonly diagnosticCodes: readonly string[];
  readonly lastObservedRevision: number | null;
}
export interface SelectionInventory {
  readonly format: typeof SELECTION_INVENTORY_FORMAT;
  readonly version: typeof SELECTION_INVENTORY_VERSION;
  readonly projectId: string;
  readonly revision: number;
  readonly selections: readonly SelectionInventoryRow[];
  readonly needsUserRecovery: readonly string[];
  readonly awaitingProvider: readonly string[];
  readonly awaitingModelRepair: readonly string[];
  readonly allReferencesObserved: boolean;
  /** Always false. Even a successful native report does NOT certify the B-rep. */
  readonly exactGeometryAuthority: false;
}

const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
function fail(reason: string): never { throw new ProjectFormatError('selection inventory: ' + reason); }
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key));
}
function sameReference(a: SemanticTopologyReference, b: SemanticTopologyReference): boolean {
  return a.format === b.format && a.version === b.version &&
    a.projectId === b.projectId && a.atRevision === b.atRevision &&
    a.anchor.featureId === b.anchor.featureId &&
    a.anchor.roleId === b.anchor.roleId && a.anchor.kind === b.anchor.kind;
}
function receiptKey(featureId: string, field: string): string {
  return featureId + '\u0000' + field;
}
function parseReceipt(raw: unknown, doc: ProjectDocument): SelectionEvidenceReceipt {
  if (!plain(raw) || !exactKeys(raw, [
    'format', 'version', 'projectId', 'revision', 'featureId', 'field',
    'reference', 'provider', 'snapshot', 'steps',
  ]) || raw.format !== SELECTION_EVIDENCE_FORMAT || raw.version !== 1 ||
    typeof raw.projectId !== 'string' || typeof raw.featureId !== 'string' ||
    typeof raw.field !== 'string' || !FIELD.test(raw.field) ||
    !['deterministic_fixture', 'experimental_native', 'native'].includes(String(raw.provider))) {
    fail('malformed or unsupported evidence receipt');
  }
  if (raw.projectId !== doc.projectId || raw.revision !== doc.revision) {
    throw new ProjectRevisionError('selection inventory: evidence project or revision is stale');
  }
  const ref = parseSemanticTopologyReference(raw.reference);
  // Validate the entire trace even if the consumer is currently pending.
  resolveSemanticTopologyReference(ref, raw.snapshot, raw.steps, doc.revision);
  return raw as unknown as SelectionEvidenceReceipt;
}

/**
 * Collect every model-authored semantic selection, including unresolved ones,
 * then correlate optional fresh provider receipts with the exact source anchor.
 * The selection inventory is a derived UI/runtime view, not a new journal.
 *
 * The returned allReferencesObserved flag means *reported semantic continuity*
 * only. No consumer may interpret it as B-rep/STEP admission.
 */
export function inspectSelectionInventory(
  source: ProjectDocument, rawEvidence: unknown = [],
): SelectionInventory {
  const doc = parseProject(source);
  if (!Array.isArray(rawEvidence) || rawEvidence.length > 4096) {
    fail('evidence must be a bounded array');
  }
  const receipts = new Map<string, SelectionEvidenceReceipt>();
  for (const raw of rawEvidence) {
    const receipt = parseReceipt(raw, doc);
    const key = receiptKey(receipt.featureId, receipt.field);
    if (receipts.has(key)) fail('duplicate provider receipt for ' + receipt.featureId + '.' + receipt.field);
    receipts.set(key, receipt);
  }

  const rows: SelectionInventoryRow[] = [];
  for (const feature of featuresOf(doc)) {
    for (const field of Object.keys(feature.payload).sort()) {
      const raw = feature.payload[field];
      if (!plain(raw) || raw.format !== TOPOLOGY_REFERENCE_FORMAT) continue;
      const reference = parseSemanticTopologyReference(raw);
      if (reference.projectId !== doc.projectId || reference.atRevision > doc.revision) {
        fail('cross-project or future authored reference ' + feature.id + '.' + field);
      }
      // A semantic *body* role is an application-owned write target. This
      // verifies the source feature actually authored that role, without
      // claiming that the physical kernel returned a single solid.
      if (reference.anchor.kind === 'body') {
        const atSource = parseProject({
          ...doc, revision: reference.atRevision,
          journal: doc.journal.slice(0, reference.atRevision),
        });
        const producer = featuresOf(atSource).find((f) => f.id === reference.anchor.featureId);
        if (producer && !producer.writeTargets.includes(reference.anchor.roleId)) {
          fail('body role not owned by source feature ' + feature.id + '.' + field);
        }
      }
      const key = receiptKey(feature.id, field);
      const receipt = receipts.get(key);
      if (receipt && !sameReference(receipt.reference, reference)) {
        throw new ProjectRevisionError('selection inventory: evidence refers to replaced selection');
      }
      receipts.delete(key);
      const assessment = assessSemanticSelection(doc, feature.id, field, receipt
        ? { snapshot: receipt.snapshot, steps: receipt.steps } : undefined);
      const resolution = assessment.resolution;
      const action: SelectionAction =
        assessment.status === 'candidate' ? 'no_action' :
        assessment.status === 'pending_model' ? 'repair_model' :
        assessment.status === 'requires_reconciliation' ? 'choose_successor' :
        assessment.status === 'deleted' ? 'replace_deleted_reference' : 'await_provider';
      rows.push({
        featureId: feature.id, field, reference, status: assessment.status,
        action, observedProvider: receipt?.provider ?? null,
        provisionalTarget: assessment.status === 'candidate'
          ? resolution?.candidates[0] ?? null : null,
        recoveryCandidates: assessment.status === 'requires_reconciliation'
          ? resolution?.candidates ?? [] : [],
        diagnosticCodes: assessment.diagnosticCodes,
        lastObservedRevision: resolution?.lastObservedRevision ?? null,
      });
    }
  }
  if (receipts.size) {
    fail('evidence supplied for nonexistent or removed authored selection');
  }
  const ids = (filter: (row: SelectionInventoryRow) => boolean) =>
    rows.filter(filter).map((row) => row.featureId + '.' + row.field);
  return {
    format: SELECTION_INVENTORY_FORMAT, version: SELECTION_INVENTORY_VERSION,
    projectId: doc.projectId, revision: doc.revision, selections: rows,
    needsUserRecovery: ids((row) => row.action === 'choose_successor' ||
      row.action === 'replace_deleted_reference'),
    awaitingProvider: ids((row) => row.action === 'await_provider'),
    awaitingModelRepair: ids((row) => row.action === 'repair_model'),
    allReferencesObserved: rows.length > 0 && rows.every((row) => row.status === 'candidate'),
    exactGeometryAuthority: false,
  };
}
