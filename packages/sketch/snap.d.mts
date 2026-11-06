import type {SketchDocument, SolveStatus} from './index.mjs';
export const SKETCH_SNAP_VERSION: 1;
export type SnapKind='point'|'circle_center'|'midpoint'|'circle_quadrant'|'segment'|'circle_perimeter'|'grid';
export interface SnapCandidate {
  /** Opaque, deterministic locator within the source signature; not persistent topology. */
  id:string;
  kind:SnapKind;
  entityId:string|null;
  x:number; y:number;distanceMm:number;
  /** 0..1 on a segment, 0.5 at a midpoint; not a persistent constraint. */
  parameter?:number;
}
export interface SnapOptions {
  radiusMm?:number;
  maxCandidates?:number;
  maxEntities?:number;
  gridMm?:number;
  /** App-owned geometry IDs to omit (e.g., point currently being dragged). */
  excludeIds?:string[];
}
export interface SnapResponse {
  version:1;
  previewOnly:true;
  inputSignature:string;
  cursor:{x:number;y:number};
  sourceStatus:SolveStatus|null;
  provisionalGeometry:boolean;
  status:'ready'|'no_candidate'|'source_unsolved'|'numerical_failure'|'budget_exceeded';
  reason:string|null;
  candidates:SnapCandidate[];
  selected:SnapCandidate|null;
}
/** Preview-only ranked sketch inference; candidates never mutate authored constraints. */
export function suggestSketchSnaps(source:SketchDocument,cursor:{x:number;y:number},options?:SnapOptions):SnapResponse;
