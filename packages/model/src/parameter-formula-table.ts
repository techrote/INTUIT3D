/**
 * @intuit3d/model/parameter-formula-table/v1
 *
 * Spreadsheet-style CAD parameter edits: rename and/or edit human formulas
 * across several rows as ONE undoable, revision-fenced journal transaction.
 * Expressions are parsed against the FINAL display-name namespace, then
 * permanently bound to stable parameter feature IDs. No browser-side AST,
 * JavaScript evaluation, physical geometry or STEP authority is introduced.
 */
import {
  featuresOf, parseProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { ProjectDocument, JournalEvent } from './index.ts';
import type { ParameterExpression } from './parameters.ts';
import {
  parseParameterFormula,
} from './parameter-formula.ts';
import {
  MAX_PARAMETER_TABLE_EDITS, PARAMETER_TABLE_FORMAT,
  previewParameterTableEdit,
} from './parameter-table.ts';
import type { ParameterTableEdit, ParameterTablePreview } from './parameter-table.ts';
import {
  commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const PARAMETER_FORMULA_TABLE_FORMAT = 'intuit3d.parameter-formula-table-edit' as const;
export const PARAMETER_FORMULA_TABLE_VERSION = 1 as const;

export interface ParameterFormulaTableRow {
  readonly eventId: string;
  readonly featureId: string;
  /** Final visible name. Omit to retain the existing name. */
  readonly name?: string;
  /** Human-authored formula; omit to retain the existing AST. */
  readonly formula?: string;
}
export interface ParameterFormulaTableRequest {
  readonly format: typeof PARAMETER_FORMULA_TABLE_FORMAT;
  readonly version: typeof PARAMETER_FORMULA_TABLE_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly admission: 'require_admissible' | 'permit_unresolved';
  readonly rows: readonly ParameterFormulaTableRow[];
}
export interface ParameterFormulaTablePreview {
  readonly format: 'intuit3d.parameter-formula-table-preview';
  readonly version: 1;
  readonly document: ProjectDocument;
  readonly events: readonly JournalEvent[];
  /** Current binding and dependency gates from the FINAL table only. */
  readonly evaluation: ParameterTablePreview['evaluation'];
  readonly invalidation: ParameterTablePreview['invalidation'];
  readonly renamedParameterIds: readonly string[];
  readonly expressionChangedParameterIds: readonly string[];
  /** Exact references resolved from text, not from historical extra edges. */
  readonly formulaReferences: readonly {
    readonly featureId: string;
    readonly referencedParameterIds: readonly string[];
  }[];
  readonly exactGeometryAuthority: false;
}
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(message: string): never {
  throw new ProjectFormatError('parameter formula table: ' + message);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function keys(obj: Record<string, unknown>, required: readonly string[], allowed = required): boolean {
  return required.every((key) => Object.hasOwn(obj, key)) &&
    Object.keys(obj).every((key) => allowed.includes(key));
}
function refs(expression: ParameterExpression): string[] {
  const found = new Set<string>();
  const walk = (node: ParameterExpression): void => {
    if (node.op === 'ref') found.add(node.featureId);
    else if (node.op === 'negate') walk(node.operand);
    else if (node.op !== 'literal') { walk(node.left); walk(node.right); }
  };
  walk(expression);
  return [...found];
}

/**
 * A multi-row rename never exposes intermediate label collisions. For example,
 * the user can swap "width" and "height" while editing formulas that mention
 * the FINAL names. The temporary renamed document is private; only the
 * single final parameter-table preview and its original-source journal events
 * can ever be committed to the authoritative project.
 *
 * This intentionally does not interpret old names after a rename. A formula
 * referencing an obsolete name is refused, not silently rebound to another
 * parameter. Retained preexisting ASTs continue using durable feature IDs.
 */
export function previewParameterFormulaTableEdit(
  source: ProjectDocument, request: ParameterFormulaTableRequest,
): ParameterFormulaTablePreview {
  const original = parseProject(source);
  if (!plain(request) || !keys(request, [
    'format','version','expectedProjectId','expectedRevision','admission','rows',
  ]) || request.format !== PARAMETER_FORMULA_TABLE_FORMAT ||
      request.version !== PARAMETER_FORMULA_TABLE_VERSION ||
      (request.admission !== 'require_admissible' &&
       request.admission !== 'permit_unresolved')) {
    fail('unsupported edit request');
  }
  if (request.expectedProjectId !== original.projectId ||
      request.expectedRevision !== original.revision) {
    throw new ProjectRevisionError('parameter formula table: stale project/revision');
  }
  if (!Array.isArray(request.rows) || request.rows.length < 1 ||
      request.rows.length > MAX_PARAMETER_TABLE_EDITS) {
    fail('requires 1-' + MAX_PARAMETER_TABLE_EDITS + ' edited rows');
  }
  const active = new Map(featuresOf(original).filter((f) => f.kind === 'parameter')
    .map((feature) => [feature.id, feature] as const));
  const seenFeatureIds = new Set<string>();
  const seenEventIds = new Set<string>();
  const finalRows: { row: ParameterFormulaTableRow; name: string }[] = [];
  const renameOnly: ParameterTableEdit[] = [];
  for (const row of request.rows) {
    if (!plain(row) || !keys(row, ['eventId','featureId'],
        ['eventId','featureId','name','formula']) ||
        !('name' in row || 'formula' in row) ||
        typeof row.eventId !== 'string' || !ID.test(row.eventId) ||
        typeof row.featureId !== 'string' || !ID.test(row.featureId) ||
        ('name' in row && typeof row.name !== 'string') ||
        ('formula' in row && typeof row.formula !== 'string')) {
      fail('malformed parameter row');
    }
    if (seenFeatureIds.has(row.featureId) || seenEventIds.has(row.eventId)) {
      fail('duplicate parameter feature or event ID');
    }
    seenFeatureIds.add(row.featureId);
    seenEventIds.add(row.eventId);
    const target = active.get(row.featureId);
    const payload = target?.payload.parameter;
    if (!target || !plain(payload) || typeof payload.name !== 'string') {
      fail('row must refer to a living named parameter: ' + row.featureId);
    }
    const finalName = row.name ?? payload.name;
    finalRows.push({ row, name: finalName });
    if (finalName !== payload.name) {
      renameOnly.push({ eventId: row.eventId, featureId: row.featureId,
        name: finalName });
    }
  }

  // Resolve every typed formula against the proposed FINAL parameter names.
  // This stage never leaves the function and cannot modify the caller.
  const renamed = renameOnly.length
    ? previewParameterTableEdit(original, {
      format: PARAMETER_TABLE_FORMAT, version: 1,
      expectedProjectId: original.projectId, expectedRevision: original.revision,
      admission: 'permit_unresolved', edits: renameOnly,
    }).document
    : original;
  const edits: ParameterTableEdit[] = [];
  const formulaReferences: { featureId: string; referencedParameterIds: string[] }[] = [];
  for (const { row, name } of finalRows) {
    if (row.formula !== undefined) {
      const expression = parseParameterFormula(renamed, row.featureId, row.formula);
      edits.push({ eventId: row.eventId, featureId: row.featureId, name, expression });
      formulaReferences.push({ featureId: row.featureId,
        referencedParameterIds: refs(expression) });
    } else {
      edits.push({ eventId: row.eventId, featureId: row.featureId, name });
    }
  }
  const preview = previewParameterTableEdit(original, {
    format: PARAMETER_TABLE_FORMAT, version: 1,
    expectedProjectId: request.expectedProjectId,
    expectedRevision: request.expectedRevision,
    admission: request.admission,
    edits,
  });
  return {
    format: 'intuit3d.parameter-formula-table-preview', version: 1,
    document: preview.document, events: preview.events,
    evaluation: preview.evaluation, invalidation: preview.invalidation,
    renamedParameterIds: preview.renamedParameterIds,
    expressionChangedParameterIds: preview.expressionChangedParameterIds,
    formulaReferences, exactGeometryAuthority: false,
  };
}

/** Commit all text edits in one reversible journal frame; no partial rows. */
export function commitUndoableParameterFormulaTableEdit(
  source: UndoHistory, request: ParameterFormulaTableRequest,
): UndoHistory {
  const session = parseUndoHistory(source);
  const preview = previewParameterFormulaTableEdit(session.document, request);
  return commitUndoableTransaction(session, preview.events, request.expectedRevision);
}
