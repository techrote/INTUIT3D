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

/** Independent corner radii, each bound to a persistent authored vertex ID. */
export const VARIABLE_ROUNDED_PLATE_VERSION:2;
export interface VariableRoundedPlateIntent {
  version:2;id:string;
  edgeIds:[string,string,string,string];holeIds:string[];
  cornerRadii:Array<{vertexId:string;radiusMm:number}>;
}
export type VariableRoundedPlateProfile=Omit<RoundedPlateProfile,'radiusMm'> & {
  cornerRadiiMm:Record<string,number>;
};
export type VariableRoundedPlateResult=Omit<RoundedPlateResult,
  'version'|'solverKind'|'geometry'> & {
  version:2;solverKind:'constructive_independent_right_angle_fillets_only';
  geometry:VariableRoundedPlateProfile|null;
};
export type VariableRoundedPlateHandle={
  kind:'corner_radius';id:string;sourceVertexId:string;
  position:CurvePoint;valueMm:number;
};
export interface VariableRoundedPlateInspection {
  version:2;sketchSignature:string;intentSignature:string;
  status:VariableRoundedPlateResult['status'];
  diagnostics:VariableRoundedPlateResult['diagnostics'];
  previewOnly:true;geometry:VariableRoundedPlateProfile|null;
  handles:VariableRoundedPlateHandle[];
}
export interface VariableRoundedPlateDrag {
  version:2;handleId:string;target:CurvePoint;
  expectedSketchSignature:string;expectedIntentSignature:string;
}
export interface VariableRoundedPlateEdit {
  version:2;
  status:VariableRoundedPlateResult['status']|'rejected';
  sketch:SketchDocument|null;intent:VariableRoundedPlateIntent|null;
  geometry:VariableRoundedPlateProfile|null;
  diagnostics:VariableRoundedPlateResult['diagnostics'];
  sourceSketchSignature:string;sourceIntentSignature:string;
  previewOnly:true;
  projection:{target:CurvePoint;appliedPoint:CurvePoint;deviationMm:number}|null;
}
export function createVariableRoundedPlateIntent(source:unknown):VariableRoundedPlateIntent;
export function serializeVariableRoundedPlateIntent(source:VariableRoundedPlateIntent):string;
export function parseVariableRoundedPlateIntent(json:string):VariableRoundedPlateIntent;
export function editVariableRoundedPlateRadius(source:VariableRoundedPlateIntent,
  vertexId:string,radiusMm:number):VariableRoundedPlateIntent;
export function solveVariableRoundedPlate(sketch:SketchDocument,
  intent:VariableRoundedPlateIntent):VariableRoundedPlateResult;
export function inspectVariableRoundedPlateHandles(sketch:SketchDocument,
  intent:VariableRoundedPlateIntent):VariableRoundedPlateInspection;
export function dragVariableRoundedPlateCorner(sketch:SketchDocument,
  intent:VariableRoundedPlateIntent,request:VariableRoundedPlateDrag):VariableRoundedPlateEdit;
