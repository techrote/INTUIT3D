import type {ArcSketchDocument,ArcSketchSolution,ArcDiagnostic,ArcSolveStatus} from './arc-constraints.mjs';
import type {AnalyticArcProfile} from './arc-profile.mjs';
export const OBROUND_SLOT_VERSION:1;
export const OBROUND_SLOT_FORMAT:'intuit3d.obround-slot';
export interface ObroundSlotDimensions {
  id:string; overallLengthMm:number;diameterMm:number;
  originXmm:number;originYmm:number;
}
export type ObroundSlotRequest={id:string;overallLengthMm:number;diameterMm:number;
  originXmm?:number;originYmm?:number};
export type ObroundSlotEdit=
  | {kind:'resize';overallLengthMm:number;diameterMm:number}
  | {kind:'move';originXmm:number;originYmm:number};
export interface ObroundSlotInspection {
  format:'intuit3d.obround-slot';version:1;sourceSignature:string;
  dimensions:ObroundSlotDimensions;status:ArcSolveStatus;reason:string|null;
  diagnostics:ArcDiagnostic[];profile:AnalyticArcProfile|null;previewOnly:true;
}
export type ObroundSlotResult=
  | {kind:'refused';format:'intuit3d.obround-slot';version:1;
    sourceSignature:string;reason:string}
  | {kind:'accepted';format:'intuit3d.obround-slot';version:1;
    sourceSignature:string;sketch:ArcSketchDocument;solution:ArcSketchSolution;
    profile:AnalyticArcProfile;dimensions:ObroundSlotDimensions;previewOnly:true};
export function createObroundSlot(request:ObroundSlotRequest):ArcSketchDocument;
export function inspectObroundSlot(source:ArcSketchDocument,id:string):ObroundSlotInspection;
export function editObroundSlot(source:ArcSketchDocument,id:string,change:ObroundSlotEdit,
  expectedSignature:string):ObroundSlotResult;
