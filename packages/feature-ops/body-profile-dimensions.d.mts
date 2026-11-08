import type {UndoHistory} from '@intuit3d/model/transactions';
import type {SelectedProfileSelection} from '@intuit3d/sketch/selected-profile/v1';
import type {SelectedDimension,DimensionInspection,DimensionAccepted,DimensionDragged}
  from '@intuit3d/sketch/selected-profile-dimensions/v1';

export const BODY_PROFILE_DIMENSIONS_FORMAT:'intuit3d.feature-ops.body-profile-dimensions';
export const BODY_PROFILE_DIMENSIONS_VERSION:1;
export type BodyProfileCommon={
  format:typeof BODY_PROFILE_DIMENSIONS_FORMAT;version:1;
  expectedProjectId:string;expectedRevision:number;
  units:'mm';frame:'local_xy';sourceSketchId:string;
  extrudeFeatureId:string;targetBodyId:string;
  selection:SelectedProfileSelection;
};
export type BodyProfileSelection=BodyProfileCommon;
export type BodyProfileEdit=BodyProfileCommon&{
  eventId:string;expectedAffectedFeatureIds:string[];
  changes:Array<{constraintId:string;expectedValueMm:number;valueMm:number}>;
};
export type BodyProfileDrag=BodyProfileCommon&{
  eventId:string;expectedAffectedFeatureIds:string[];
  handleId:string;target:{x:number;y:number};
};
export interface BodyProfileServices{
  runtime:{
    commit(history:UndoHistory,events:unknown[],expectedRevision:number):UndoHistory;
    inspect(history:UndoHistory):any;
    diff(previous:UndoHistory,next:UndoHistory):any;
  };
  model:{featuresOf(document:UndoHistory['document']):any[]};
  sketch:{validateSketch(source:unknown):any;serializeSketch(source:unknown):string};
  discovery:{
    discoverPlateProfiles(source:unknown):any;
    admitDiscoveredPlateProfile(source:unknown,proposal:unknown,id:string):any;
  };
  profileDimensions:{
    inspectSelectedProfileDimensions(source:any,selection:SelectedProfileSelection):
      DimensionInspection|{kind:'refused';reason:string};
    editSelectedProfileDimensions(source:any,selection:SelectedProfileSelection,
      command:any):DimensionAccepted|{kind:'refused';reason:string;detail?:string|null};
    dragSelectedProfileDimension(source:any,selection:SelectedProfileSelection,
      command:any):DimensionDragged|{kind:'refused';reason:string;detail?:string|null};
  };
}
export interface BodyProfileInspection{
  kind:'body_profile_dimensions';format:typeof BODY_PROFILE_DIMENSIONS_FORMAT;
  version:1;projectId:string;revision:number;sourceSignature:string;
  selection:SelectedProfileSelection;
  semanticIds:{sourceSketchId:string;extrudeFeatureId:string;targetBodyId:string};
  affectedFeatureIds:string[];dimensions:SelectedDimension[];
  solverStatus:'solved';status:'analytic_profile_only';
  previewOnly:true;exactAuthority:false;independentInteroperability:false;
}
export interface BodyProfileCommit{
  kind:'committed';format:typeof BODY_PROFILE_DIMENSIONS_FORMAT;version:1;
  history:UndoHistory;report:any;invalidation:any;
  semanticIds:{sourceSketchId:string;extrudeFeatureId:string;targetBodyId:string};
  affectedFeatureIds:string[];selectedProfile:SelectedProfileSelection;
  changedConstraintIds:string[];changedPointIds:string[];changedRadiusIds:string[];
  gesture:DimensionDragged['gesture']|null;
  status:'analytic_profile_only';
  nativeHandoff:{
    kind:'rebuild_selected_profile_body';bodyId:string;extrusionId:string;
    sourceRevision:number;compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  };
  exactAuthority:false;independentInteroperability:false;
}
export function inspectSelectedBodyProfileDimensions(
  history:UndoHistory,request:BodyProfileSelection,
  services:BodyProfileServices):BodyProfileInspection;
export function editSelectedBodyProfileDimensions(
  history:UndoHistory,request:BodyProfileEdit,
  services:BodyProfileServices):BodyProfileCommit;
export function dragSelectedBodyProfileDimension(
  history:UndoHistory,request:BodyProfileDrag,
  services:BodyProfileServices):BodyProfileCommit;
