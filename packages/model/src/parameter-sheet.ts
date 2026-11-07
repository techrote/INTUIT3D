/**
 * @intuit3d/model/parameter-sheet/v1
 *
 * Revision-fenced, READ-ONLY parameter-table view for a real CAD inspector.
 * One authoritative model owns labels, expressions, dependencies and values.
 * Missing/invalid expressions remain visible and recoverable rather than being
 * replaced with a guessed numeric input. No browser-owned parameter database.
 */
import { parseProject, planProject, ProjectFormatError, ProjectRevisionError } from './index.ts';
import type { ProjectDocument, FeatureStatus } from './index.ts';
import { evaluateParameterPlan } from './parameters.ts';
import type { ParameterUnit, ParameterExpression } from './parameters.ts';
import { formatParameterFormula } from './parameter-formula.ts';
import { evaluateDimensionBindingPlan } from './dimension-bindings.ts';
import type { DimensionGateStatus } from './dimension-bindings.ts';
import { previewParameterFormulaTableEdit } from './parameter-formula-table.ts';
import type { ParameterFormulaTableRequest, ParameterFormulaTablePreview } from './parameter-formula-table.ts';

export const PARAMETER_SHEET_FORMAT = 'intuit3d.parameter-sheet' as const;
export const PARAMETER_SHEET_VERSION = 1 as const;

