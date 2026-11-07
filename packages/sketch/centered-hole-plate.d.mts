import type {SketchDocument,SketchSolution,PlateProfile,Diagnostic} from './index.mjs';
export const CENTERED_HOLE_PLATE_VERSION:1;
export const CENTERED_HOLE_PLATE_FORMAT:'intuit3d.centered-hole-plate';
export type CenteredHoleDimension =
  'widthMm'|'heightMm'|'leftInsetMm'|'rightInsetMm'|'holeARadiusMm'|'holeBRadiusMm';
export type CenteredHolePlateStatus =
  'solved'|'profile_rejected'|'dependency_broken'|
  'underconstrained'|'conflicted'|'numerical_failure';
export interface CenteredHolePlateRequest {
  id:string;widthMm:number;heightMm:number;
  leftInsetMm:number;rightInsetMm:number;
  holeARadiusMm:number;holeBRadiusMm:number;
  originXmm?:number;originYmm?:number;
}
export interface CenteredHoleHandle {
  id:string;dimension:CenteredHoleDimension;axis:'x'|'y';
  position:{x:number;y:number};valueMm:number;
}
export interface CenteredHolePlateInspection {
  format:'intuit3d.centered-hole-plate';version:1;
  sourceSignature:string;profileId:string;status:CenteredHolePlateStatus;
  reason:string|null;dimensions:Record<CenteredHoleDimension,number>;
  solution:SketchSolution;profile:PlateProfile|null;
  handles:CenteredHoleHandle[];previewOnly:true;nativeExact:false;
}
export type CenteredHoleEdit =
  | {kind:'refused';format:'intuit3d.centered-hole-plate';version:1;
    sourceSignature:string;reason:string}
  | {kind:'accepted';format:'intuit3d.centered-hole-plate';version:1;
    previousSignature:string;sourceSignature:string;
    sketch:SketchDocument;status:CenteredHolePlateStatus;
    dimensions:Record<CenteredHoleDimension,number>;
    solution:SketchSolution;profile:PlateProfile|null;
    diagnostics:Diagnostic[];reason:string|null;
    handles:CenteredHoleHandle[];previewOnly:true;nativeExact:false;
    gesture?:{handleId:string;target:{x:number;y:number};
      appliedPoint:{x:number;y:number}|null;deviationMm:number|null}
  };
export function createCenteredHolePlate(request:CenteredHolePlateRequest):SketchDocument;
export function inspectCenteredHolePlate(source:SketchDocument,id:string):CenteredHolePlateInspection;
export function editCenteredHolePlateDimension(source:SketchDocument,id:string,request:{
  version:1;expectedSignature:string;dimension:CenteredHoleDimension;valueMm:number
}):CenteredHoleEdit;
export function dragCenteredHolePlateHandle(source:SketchDocument,id:string,request:{
  version:1;expectedSignature:string;handleId:string;target:{x:number;y:number}
}):CenteredHoleEdit;
