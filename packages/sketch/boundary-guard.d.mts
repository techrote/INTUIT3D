/** Exact dyadic predicates only for finite IEEE-754 coordinates, not a CAD B-rep. */
export const BOUNDARY_GUARD_VERSION: 1;
export type PolygonBoundaryAssessment = {
  version: 1;
  status: 'verified' | 'rejected';
  reason: null | 'invalid_vertices' | 'budget_exceeded' | 'zero_length_edge'
    | 'adjacent_backtrack' | 'nonadjacent_intersection' | 'zero_area';
};
export function assessPolygonBoundary(vertices: ReadonlyArray<Readonly<{x:number;y:number}>>): PolygonBoundaryAssessment;
export function requireSimplePolygonBoundary(vertices: ReadonlyArray<Readonly<{x:number;y:number}>>): PolygonBoundaryAssessment;

export type SeparatedPolygonBoundariesAssessment = {
  version:1;
  status:'separated'|'refused';
  reason:null|'invalid_boundary'|'boundary_contact'|'nested_contour';
};
/** Exact IEEE-754 polygon separation, not native B-rep or STEP qualification. */
export function assessSeparatedPolygonBoundaries(
  first:ReadonlyArray<Readonly<{x:number;y:number}>>,
  second:ReadonlyArray<Readonly<{x:number;y:number}>>
):SeparatedPolygonBoundariesAssessment;
