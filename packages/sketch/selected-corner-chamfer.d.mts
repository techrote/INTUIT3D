import type {SketchDocument,SketchSolution} from './index.mjs';
import type {SelectedProfileSelection,SelectedAnalyticProfile} from './selected-profile.mjs';
export const SELECTED_CORNER_CHAMFER_VERSION:1;
export type ChamferHandle={id:string;kind:'incoming'|'outgoing';position:{x:number;y:number}};
export type ChamferRefusal={kind:'refused';version:1;sourceSignature:string;
  reason:string;detail:string|null;sourceStatus:SketchSolution['status']|null;
  diagnostics:SketchSolution['diagnostics'];previewOnly:true;nativeExact:false};
export type ChamferInspection={kind:'selected_corner_chamfer';version:1;
  sourceSignature:string;selection:SelectedProfileSelection;
  semanticProfileId:string;chamferId:string;cornerPointId:string;
  incomingEdgeId:string;outgoingEdgeId:string;
  incomingMm:number;outgoingMm:number;incomingLengthMm:number;
  outgoingLengthMm:number;incomingAxis:{x:number;y:number};
  outgoingAxis:{x:number;y:number};corner:{x:number;y:number};
  handles:ChamferHandle[];profile:SelectedAnalyticProfile;
  previewOnly:true;nativeExact:false};
export type CreateChamferCommand={kind:'create-corner-chamfer';version:1;
  sourceSignature:string;chamferId:string;cornerPointId:string;
  incomingMm:number;outgoingMm:number};
export type EditChamferCommand={kind:'edit-corner-chamfer';version:1;
  sourceSignature:string;chamferId:string;incomingMm:number;outgoingMm:number};
export type DragChamferGesture={version:1;sourceSignature:string;chamferId:string;
  handleId:string;target:{x:number;y:number}};
export type ChamferAccepted={kind:'accepted';version:1;sourceSignature:string;
  nextSourceSignature:string;sketch:SketchDocument;selection:SelectedProfileSelection;
  profile:SelectedAnalyticProfile;previousCandidateId:string;nextCandidateId:string;
  chamferId:string;originalCornerPointId:string;incomingEdgeId:string;
  outgoingEdgeId:string;createdEntityIds:string[];changedConstraintIds:string[];
  handles:ChamferHandle[];solverStatus:SketchSolution['status'];
  degreesOfFreedom:number;diagnostics:SketchSolution['diagnostics'];
  previewOnly:true;nativeExact:false;exactBrepAvailable:false;
  independentStepQualified:false};
export type ChamferDragged=ChamferAccepted&{gesture:{
  handleId:string;requested:{x:number;y:number};applied:{x:number;y:number};
  projectionDeviationMm:number}};
export function createSelectedCornerChamfer(source:SketchDocument,
  selection:SelectedProfileSelection,command:CreateChamferCommand):
  ChamferAccepted|ChamferRefusal;
export function inspectSelectedCornerChamfer(source:SketchDocument,
  selection:SelectedProfileSelection,chamferId:string):
  ChamferInspection|ChamferRefusal;
export function editSelectedCornerChamfer(source:SketchDocument,
  selection:SelectedProfileSelection,command:EditChamferCommand):
  ChamferAccepted|ChamferRefusal;
export function dragSelectedCornerChamferHandle(source:SketchDocument,
  selection:SelectedProfileSelection,gesture:DragChamferGesture):
  ChamferDragged|ChamferAccepted|ChamferRefusal;
