import type {UndoHistory} from '@intuit3d/model/transactions';
import type {SelectedProfileSelection} from '@intuit3d/sketch/selected-profile/v1';
import type {EdgeNotchInspection,EdgeNotchDragged} from '@intuit3d/sketch/selected-edge-notch/v1';

export const CONTOUR_NOTCH_FORMAT:'intuit3d.feature-ops.selected-contour-notch';
export const CONTOUR_NOTCH_VERSION:1;
export type NotchCommon={
  format:typeof CONTOUR_NOTCH_FORMAT;version:1;
  expectedProjectId:string;expectedRevision:number;eventId:string;
  units:'mm';frame:'local_xy';sourceSketchId:string;extrudeFeatureId:string;
  targetBodyId:string;selection:SelectedProfileSelection;notchId:string;
};
export type CreateContourNotch=NotchCommon&{
  edgeId:string;fromMm:number;toMm:number;depthMm:number;
};
export type EditContourNotch=NotchCommon&{
  fromMm:number;toMm:number;depthMm:number;
};
export type DragContourNotch=NotchCommon&{
  handleId:string;target:{x:number;y:number};
};
export interface ContourNotchServices {
  runtime:{
    commit(history:UndoHistory,events:unknown[],expectedRevision:number):UndoHistory;
    inspect(history:UndoHistory):any;diff(previous:UndoHistory,next:UndoHistory):any;
  };
  model:{featuresOf(document:UndoHistory['document']):any[]};
  sketch:{validateSketch(source:unknown):any;serializeSketch(source:unknown):string};
  discovery:{discoverPlateProfiles(source:unknown):any;
    admitDiscoveredPlateProfile(source:unknown,proposal:unknown,id:string):any};
  notch:{createSelectedEdgeNotch(source:unknown,selection:unknown,command:unknown):any;
    editSelectedEdgeNotch(source:unknown,selection:unknown,command:unknown):any;
    dragSelectedEdgeNotchHandle(source:unknown,selection:unknown,command:unknown):any;
    inspectSelectedEdgeNotch(source:unknown,selection:unknown,id:string):any};
}
export type ContourNotchResult={
  kind:'committed';history:UndoHistory;report:unknown;invalidation:{
    invalidatedFeatureIds:string[];[key:string]:unknown;
  };semanticIds:{sourceSketchId:string;extrudeFeatureId:string;
    targetBodyId:string;notchId:string};
  selectedProfile:SelectedProfileSelection;notch:EdgeNotchInspection;
  gesture:EdgeNotchDragged['gesture']|null;status:'analytic_profile_only';
  nativeHandoff:{kind:'rebuild_selected_profile_body';bodyId:string;
    extrusionId:string;sourceRevision:number;
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false};
  exactAuthority:false;independentInteroperability:false;
};
export function authorSelectedContourNotch(history:UndoHistory,
  request:CreateContourNotch,services:ContourNotchServices):ContourNotchResult;
export function editSelectedContourNotch(history:UndoHistory,
  request:EditContourNotch,services:ContourNotchServices):ContourNotchResult;
export function dragSelectedContourNotch(history:UndoHistory,
  request:DragContourNotch,services:ContourNotchServices):ContourNotchResult;
