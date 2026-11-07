import type {ArcSketchDocument,ArcSketchSolution} from './arc-constraints.mjs';
import type {ArcHoleSelection} from './arc-hole-authoring.mjs';
import type {AnalyticArcProfile} from './arc-profile.mjs';
export const ARC_BOLT_CIRCLE_VERSION:1;
export const ARC_BOLT_CIRCLE_FORMAT:'intuit3d.arc-bolt-circle';
export interface ArcBoltCircleSettings {
  id:string;sourceCircleId:string;centerXMm:number;centerYMm:number;count:number;
}
export interface ArcBoltCircle extends ArcBoltCircleSettings {
  format:'intuit3d.arc-bolt-circle';version:1;
  seedSnapshot:{xMm:number;yMm:number;radiusMm:number};
}
export interface ArcBoltCircleStamp {
  sourceSignature:string;selectionSignature:string;patternSignature:string|null;
}
export type ArcBoltCircleCommand =
 | ({kind:'create'} & ArcBoltCircleSettings)
 | {kind:'reconfigure';centerXMm:number;centerYMm:number;count:number}
 | {kind:'refresh'}
 | {kind:'edit-seed';xMm:number;yMm:number;diameterMm:number};
export interface ArcBoltCircleInspection extends ArcBoltCircleStamp {
  format:'intuit3d.arc-bolt-circle';version:1;pattern:ArcBoltCircle;
  memberIds:string[];status:'synchronized'|'seed_changed'|'unresolved';
  reason:string|null;profile:AnalyticArcProfile|null;previewOnly:true;nativeExact:false;
}
export type ArcBoltCircleResult =
 | (ArcBoltCircleStamp & {kind:'refused';format:'intuit3d.arc-bolt-circle';
      version:1;reason:string;previewOnly:true})
 | (ArcBoltCircleStamp & {kind:'accepted';format:'intuit3d.arc-bolt-circle';
      version:1;previous:ArcBoltCircleStamp;sketch:ArcSketchDocument;
      selection:ArcHoleSelection;pattern:ArcBoltCircle;
      solution:ArcSketchSolution;profile:AnalyticArcProfile;
      createdIds:string[];removedIds:string[];preservedIds:string[];
      previewOnly:true;nativeExact:false});
export function createArcBoltCircle(source:unknown):ArcBoltCircle;
export function serializeArcBoltCircle(value:ArcBoltCircle):string;
export function parseArcBoltCircle(json:string):ArcBoltCircle;
export function inspectArcBoltCircle(sketch:ArcSketchDocument,selection:ArcHoleSelection,
  pattern:ArcBoltCircle):ArcBoltCircleInspection;
export function proposeArcBoltCircle(sketch:ArcSketchDocument,selection:ArcHoleSelection,
  pattern:ArcBoltCircle|null,command:ArcBoltCircleCommand,
  expected:ArcBoltCircleStamp):ArcBoltCircleResult;
