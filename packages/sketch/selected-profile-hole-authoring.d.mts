import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedAnalyticProfile,SelectedProfileSelection} from './selected-profile.mjs';

export const SELECTED_PROFILE_HOLE_AUTHORING_VERSION:1;
export type SelectedHoleAnchor={
  pointId:string;kind:'boundary_vertex'|'hole_center';entityId:string;
  position:{x:number;y:number};
};
export type SelectedHoleControl={
  holeId:string;centerPointId:string;position:{x:number;y:number};
  radiusMm:number;xConstraintId:string|null;yConstraintId:string|null;
  xReferencePointId:string|null;yReferencePointId:string|null;
  radiusConstraintIds:string[];dependentEntityIds:string[];
  canReanchor:boolean;canRemove:boolean;
};
export type SelectedProfileHoleInspection={
  kind:'selected_profile_hole_authoring';version:1;sourceSignature:string;
  selection:SelectedProfileSelection;semanticProfileId:string;
  anchors:SelectedHoleAnchor[];holes:SelectedHoleControl[];
  profile:SelectedAnalyticProfile;previewOnly:true;nativeExact:false;
};
export type SelectedProfileHoleRefusal={
  kind:'refused';version:1;sourceSignature:string;reason:string;
  sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];detail:string|null;
  previewOnly:true;nativeExact:false;
};
export type SelectedProfileHoleCommand=
  | {kind:'add-hole';sourceSignature:string;holeId:string;
     anchorPointId:string;xMm:number;yMm:number;radiusMm:number}
  | {kind:'remove-hole';sourceSignature:string;holeId:string}
  | {kind:'reanchor-hole';sourceSignature:string;holeId:string;anchorPointId:string};
export type SelectedProfileHoleAccepted={
  kind:'accepted';version:1;operation:SelectedProfileHoleCommand['kind'];
  sourceSignature:string;nextSourceSignature:string;sketch:SketchDocument;
  selection:SelectedProfileSelection;profile:SelectedAnalyticProfile;
  semanticProfileId:string;holeId:string;changedConstraintIds:string[];
  offsetsMm:{x:number;y:number}|null;
  beforePosition:{x:number;y:number}|null;
  afterPosition:{x:number;y:number}|null;
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false;
};
export function inspectSelectedProfileHoleAuthoring(
  source:SketchDocument,selection:SelectedProfileSelection
):SelectedProfileHoleInspection|SelectedProfileHoleRefusal;
export function editSelectedProfileHole(source:SketchDocument,
  selection:SelectedProfileSelection,command:SelectedProfileHoleCommand
):SelectedProfileHoleAccepted|SelectedProfileHoleRefusal;
