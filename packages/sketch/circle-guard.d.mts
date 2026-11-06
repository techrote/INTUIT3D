/** Exact dyadic topology of finite binary64 2D coordinates; not a B-rep or numeric area oracle. */
export const CIRCLE_GUARD_VERSION: 1;
export interface CircularGuardCircle {id:string;x:number;y:number;radius:number;}
export interface CircularGuardPoint {x:number;y:number;}
export interface CircularProfileAssessment {
  version:1;
  status:'verified' | 'rejected';
  reason:string|null;
  /** Authored circle IDs whose complete discs lie strictly inside the simple polygon. */
  insideIds:string[];
  /** Authored circle IDs whose complete discs lie strictly outside the polygon. */
  outsideIds:string[];
}
/** Read-only, fail-closed exact contact/containment checks for an analytic polygon with circles. */
export function assessCircularProfile(
  vertices:ReadonlyArray<Readonly<CircularGuardPoint>>,
  circles:ReadonlyArray<Readonly<CircularGuardCircle>>
):CircularProfileAssessment;
