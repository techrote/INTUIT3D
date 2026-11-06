import type { Diagnostic, SketchDocument, SolveStatus } from './index.mjs';

export const CONFLICT_EXPLANATION_VERSION: 1;
/** Each limit is a strict computational budget; no partial witness is certified. */
export interface ConflictExplanationOptions {
  maxConstraints?: number;
  maxVariables?: number;
  maxSolves?: number;
}
export type ConflictExplanationStatus =
  | 'minimal_conflict' | 'no_conflict' | 'numerical_failure'
  | 'budget_exceeded' | 'unverified';
export type ConflictExplanationReason =
  | 'constraint_count' | 'variable_count' | 'solve_count'
  | 'source_numerical_failure' | 'subset_numerical_failure'
  | 'witness_numerical_failure' | 'verification_numerical_failure'
  | 'witness_not_conflicted' | 'witness_not_minimal' | null;
export interface ConflictExplanation {
  version: 1;
  /** Diagnostic only. Never rewrite or suppress authored constraints automatically. */
  previewOnly: true;
  inputSignature: string;
  status: ConflictExplanationStatus;
  sourceStatus: SolveStatus | null;
  /** Sorted irreducible conflicting IDs ONLY when status === minimal_conflict. */
  constraintIds: string[];
  minimal: boolean;
  sourceDiagnostics: Diagnostic[];
  witnessDiagnostics: Diagnostic[];
  solves: number;
  reason: ConflictExplanationReason;
}
export function explainLinearConflict(
  sketch: SketchDocument,
  options?: ConflictExplanationOptions
): ConflictExplanation;
