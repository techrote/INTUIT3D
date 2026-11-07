import type {SketchDocument} from './index.mjs';
import type {RoundedPlateIntent,RoundedPlateProfile,RoundedPlateResult} from './rounded-plate.mjs';
export const ROUNDED_PLATE_HANDLES_VERSION:1;
export type HandlePoint={x:number;y:number};
export type RoundedPlateHandle=
 | {kind:'dimension';id:string;position:HandlePoint;constraintId:string;axis:'x'|'y';fromPointId:string;toPointId:string;valueMm:number}
 | {kind:'corner_radius';id:string;position:HandlePoint;sourceVertexId:string;valueMm:number}
 | {kind:'hole_center';id:string;position:HandlePoint;circleId:string;pointId:string;constraintId:string}
 | {kind:'hole_radius';id:string;position:HandlePoint;circleId:string;centerId:string;constraintId:string;valueMm:number};
export interface RoundedPlateHandleInspection {
  version:1;sketchSignature:string;intentSignature:string;
  status:RoundedPlateResult['status'];diagnostics:RoundedPlateResult['diagnostics'];
  handles:RoundedPlateHandle[];geometry:RoundedPlateProfile|null;previewOnly:true;
}
export interface RoundedPlateHandleDrag {
  version:1;handleId:string;target:HandlePoint;
  expectedSketchSignature:string;expectedIntentSignature:string;
}
export interface RoundedPlateHandleEdit {
  version:1;
  status:RoundedPlateResult['status']|'rejected';
  sketch:SketchDocument|null;intent:RoundedPlateIntent|null;
  geometry:RoundedPlateProfile|null;diagnostics:RoundedPlateResult['diagnostics'];
  sourceSketchSignature:string;sourceIntentSignature:string;
  projection:{target:HandlePoint;appliedPoint:HandlePoint;deviationMm:number}|null;
  previewOnly:true;
}
export function inspectRoundedPlateHandles(sketch:SketchDocument,intent:RoundedPlateIntent):RoundedPlateHandleInspection;
export function editRoundedPlateHandle(sketch:SketchDocument,intent:RoundedPlateIntent,
  drag:RoundedPlateHandleDrag):RoundedPlateHandleEdit;
