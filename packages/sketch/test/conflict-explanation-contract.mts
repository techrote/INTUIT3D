import { plateSketchFixture } from '../index.mjs';
import {
  CONFLICT_EXPLANATION_VERSION, explainLinearConflict
} from '../conflict-explanation.mjs';
import type {
  ConflictExplanation, ConflictExplanationStatus,
  ConflictExplanationReason, ConflictExplanationOptions
} from '../conflict-explanation.mjs';

const version: 1 = CONFLICT_EXPLANATION_VERSION;
const opts: ConflictExplanationOptions = { maxConstraints:64, maxVariables:192, maxSolves:192 };
const report: ConflictExplanation = explainLinearConflict(plateSketchFixture(), opts);
const status: ConflictExplanationStatus = report.status;
const reason: ConflictExplanationReason = report.reason;
const stamp: string = report.inputSignature;
const diagnosticOnly: true = report.previewOnly;
const IDs: string[] = report.constraintIds;
void [version, status, reason, stamp, diagnosticOnly, IDs];
