import type {SketchDocument,SketchSolution,PlateProfile,Diagnostic} from './index.mjs';

export const OFFSET_HOLE_PLATE_VERSION:2;
export const OFFSET_HOLE_PLATE_FORMAT:'intuit3d.centered-hole-plate-offsets';
export type OffsetHoleDimension =
  'widthMm'|'heightMm'|'leftInsetMm'|'rightInsetMm'|
  'holeARadiusMm'|'holeBRadiusMm'|'holeAYOffsetMm'|'holeBYOffsetMm';
export type OffsetHolePlateStatus =
  'solved'|'profile_rejected'|'dependency_broken'|
  'underconstrained'|'conflicted'|'numerical_failure';
export interface OffsetHolePlateRequest {
  id:string;widthMm:number;heightMm:number;
  leftInsetMm:number;rightInsetMm:number;
  holeARadiusMm:number;holeBRadiusMm:number;
  holeAYOffsetMm?:number;holeBYOffsetMm?:number;
  originXmm?:number;originYmm?:number;
}
export type OffsetHoleHandle =
  | {id:string;kind:'dimension';dimension:OffsetHoleDimension;
      axis:'x'|'y';position:{x:number;y:number};valueMm:number}
  | {id:string;kind:'hole_center';hole:'A'|'B';
      position:{x:number;y:number};valueMm:null};
export interface OffsetHolePlateInspection {
  format:'intuit3d.centered-hole-plate-offsets';version:2;
  sourceSignature:string;profileId:string;status:OffsetHolePlateStatus;
  reason:string|null;dimensions:Record<OffsetHoleDimension,number>;
  solution:SketchSolution;profile:PlateProfile|null;
  handles:OffsetHoleHandle[];previewOnly:true;nativeExact:false;
}
export type OffsetHoleEdit =
  | {kind:'refused';format:'intuit3d.centered-hole-plate-offsets';version:2;
      sourceSignature:string;reason:string}
  | {kind:'accepted';format:'intuit3d.centered-hole-plate-offsets';version:2;
      previousSignature:string;sourceSignature:string;sketch:SketchDocument;
      status:OffsetHolePlateStatus;reason:string|null;
      dimensions:Record<OffsetHoleDimension,number>;
      solution:SketchSolution;profile:PlateProfile|null;
      diagnostics:Diagnostic[];handles:OffsetHoleHandle[];
      previewOnly:true;nativeExact:false;
      gesture?:{handleId:string;target:{x:number;y:number};
        appliedPoint:{x:number;y:number}|null;deviationMm:number|null}
    };
export function createOffsetHolePlate(request:OffsetHolePlateRequest):SketchDocument;
export function inspectOffsetHolePlate(source:SketchDocument,id:string):OffsetHolePlateInspection;
export function editOffsetHolePlateDimensions(source:SketchDocument,id:string,request:{
  version:2;expectedSignature:string;changes:Partial<Record<OffsetHoleDimension,number>>
}):OffsetHoleEdit;
export function dragOffsetHolePlateHandle(source:SketchDocument,id:string,request:{
  version:2;expectedSignature:string;handleId:string;target:{x:number;y:number}
}):OffsetHoleEdit;
