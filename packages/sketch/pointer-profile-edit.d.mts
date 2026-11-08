import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedAnalyticProfile,SelectedProfileSelection} from './selected-profile.mjs';

export const POINTER_PROFILE_EDIT_VERSION:1;
export type PointerEditPoint={x:number;y:number};
export type PointerEditableHandle={
  handleId:string;kind:'dimension'|'hole_center';
  dimensionKind:'distanceX'|'distanceY'|'radius'|null;
  constraintIds:string[];entityId:string;position:PointerEditPoint;
  valueMm:number|null;
};
export type PointerEditHit=PointerEditableHandle&{distanceMm:number};
export type PointerEditRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type PointerEditableInventory={
  kind:'pointer_editable_handles';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;semanticProfileId:string;
  solverStatus:'solved';degreesOfFreedom:number;
  diagnostics:SketchSolution['diagnostics'];handles:PointerEditableHandle[];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type PickProfileHandleCommand={
  kind:'pick-profile-handle';version:1;sourceSignature:string;
  point:PointerEditPoint;maxDistanceMm:number;
  filter:'all'|'dimension'|'hole_center';
};
export type PickProfileHandleResult={
  kind:'picked';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;semanticProfileId:string;
  handle:PointerEditHit;
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type AmbiguousProfileHandleResult={
  kind:'ambiguous';version:1;sourceSignature:string;
  reason:'multiple_handles_in_range';selection:SelectedProfileSelection;
  choices:PointerEditHit[];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type MissProfileHandleResult={
  kind:'miss';version:1;sourceSignature:string;reason:'no_handle_in_range';
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export type DragProfileHandleCommand={
  kind:'drag-profile-handle';version:1;sourceSignature:string;
  handleId:string;target:PointerEditPoint;
};
export type DragProfileHandleAccepted={
  kind:'accepted';version:1;sourceSignature:string;
  nextSourceSignature:string;sketch:SketchDocument;
  selection:SelectedProfileSelection;profile:SelectedAnalyticProfile;
  handleId:string;handleKind:'dimension'|'hole_center';
  changedConstraintIds:string[];
  gesture:{requested:PointerEditPoint;applied:PointerEditPoint;
    deviationMm:number};
  handles:PointerEditableHandle[];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export function inspectPointerEditableHandles(
  source:SketchDocument,selection:SelectedProfileSelection
):PointerEditableInventory|PointerEditRefusal;
export function pickProfileHandleAtPointer(
  source:SketchDocument,selection:SelectedProfileSelection,
  request:PickProfileHandleCommand
):PickProfileHandleResult|AmbiguousProfileHandleResult|
  MissProfileHandleResult|PointerEditRefusal;
export function dragProfileHandleAtPointer(
  source:SketchDocument,selection:SelectedProfileSelection,
  command:DragProfileHandleCommand
):DragProfileHandleAccepted|PointerEditRefusal;
