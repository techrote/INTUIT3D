import type { SketchDocument } from './index.mjs';
export const ROUNDED_PLATE_VERSION: 1;
export interface RoundedPlateIntent {
  version: 1;
  id: string;
  edgeIds: [string,string,string,string];
  holeIds: string[];
  radiusMm: number;
}
export type CurvePoint = {x:number;y:number};
export type RoundedBoundary =
 | {kind:'line';id:string;sourceEdgeId:string;start:CurvePoint;end:CurvePoint}
 | {kind:'arc';id:string;sourceVertexId:string;center:CurvePoint;
    start:CurvePoint;end:CurvePoint;radiusMm:number;startAngleRad:number;
    sweepRad:number;cornerSigns?:undefined};
export interface RoundedPlateProfile {
  status:'analytic_curved_profile_only';
  previewOnly:true;units:'mm';intentId:string;radiusMm:number;
  orientation:1|-1;boundary:RoundedBoundary[];
  holes:{id:string;centerId:string;x:number;y:number;radius:number}[];
  areaMm2:number;numericalClearanceBudgetMm:number;
}
export interface RoundedPlateResult {
  version:1;sourceSignature:string;intentSignature:string;
  solverKind:'constructive_right_angle_fillet_only';
  generalNonlinearSolver:false;previewOnly:true;
  status:'solved'|'underconstrained'|'conflicted'|'numerical_failure';
  baseDegreesOfFreedom:number;geometry:RoundedPlateProfile|null;
  diagnostics: Array<{code:string;message?:string;count?:number;
    candidates?:string[];magnitudeMm?:number|null}>;
}
export function createRoundedPlateIntent(source:unknown):RoundedPlateIntent;
export function editRoundedPlateRadius(source:RoundedPlateIntent,radiusMm:number):RoundedPlateIntent;
export function serializeRoundedPlateIntent(source:RoundedPlateIntent):string;
export function parseRoundedPlateIntent(json:string):RoundedPlateIntent;
export function solveRoundedPlate(sketch:SketchDocument,intent:RoundedPlateIntent):RoundedPlateResult;
