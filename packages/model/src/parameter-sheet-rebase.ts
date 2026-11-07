/**
 * @intuit3d/model/parameter-sheet-rebase/v1
 *
 * Conservative, read-only three-way reconciliation for a stale CAD parameter
 * spreadsheet. A user may keep an unsaved draft while another authoritative
 * transaction is committed. This contract never overwrites a touched row,
 * changes a formula binding, or silently merges divergent journals.
 *
 * A 'ready' result is a *proposal*, not an automatic commit. The caller must
 * still commit its returned request against the CURRENT undo-history revision.
 * Scalar admissibility and structural invalidation never attest native B-rep,
 * provider execution or STEP exactness.
 */
import {
  featuresOf, parseProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { Feature, ProjectDocument } from './index.ts';
import {
  previewParameterFormulaTableEdit,
} from './parameter-formula-table.ts';
import type {
  ParameterFormulaTableRequest, ParameterFormulaTablePreview,
} from './parameter-formula-table.ts';

export const PARAMETER_SHEET_REBASE_FORMAT = 'intuit3d.parameter-sheet-rebase' as const;
export const PARAMETER_SHEET_REBASE_VERSION = 1 as const;

export type ParameterSheetRebaseConflictCode =
  | 'edited_row_changed'
  | 'referenced_parameter_changed'
  | 'event_id_taken'
  | 'formula_binding_changed'
  | 'candidate_rejected';

export interface ParameterSheetRebaseConflict {
  readonly code: ParameterSheetRebaseConflictCode;
  /** The edited parameter ID when identifiable, else null for a global conflict. */
  readonly featureId: string | null;
  /** Stable semantic reference or duplicated event ID, if applicable. */
  readonly relatedId: string | null;
  readonly detail: string;
}

export interface ParameterSheetRebaseResult {
  readonly format: typeof PARAMETER_SHEET_REBASE_FORMAT;
  readonly version: typeof PARAMETER_SHEET_REBASE_VERSION;
  readonly status: 'ready' | 'conflicted';
  readonly projectId: string;
  readonly baseRevision: number;
  readonly currentRevision: number;
  /** Null on ANY conflict. The original draft remains unmodified. */
  readonly rebasedRequest: ParameterFormulaTableRequest | null;
  /** Null on conflict. A speculative, non-authoritative document otherwise. */
  readonly preview: ParameterFormulaTablePreview | null;
  readonly conflicts: readonly ParameterSheetRebaseConflict[];
  readonly exactGeometryAuthority: false;
}

function same(a: unknown, b: unknown): boolean {
  // parseProject has already canonicalized and validated both journals.
  // Conservatively regard changed JSON member order as needing reconciliation.
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPrefix(base: ProjectDocument, current: ProjectDocument): boolean {
  if (base.revision > current.revision) return false;
  for (let i = 0; i < base.revision; i++) {
    if (!same(base.journal[i], current.journal[i])) return false;
  }
  return true;
}

function featureMap(doc: ProjectDocument): Map<string, Feature> {
  return new Map(featuresOf(doc).map((feature) => [feature.id, feature] as const));
}

/**
 * Extract semantic parameter IDs only, not text names. Use the already parsed
 * original formula for new text; keep old explicit feature dependencies too.
 * A bounded traversal avoids turning attacker-controlled archive payloads into
 * unbounded inspector work. A malformed existing AST is not "fixed" here.
 */
function referencedIds(value: unknown): string[] {
  const ids = new Set<string>();
  const stack: unknown[] = [value];
  let visits = 0;
  while (stack.length) {
    if (++visits > 4096) {
      throw new ProjectFormatError('parameter sheet rebase: expression exceeds inspection bound');
    }
    const node = stack.pop();
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const item = node as Record<string, unknown>;
    if (item.op === 'ref' && typeof item.featureId === 'string') {
      ids.add(item.featureId);
    } else if (item.op === 'negate') {
      stack.push(item.operand);
    } else if (item.op === 'add' || item.op === 'subtract' ||
               item.op === 'multiply' || item.op === 'divide') {
      stack.push(item.left, item.right);
    }
  }
  return [...ids];
}

function authoredParameterRefs(feature: Feature | undefined): string[] {
  if (!feature) return [];
  const found = new Set(feature.dependsOn);
  const metadata = feature.payload.parameter;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    for (const id of referencedIds((metadata as Record<string, unknown>).expression)) {
      found.add(id);
    }
  }
  return [...found];
}

/**
 * Rebase an edit produced from `base` onto `current` if AND ONLY IF:
 * - both canonical journals share an exact append-only prefix;
 * - all edited rows and every referenced parameter retain their authored state;
 * - fresh event IDs remain unused;
 * - final-name formula references still bind to exactly the same semantic IDs;
 * - the whole candidate passes the CURRENT final dependency/dimension gates.
 *
 * Independent changes (e.g. another sketch/body or unrelated named parameter)
 * can be retained without erasing a user's draft. Changed rows or ambiguous
 * rebinding produce explicit conflicts for the UI to present to the author.
 * The result never mutates either input. On a subsequent race the ordinary
 * revision-fenced commit must reject stale admission.
 */
export function rebaseParameterSheetEdit(
  baseInput: ProjectDocument,
  currentInput: ProjectDocument,
  draft: ParameterFormulaTableRequest,
  expectedCurrentRevision: number,
): ParameterSheetRebaseResult {
  const base = parseProject(baseInput);
  const current = parseProject(currentInput);
  if (current.revision !== expectedCurrentRevision) {
    throw new ProjectRevisionError('parameter sheet rebase: stale current revision');
  }
  if (base.projectId !== current.projectId || !isPrefix(base, current)) {
    throw new ProjectRevisionError(
      'parameter sheet rebase: different project or divergent journal; explicit recovery required',
    );
  }
  // Fully validate the draft against its ACTUAL authoring revision first. A
  // malformed or already stale request is not rescued by rebasing.
  const baseline = previewParameterFormulaTableEdit(base, draft);
  const before = featureMap(base);
  const now = featureMap(current);
  const conflicts: ParameterSheetRebaseConflict[] = [];
  const add = (
    code: ParameterSheetRebaseConflictCode, featureId: string | null,
    relatedId: string | null, detail: string,
  ) => conflicts.push({ code, featureId, relatedId, detail });

  const drafted = new Set(draft.rows.map((row) => row.featureId));
  for (const row of draft.rows) {
    if (!same(before.get(row.featureId), now.get(row.featureId))) {
      add('edited_row_changed', row.featureId, null,
        'The authored parameter row was edited or removed after the draft began.');
    }
  }

  const formulaRefs = new Map(baseline.formulaReferences.map((entry) =>
    [entry.featureId, entry.referencedParameterIds] as const));
  const referencePairs = new Set<string>();
  for (const row of draft.rows) {
    const originalRefs = authoredParameterRefs(before.get(row.featureId));
    for (const refId of [...originalRefs, ...(formulaRefs.get(row.featureId) ?? [])]) {
      // A changed row in the SAME draft is covered by the candidate's atomic
      // final-name admission; only external post-base changes are conflicts.
      if (drafted.has(refId)) continue;
      if (before.get(refId)?.kind !== 'parameter') continue;
      const key = row.featureId + '\u0000' + refId;
      if (referencePairs.has(key)) continue;
      referencePairs.add(key);
      if (!same(before.get(refId), now.get(refId))) {
        add('referenced_parameter_changed', row.featureId, refId,
          'A referenced semantic parameter was edited or removed since the draft.');
      }
    }
  }
  const used = new Set(current.journal.map((event) => event.eventId));
  for (const row of draft.rows) {
    if (used.has(row.eventId)) {
      add('event_id_taken', row.featureId, row.eventId,
        'The draft event ID is already present in the current journal.');
    }
  }
  const result = (
    request: ParameterFormulaTableRequest | null,
    preview: ParameterFormulaTablePreview | null,
  ): ParameterSheetRebaseResult => ({
    format: PARAMETER_SHEET_REBASE_FORMAT,
    version: PARAMETER_SHEET_REBASE_VERSION,
    status: conflicts.length ? 'conflicted' : 'ready',
    projectId: current.projectId,
    baseRevision: base.revision,
    currentRevision: current.revision,
    rebasedRequest: request, preview, conflicts,
    exactGeometryAuthority: false,
  });
  if (conflicts.length) return result(null, null);

  const rebased: ParameterFormulaTableRequest = {
    ...draft, expectedRevision: current.revision,
  };
  let candidate: ParameterFormulaTablePreview;
  try {
    candidate = previewParameterFormulaTableEdit(current, rebased);
  } catch (error) {
    if (!(error instanceof ProjectFormatError ||
          error instanceof ProjectRevisionError)) throw error;
    add('candidate_rejected', null, null,
      'Current final-state admission rejected the rebased draft: ' + error.message);
    return result(null, null);
  }
  for (const row of draft.rows) {
    const prior = formulaRefs.get(row.featureId) ?? [];
    const next = candidate.formulaReferences.find((entry) =>
      entry.featureId === row.featureId)?.referencedParameterIds ?? [];
    if (!same(prior, next)) {
      add('formula_binding_changed', row.featureId, null,
        'A formula would resolve to different semantic parameter IDs in the current names.');
    }
  }
  return conflicts.length ? result(null, null) : result(rebased, candidate);
}