export interface ParameterSheetRequest {
  readonly format: typeof PARAMETER_SHEET_FORMAT;
  readonly version: typeof PARAMETER_SHEET_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
}
export interface ParameterSheetRow {
  readonly featureId: string;
  /** Null for invalid preexisting parameter metadata, which remains authored. */
  readonly name: string | null;
  readonly unit: ParameterUnit | null;
  /** Null means the authored AST cannot currently be rendered by the v1 grammar. */
  readonly formulaText: string | null;
  readonly formulaIssue: string | null;
  /** Original JSON expression, never a computed substitute or browser authority. */
  readonly authoredExpression: unknown;
  readonly value: number | null;
  readonly modelStatus: FeatureStatus;
  readonly dimensionStatus: DimensionGateStatus;
  readonly diagnosticCodes: readonly string[];
  /** Semantic direct dependents, including model features with dimension bindings. */
  readonly directConsumerFeatureIds: readonly string[];
  /** Entire semantic dependent closure, including affected bodies/cuts. */
  readonly affectedFeatureIds: readonly string[];
  readonly requiresUserAttention: boolean;
}
export interface ParameterSheet {
  readonly format: typeof PARAMETER_SHEET_FORMAT;
  readonly version: typeof PARAMETER_SHEET_VERSION;
  readonly projectId: string;
  readonly revision: number;
  readonly rows: readonly ParameterSheetRow[];
  readonly needsUserAttention: readonly string[];
  /** Model scalar values are not a native solid or STEP acceptance. */
  readonly exactGeometryAuthority: false;
}
export interface ParameterSheetEditPreview {
  readonly format: 'intuit3d.parameter-sheet-edit-preview';
  readonly version: 1;
  readonly before: ParameterSheet;
  readonly after: ParameterSheet;
  readonly changedParameterIds: readonly string[];
  readonly invalidatedFeatureIds: readonly string[];
  readonly unaffectedReadyFeatureIds: readonly string[];
  readonly authoredEvents: ParameterFormulaTablePreview['events'];
  readonly exactGeometryAuthority: false;
}
function plain(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
function check(source: ProjectDocument, input: ParameterSheetRequest): void {
  if (!plain(input) || Object.keys(input).length !== 4 ||
      !['format', 'version', 'expectedProjectId', 'expectedRevision']
        .every((key) => Object.hasOwn(input, key)) ||
      input.format !== PARAMETER_SHEET_FORMAT ||
      input.version !== PARAMETER_SHEET_VERSION) {
    throw new ProjectFormatError('parameter sheet: unsupported request');
  }
  if (input.expectedProjectId !== source.projectId ||
      input.expectedRevision !== source.revision) {
    throw new ProjectRevisionError('parameter sheet: stale project/revision');
  }
}
export function parameterSheetRequest(source: ProjectDocument): ParameterSheetRequest {
  const doc = parseProject(source);
  return {
    format: PARAMETER_SHEET_FORMAT, version: PARAMETER_SHEET_VERSION,
    expectedProjectId: doc.projectId, expectedRevision: doc.revision,
  };
}

/** Return derived rows in stable authored order, with no journal mutation. */
export function inspectParameterSheet(
  source: ProjectDocument, request: ParameterSheetRequest,
): ParameterSheet {
  const doc = parseProject(source);
  check(doc, request);
  const plan = planProject(doc);
  const dimensions = evaluateDimensionBindingPlan(plan);
  const scalar = evaluateParameterPlan(plan);
  const gates = new Map(dimensions.featureGates.map((row) =>
    [row.featureId, row] as const));
  const parameterGates = new Map(scalar.featureGates.map((row) =>
    [row.featureId, row] as const));
  const values = new Map(scalar.parameterValues.map((row) =>
    [row.featureId, row] as const));
  const order = new Map(plan.features.map((row, i) =>
    [row.feature.id, i] as const));
  const children = new Map<string, Set<string>>();
  for (const { feature } of plan.features) {
    for (const upstream of feature.dependsOn) {
      const next = children.get(upstream) ?? new Set<string>();
      next.add(feature.id);
      children.set(upstream, next);
    }
  }
  const ordered = (ids: Iterable<string>): string[] =>
    [...ids].sort((a, b) => (order.get(a) ?? Infinity) -
      (order.get(b) ?? Infinity));
  const descendants = (id: string): string[] => {
    const found = new Set<string>();
    const queue = [...(children.get(id) ?? [])];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]!;
      if (current === id || found.has(current)) continue;
      found.add(current);
      queue.push(...(children.get(current) ?? []));
    }
    return ordered(found);
  };
  const rows: ParameterSheetRow[] = plan.features
    .filter(({ feature }) => feature.kind === 'parameter')
    .map(({ feature, status, diagnostics }) => {
      const metadata = plain(feature.payload.parameter)
        ? feature.payload.parameter : null;
      const name = typeof metadata?.name === 'string' ? metadata.name : null;
      const unit = metadata?.unit === 'mm' || metadata?.unit === 'deg' ||
        metadata?.unit === 'unitless' ? metadata.unit : null;
      const authoredExpression = metadata?.expression ?? null;
      let formulaText: string | null = null;
      let formulaIssue: string | null = null;
      try {
        if (authoredExpression === null) {
          throw new ProjectFormatError('missing authored expression');
        }
        formulaText = formatParameterFormula(doc, feature.id,
          authoredExpression as ParameterExpression);
      } catch (error) {
        if (!(error instanceof ProjectFormatError)) throw error;
        formulaIssue = error.message;
      }
      const gate = gates.get(feature.id);
      const scalarGate = parameterGates.get(feature.id);
      const dimensionStatus = gate?.status ?? 'unready';
      const value = values.get(feature.id)?.value ?? null;
      const diagnosticCodes = [
        ...diagnostics.map((item) => item.code),
        ...(scalarGate?.diagnostics.map((item) => item.code) ?? []),
        ...(gate?.diagnostics.map((item) => item.code) ?? []),
      ];
      const requiresUserAttention = formulaIssue !== null ||
        !['admissible', 'bound'].includes(dimensionStatus) || value === null;
      return {
        featureId: feature.id, name, unit, formulaText, formulaIssue,
        authoredExpression, value, modelStatus: status, dimensionStatus,
        diagnosticCodes: [...new Set(diagnosticCodes)],
        directConsumerFeatureIds: ordered(children.get(feature.id) ?? []),
        affectedFeatureIds: descendants(feature.id), requiresUserAttention,
      };
    });
  return {
    format: PARAMETER_SHEET_FORMAT, version: PARAMETER_SHEET_VERSION,
    projectId: doc.projectId, revision: doc.revision, rows,
    needsUserAttention: rows.filter((row) => row.requiresUserAttention)
      .map((row) => row.featureId),
    exactGeometryAuthority: false,
  };
}

/** One consumer command can display the proposed final rows and rebuild frontier
 * before handing the exact same request to commitUndoableParameterFormulaTableEdit.
 * Returned rows are a preview, never an independently accepted geometry result.
 */
export function previewParameterSheetEdit(
  source: ProjectDocument, request: ParameterFormulaTableRequest,
): ParameterSheetEditPreview {
  const doc = parseProject(source);
  const preview = previewParameterFormulaTableEdit(doc, request);
  const before = inspectParameterSheet(doc, parameterSheetRequest(doc));
  const after = inspectParameterSheet(preview.document,
    parameterSheetRequest(preview.document));
  return {
    format: 'intuit3d.parameter-sheet-edit-preview', version: 1,
    before, after, changedParameterIds: request.rows.map((row) => row.featureId),
    invalidatedFeatureIds: preview.invalidation.invalidatedFeatureIds,
    unaffectedReadyFeatureIds: preview.invalidation.unchangedReady,
    authoredEvents: preview.events, exactGeometryAuthority: false,
  };
}
