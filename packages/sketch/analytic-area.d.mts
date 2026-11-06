export const ANALYTIC_AREA_GUARD_VERSION: 1;
export type AnalyticAreaReport =
  | {version:1;status:'verified';reason:null;areaMm2:number}
  | {version:1;status:'rejected';reason:string;areaMm2:null};
/**
 * Certifies positive net area for a simple polygon of finite encoded binary64
 * vertices and supplied circle radii. A rounded analytic preview is returned
 * only if representable as a finite positive binary64 number.
 *
 * Circle placement/contact is NOT verified here: require circle-guard/v1 first.
 * No B-rep, solver, face identity, STEP or physical tolerance claim.
 */
export function assessAnalyticProfileArea(
  vertices:ReadonlyArray<{x:number;y:number}>,
  holes?:ReadonlyArray<{radius:number}>
):AnalyticAreaReport;
