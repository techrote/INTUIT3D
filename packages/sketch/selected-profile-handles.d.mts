import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedAnalyticProfile,SelectedProfileSelection} from './selected-profile.mjs';

export const SELECTED_PROFILE_HANDLES_VERSION:1;
export type SelectedProfileHandle={
  id:string;constraintId:string;kind:'distanceX'|'distanceY'|'radius';
  entityId:string;valueMm:number;
  anchor:{x:number;y:number};position:{x:number;y:number};
};
export type SelectedProfileHandleInspection={
  kind:'selected_profile_handles';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;semanticProfileId:string;
  controls:SelectedProfileHandle[];holeCenters:SelectedProfileHoleCenter[];
  profile:SelectedAnalyticProfile;previewOnly:true;nativeExact:false;
};
export type SelectedProfileHandleRefusal={
  kind:'refused';version:1;sourceSignature:string;
  reason:string;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];detail:string|null;
  previewOnly:true;nativeExact:false;
};
export type SelectedProfileHandleCommand=
  | {kind:'set-dimension';sourceSignature:string;handleId:string;valueMm:number}
  | {kind:'drag-handle';sourceSignature:string;handleId:string;xMm:number;yMm:number};
export type SelectedProfileHandleEdit={
  kind:'accepted';version:1;sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;selection:SelectedProfileSelection;
  profile:SelectedAnalyticProfile;handleId:string;appliedValueMm:number;
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export function inspectSelectedProfileHandles(source:SketchDocument,
  selection:SelectedProfileSelection):
  SelectedProfileHandleInspection|SelectedProfileHandleRefusal;
export function editSelectedProfileHandle(source:SketchDocument,
  selection:SelectedProfileSelection,
  command:SelectedProfileHandleCommand):
  SelectedProfileHandleEdit|SelectedProfileHandleRefusal;

// This additional control is exposed only when the authored sketch contains
// an unambiguous X/Y dimensional pair constraining the selected circle centre.
export type SelectedProfileHoleCenter={
  id:string;holeId:string;centerPointId:string;
  position:{x:number;y:number};
  xConstraintId:string;yConstraintId:string;
  xReferencePointId:string;yReferencePointId:string;
  xAnchor:{x:number;y:number};yAnchor:{x:number;y:number};
  xOffsetMm:number;yOffsetMm:number;
};
export type SelectedProfileHoleMoveCommand={
  kind:'move-hole-center';sourceSignature:string;handleId:string;
  xMm:number;yMm:number;
};
export type SelectedProfileHoleMove={
  kind:'accepted';version:1;sourceSignature:string;nextSourceSignature:string;
  sketch:SketchDocument;selection:SelectedProfileSelection;
  profile:SelectedAnalyticProfile;handleId:string;holeId:string;
  editedConstraintIds:[string,string];appliedOffsetsMm:{x:number;y:number};
  gesture:{target:{x:number;y:number};appliedPoint:{x:number;y:number};
    deviationMm:number};
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export function moveSelectedProfileHoleCenter(source:SketchDocument,
  selection:SelectedProfileSelection,
  command:SelectedProfileHoleMoveCommand):
  SelectedProfileHoleMove|SelectedProfileHandleRefusal;
