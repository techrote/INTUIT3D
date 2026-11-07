import type {ArcSketchDocument,ArcSketchSolution,ArcSolveStatus} from './arc-constraints.mjs';
import type {AnalyticArcProfile} from './arc-profile.mjs';
import type {ObroundSlotDimensions} from './obround-slot.mjs';
export const OBROUND_SLOT_HANDLES_VERSION:1;
export const OBROUND_SLOT_HANDLES_FORMAT:'intuit3d.obround-slot-handles';
export type SlotHandleKind =
  'length-left'|'length-right'|'diameter-bottom'|'diameter-top'|'position';
export interface SlotHandle {
  id:string;kind:SlotHandleKind;axis:'x'|'y'|'xy';
  position:{x:number;y:number};valueMm:number|null;
}
export interface SlotHandleInspection {
  format:'intuit3d.obround-slot-handles';version:1;sourceSignature:string;
  status:ArcSolveStatus;reason:string|null;dimensions:ObroundSlotDimensions;
  handles:SlotHandle[];profile:AnalyticArcProfile|null;previewOnly:true;
}
export interface SlotDragGesture {
  version:1;handleId:string;expectedSignature:string;
  target:{x:number;y:number};
}
export type SlotDragResult =
  | {kind:'refused';format:'intuit3d.obround-slot-handles';version:1;
     sourceSignature:string;reason:string;previewOnly:true}
  | {kind:'accepted';format:'intuit3d.obround-slot-handles';version:1;
     priorSourceSignature:string;sourceSignature:string;
     sketch:ArcSketchDocument;solution:ArcSketchSolution;profile:AnalyticArcProfile;
     dimensions:ObroundSlotDimensions;handles:SlotHandle[];
     gesture:{handleId:string;axis:'x'|'y'|'xy';target:{x:number;y:number};
       appliedPoint:{x:number;y:number};deviationMm:number};previewOnly:true};
export function inspectObroundSlotHandles(source:ArcSketchDocument,id:string):SlotHandleInspection;
export function dragObroundSlotHandle(source:ArcSketchDocument,id:string,
  request:SlotDragGesture):SlotDragResult;
