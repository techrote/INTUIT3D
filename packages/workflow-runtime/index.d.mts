import type {ProjectDocument, EvaluationPlan, JournalEvent} from '@intuit3d/model';
import type {UndoHistory} from '@intuit3d/model/transactions';
import type {DimensionBindingEvaluation} from '@intuit3d/model/dimension-bindings';
import type {DimensionBatchEditRequest} from '@intuit3d/model/dimension-batch-edit';
import type {SketchDocument, SketchSolution, PlateProfile} from '@intuit3d/sketch';
import type {ProfileDiscoveryResponse} from '@intuit3d/sketch/profile-discovery/v1';


export const WORKFLOW_INVALIDATION_FORMAT: 'intuit3d.workflow-invalidation';
export const WORKFLOW_INVALIDATION_VERSION: 1;
/** Structural change cut only; NEVER proof of exact B-rep / STEP reuse. */
export interface WorkflowInvalidation {
  format: typeof WORKFLOW_INVALIDATION_FORMAT;
  version: typeof WORKFLOW_INVALIDATION_VERSION;
  projectId: string;
  previousRevision: number;
  revision: number;
  changedFeatureIds: string[];
  invalidatedFeatureIds: string[];
  removedFeatureIds: string[];
  unchangedFeatureIds: string[];
  exactReuseAllowed: false;
}
export function diffWorkflowPlans(previous: EvaluationPlan, current: EvaluationPlan): WorkflowInvalidation;

export const WORKFLOW_RUNTIME_FORMAT: 'intuit3d.workflow-runtime-evaluation';
export const WORKFLOW_RUNTIME_VERSION: 1;
export type RuntimeStatus =
  'intent_ready' | 'pending_intent' | 'ambiguous_intent' | 'blocked_dependency' |
  'blocked_scalar' | 'invalid_sketch' | 'unsolved_sketch' | 'invalid_profile' |
  'invalid_feature' | 'preview_only' | 'analytic_profile_only' | 'pending_exact_provider';
export interface RuntimeFeature {
  featureId: string;
  kind: string;
  modelStatus: 'ready' | 'pending' | 'conflicted' | 'blocked';
  status: RuntimeStatus;
  diagnostics: string[];
  modelDiagnostics: EvaluationPlan['features'][number]['diagnostics'];
  scalarStatus?: string;
  dimensionDiagnostics?: DimensionBindingEvaluation['featureGates'][number]['diagnostics'];
  sketchDiagnostics?: SketchSolution['diagnostics'];
  solveStatus?: SketchSolution['status'];
  discoveryReason?: string | null;
  rejected?: ProfileDiscoveryResponse['rejected'];
  relatedIds?: string[];
  profile?: PlateProfile;
  sketchSignature?: string;
  sourceSketchId?: string;
  bodyId?: string;
  thicknessMm?: number;
  evidence?: 'model_only' | 'sketch_analytic_only';
}
export interface RuntimeReport {
  format: typeof WORKFLOW_RUNTIME_FORMAT;
  version: typeof WORKFLOW_RUNTIME_VERSION;
  projectId: string;
  revision: number;
  authoredOrder: string[];
  executableOrder: string[];
  features: RuntimeFeature[];
  exactGeometryAvailable: false;
}
export interface RuntimeServices {
  model: { planProject(document: ProjectDocument): EvaluationPlan };
  transactions: {
    parseUndoHistory(source: unknown): UndoHistory;
    commitUndoableTransaction(history: UndoHistory, events: readonly JournalEvent[], revision?: number): UndoHistory;
    undoTransaction(history: UndoHistory, eventIds: readonly string[], revision?: number): UndoHistory;
    redoTransaction(history: UndoHistory, eventIds: readonly string[], revision?: number): UndoHistory;
  };
  bindings: {evaluateDimensionBindingPlan(plan: EvaluationPlan): DimensionBindingEvaluation};
  dimensions: {commitUndoableDimensionEditBatch(history: UndoHistory, request: DimensionBatchEditRequest): UndoHistory};
  archive: {
    createModelArchive(history: UndoHistory): unknown;
    serializeModelArchive(archive: any): string;
    deserializeModelArchive(data: string): {history: UndoHistory};
  };
  sketch: {validateSketch(source: unknown): SketchDocument;solveSketch(source: SketchDocument): SketchSolution};
  discovery: {
    discoverPlateProfiles(source: SketchDocument): ProfileDiscoveryResponse;
    admitDiscoveredPlateProfile(source: SketchDocument, proposal: ProfileDiscoveryResponse, candidateId: string): PlateProfile;
  };
}
export interface WorkflowRuntime {
  inspect(history: UndoHistory): RuntimeReport;
  /** Compare authoritative project revisions without reusing stale solids or STEP. */
  diff(previousHistory: UndoHistory, nextHistory: UndoHistory): WorkflowInvalidation;
  commit(history: UndoHistory, events: readonly JournalEvent[], expectedRevision?: number): UndoHistory;
  editDimensions(history: UndoHistory, request: DimensionBatchEditRequest): UndoHistory;
  undo(history: UndoHistory, eventIds: readonly string[], expectedRevision?: number): UndoHistory;
  redo(history: UndoHistory, eventIds: readonly string[], expectedRevision?: number): UndoHistory;
  save(history: UndoHistory): string;
  reopen(serialized: string): UndoHistory;
}
export function createWorkflowRuntime(services: RuntimeServices): WorkflowRuntime;
