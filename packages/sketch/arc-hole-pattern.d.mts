import type {ArcSketchDocument,ArcSketchSolution} from './arc-constraints.mjs';
import type {ArcHoleSelection} from './arc-hole-authoring.mjs';
import type {AnalyticArcProfile} from './arc-profile.mjs';

/** Parametric pattern metadata; persist atomically with SKETCH + selection. */
export const ARC_HOLE_PATTERN_VERSION:1;
export const ARC_HOLE_PATTERN_FORMAT:'intuit3d.arc-hole-pattern';
export type ArcHolePatternSettings={
  id:string;sourceCircleId:string;rows:number;columns:number;
  spacingXmm:number;spacingYmm:number;
};
export interface ArcHolePattern extends ArcHolePatternSettings {
  format:'intuit3d.arc-hole-pattern';version:1;
  seedSnapshot:{xMm:number;yMm:number;radiusMm:number};
}
export interface ArcHolePatternStamp {
  sourceSignature:string;selectionSignature:string;
  patternSignature:string|null;
}
export type ArcHolePatternCommand=
  | ({kind:'create'} & ArcHolePatternSettings)
  | {kind:'reconfigure';rows:number;columns:number;spacingXmm:number;spacingYmm:number}
  | {kind:'refresh'}
  | {kind:'edit-seed';xMm:number;yMm:number;diameterMm:number};
export interface ArcHolePatternInspection extends ArcHolePatternStamp {
  format:'intuit3d.arc-hole-pattern';version:1;pattern:ArcHolePattern;
  memberIds:string[];status:'synchronized'|'seed_changed'|'unresolved';
  reason:string|null;profile:AnalyticArcProfile|null;
  previewOnly:true;nativeExact:false;
}
export type ArcHolePatternResult=
  | (ArcHolePatternStamp & {
      kind:'refused';format:'intuit3d.arc-hole-pattern';version:1;
      reason:string;previewOnly:true;
    })
  | (ArcHolePatternStamp & {
      kind:'accepted';format:'intuit3d.arc-hole-pattern';version:1;
      previous:ArcHolePatternStamp;
      sketch:ArcSketchDocument;selection:ArcHoleSelection;pattern:ArcHolePattern;
      solution:ArcSketchSolution;profile:AnalyticArcProfile;
      createdIds:string[];removedIds:string[];preservedIds:string[];
      previewOnly:true;nativeExact:false;
    });
export function createArcHolePattern(source:unknown):ArcHolePattern;
export function serializeArcHolePattern(pattern:ArcHolePattern):string;
export function parseArcHolePattern(json:string):ArcHolePattern;
export function inspectArcHolePattern(
  source:ArcSketchDocument,selected:ArcHoleSelection,
  pattern:ArcHolePattern):ArcHolePatternInspection;
export function proposeArcHolePattern(
  source:ArcSketchDocument,selected:ArcHoleSelection,
  existing:ArcHolePattern|null,command:ArcHolePatternCommand,
  expected:ArcHolePatternStamp):ArcHolePatternResult;
export function adoptArcHolePattern(
  source:ArcSketchDocument,selected:ArcHoleSelection,
  request:ArcHolePatternSettings,expected:ArcHolePatternStamp):ArcHolePatternResult;
