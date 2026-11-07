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
/** One journal event for an atomic batch of actual SKETCH constraint edits. */
export interface SketchConstraintBatchRequest {
  sketchFeatureId:string;
  eventId:string;
  expectedRevision:number;
  admission?:'require_admissible' | 'preserve_unresolved';
  edits:ReadonlyArray<Readonly<{
    constraintId:string;
    patch:Partial<{value:number;x:number;y:number}>,
  }>>;
}
export type SketchConstraintBatchResult =
  | Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;
      sketchStatus:RuntimeStatus;invalidation:WorkflowInvalidation}>
  | Readonly<{kind:'refused';code:'inadmissible_sketch';
      sourceRevision:number;candidateRevision:number;notCommitted:true;
      candidateFeature:RuntimeFeature;reason:string}>;

/**
 * Atomic sketch-circle authoring. Radius is the actual SKETCH radius in mm.
 * Adds allocate stable circle, centre-point, fixed and radius constraint IDs;
 * removal refuses externally referenced geometry rather than dropping intent.
 */
export type PlateHoleOperation =
  | Readonly<{kind:'add';id:string;x:number;y:number;radius:number}>
  | Readonly<{kind:'remove';id:string}>;
export interface PlateHoleBatchRequest {
  sketchFeatureId:string;
  eventId:string;
  expectedRevision:number;
  admission?:'require_admissible'|'preserve_unresolved';
  operations:ReadonlyArray<PlateHoleOperation>;
}
export type PlateHoleBatchResult=SketchConstraintBatchResult;
/** One-shot, NON-associative rectangular copies of a real solved source hole.
 * The source occupies row 0/column 0; new IDs are `idPrefix:r<Row>c<Col>`.
 * Pitches are signed millimetres; all added holes are independently authored.
 */
export interface RectangularHoleArrayRequest {
  sketchFeatureId:string;
  eventId:string;
  expectedRevision:number;
  admission?:'require_admissible'|'preserve_unresolved';
  sourceHoleId:string;
  idPrefix:string;
  columns:number;
  rows:number;
  pitchXmm:number;
  pitchYmm:number;
}


/** One-shot NON-associative polar hole copies around a chosen pivot.
 * The original solved source remains instance 0. Full +/-360 degree sweeps
 * exclude the duplicate endpoint; partial sweeps include both endpoints.
 * Each copy is an independent authored circle with stable ID `idPrefix:pN`.
 */
export interface CircularHolePatternRequest {
  sketchFeatureId:string;
  eventId:string;
  expectedRevision:number;
  admission?:'require_admissible'|'preserve_unresolved';
  sourceHoleId:string;
  idPrefix:string;
  instances:number;
  pivotXmm:number;
  pivotYmm:number;
  sweepDegrees?:number;
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
  sketch: {validateSketch(source: unknown): SketchDocument;solveSketch(source: SketchDocument): SketchSolution;
    editConstraint?(source: SketchDocument, id: string, patch: Partial<{value:number;x:number;y:number}>): SketchDocument};
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
  /** One revision-fenced, undoable model event; optional refusal before commit. */
  editSketchConstraints(history: UndoHistory, request: SketchConstraintBatchRequest): SketchConstraintBatchResult;
  /** One authoritative edit of the number, centres and radii of circular holes. */
  editPlateHoles(history:UndoHistory,request:PlateHoleBatchRequest):PlateHoleBatchResult;
  /** Copy solved hole geometry into a bounded 2–32-cell array in one model event. */
  patternPlateHoles(history:UndoHistory,request:RectangularHoleArrayRequest):PlateHoleBatchResult;
  /** One revision-fenced, undoable circular array using real solved SKETCH geometry. */
  patternCircularHoles(history:UndoHistory,request:CircularHolePatternRequest):PlateHoleBatchResult;
  undo(history: UndoHistory, eventIds: readonly string[], expectedRevision?: number): UndoHistory;
  redo(history: UndoHistory, eventIds: readonly string[], expectedRevision?: number): UndoHistory;
  save(history: UndoHistory): string;
  reopen(serialized: string): UndoHistory;
}
export function createWorkflowRuntime(services: RuntimeServices): WorkflowRuntime;
