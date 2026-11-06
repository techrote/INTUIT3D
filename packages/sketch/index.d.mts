export type Point2 = { id: string; x: number; y: number };
export type Line2 = { id: string; start: string; end: string };
export type Circle2 = { id: string; center: string; radius: number };
export type SketchConstraint =
  | { id: string; kind: 'fixed'; point: string; x: number; y: number }
  | { id: string; kind: 'horizontal' | 'vertical'; line: string }
  | { id: string; kind: 'coincident'; a: string; b: string }
  | { id: string; kind: 'distanceX' | 'distanceY'; a: string; b: string; value: number }
  | { id: string; kind: 'radius'; circle: string; value: number }
  | { id: string; kind: 'equalRadius'; a: string; b: string };
export interface SketchDocument {
  version: 1; units: 'mm'; points: Point2[]; lines: Line2[]; circles: Circle2[];
  constraints: SketchConstraint[];
}
export type SolveStatus = 'solved' | 'underconstrained' | 'conflicted' | 'numerical_failure';
export type SketchGeometry = { points: Point2[]; lines: Line2[]; circles: Circle2[] };
export type Diagnostic =
  | { code: 'contradictory_constraints' | 'nonpositive_solved_radius' | 'residual_tolerance_exceeded' | 'arithmetic_overflow'; candidates: string[]; magnitudeMm: number | null }
  | { code: 'redundant_constraints' | 'free_degrees_of_freedom'; count: number };
export interface SketchSolution {
  status: SolveStatus;
  inputSignature: string;
  rank: number;
  degreesOfFreedom: number;
  scalarEquations: number;
  redundantEquations: number | null;
  numericalPolicy: { pivotTolerance: number; residualToleranceMm: number };
  geometry: SketchGeometry | null;
  diagnostics: Diagnostic[];
}
export type PlateProfile = {
  status: 'analytic_profile_only'; units: 'mm';
  outer: Point2[];
  holes: { id: string; centerId: string; x: number; y: number; radius: number }[];
  areaMm2: number;
};
export const SKETCH_VERSION: 1;
export function validateSketch(source: unknown): SketchDocument;
export function createSketch(source: unknown): SketchDocument;
export function serializeSketch(sketch: SketchDocument): string;
export function parseSketch(json: string): SketchDocument;
export function editConstraint(sketch: SketchDocument, id: string, patch: Partial<{ value: number; x: number; y: number }>): SketchDocument;
export function solveSketch(sketch: SketchDocument, options?: {pivotTolerance?:number; residualToleranceMm?:number}): SketchSolution;
export function buildPlateProfile(sketch: SketchDocument, solution: SketchSolution, edgeIds: string[], holeIds?: string[]): PlateProfile;
export function plateSketchFixture(): SketchDocument;

/** Transient, non-authoritative drag preview; never export as exact geometry. */
export interface DragSuggestion {
  sourceSignature: string;
  status: SolveStatus;
  geometry: SketchGeometry | null;
  degreesOfFreedom: number;
  diagnostics: Diagnostic[];
  target: { pointId: string; x: number; y: number };
  previewOnly: true;
}
export function suggestDrag(sketch: SketchDocument, pointId: string, target: {x:number; y:number}): DragSuggestion;
