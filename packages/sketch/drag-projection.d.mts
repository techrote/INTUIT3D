import type { Diagnostic, SketchDocument, SketchGeometry, SolveStatus } from './index.mjs';
export const DRAG_PROJECTION_VERSION: 1;
export type DragAxis = 'x' | 'y';
export type DragProjectionStatus = 'ready' | 'projected' | 'blocked' | 'conflicted' | 'numerical_failure';
export interface DragProjection {
  version: 1;
  previewOnly: true;
  sourceSignature: string;
  sourceSolverStatus: SolveStatus;
  target: {pointId:string;x:number;y:number};
  status: DragProjectionStatus;
  geometry: SketchGeometry|null;
  resolvedTarget: {x:number;y:number}|null;
  acceptedAxes: DragAxis[];
  blockedAxes: DragAxis[];
  diagnostics: {axis:DragAxis|'both'|'sketch';reason:string;details:Diagnostic[]}[];
}
export function suggestProjectedDrag(doc: SketchDocument, pointId:string, target:{x:number;y:number}):DragProjection;
