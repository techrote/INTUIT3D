import type {UndoHistory} from '@intuit3d/model/transactions';
import type {SelectedProfileSelection} from '@intuit3d/sketch/selected-profile/v1';
import type {ChamferInspection,ChamferDragged} from '@intuit3d/sketch/selected-corner-chamfer/v1';

export const CORNER_CHAMFER_FORMAT:'intuit3d.feature-ops.selected-corner-chamfer';
export const CORNER_CHAMFER_VERSION:1;
export type CornerChamferCommon={
  format:typeof CORNER_CHAMFER_FORMAT;version:1;
  expectedProjectId:string;expectedRevision:number;eventId:string;
  units:'mm';frame:'local_xy';sourceSketchId:string;
  extrudeFeatureId:string;targetBodyId:string;
  expectedCutFeatureIds:string[];
  selection:SelectedProfileSelection;chamferId:string;
};
export type CreateCornerChamfer=CornerChamferCommon&{
  cornerPointId:string;incomingMm:number;outgoingMm:number;
};
export type EditCornerChamfer=CornerChamferCommon&{
  incomingMm:number;outgoingMm:number;
};
export type DragCornerChamfer=CornerChamferCommon&{
  handleId:string;target:{x:number;y:number};
};
export interface CornerChamferServices{
  runtime:{
    commit(history:UndoHistory,events:unknown[],expectedRevision:number):UndoHistory;
    inspect(history:UndoHistory):any;diff(before:UndoHistory,after:UndoHistory):any;
  };
  model:{featuresOf(document:UndoHistory['document']):any[]};
  sketch:{validateSketch(source:unknown):any;serializeSketch(source:unknown):string};
  discovery:{discoverPlateProfiles(source:unknown):any;
    admitDiscoveredPlateProfile(source:unknown,proposal:unknown,id:string):any};
  chamfer:{createSelectedCornerChamfer(source:unknown,selection:unknown,command:unknown):any;
    editSelectedCornerChamfer(source:unknown,selection:unknown,command:unknown):any;
    dragSelectedCornerChamferHandle(source:unknown,selection:unknown,gesture:unknown):any;
    inspectSelectedCornerChamfer(source:unknown,selection:unknown,id:string):any};
}
export type CornerChamferResult={
  kind:'committed';history:UndoHistory;report:unknown;
  invalidation:{invalidatedFeatureIds:string[];[key:string]:unknown};
  semanticIds:{sourceSketchId:string;extrudeFeatureId:string;
    targetBodyId:string;chamferId:string;cutFeatureIds:string[]};
  selectedProfile:SelectedProfileSelection;chamfer:ChamferInspection;
  gesture:ChamferDragged['gesture']|null;status:'analytic_profile_only';
  nativeHandoff:{kind:'rebuild_selected_profile_body';bodyId:string;
    extrusionId:string;sourceRevision:number;
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false};
  exactAuthority:false;independentInteroperability:false;
};
export function authorSelectedCornerChamfer(history:UndoHistory,
  request:CreateCornerChamfer,services:CornerChamferServices):CornerChamferResult;
export function editSelectedCornerChamfer(history:UndoHistory,
  request:EditCornerChamfer,services:CornerChamferServices):CornerChamferResult;
export function dragSelectedCornerChamfer(history:UndoHistory,
  request:DragCornerChamfer,services:CornerChamferServices):CornerChamferResult;
