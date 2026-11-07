import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument} from '@intuit3d/sketch';
export declare const HOLE_MIRROR_FORMAT:'intuit3d.feature-ops.hole-mirror';
export declare const HOLE_MIRROR_VERSION:1;
export type MirrorHolePair=Readonly<{sourceHoleId:string;outputHoleId:string}>;
export type MirrorHoleRequest=Readonly<{
  format:typeof HOLE_MIRROR_FORMAT;version:typeof HOLE_MIRROR_VERSION;
  eventId:string;expectedRevision:number;units:'mm';frame:'local_xy';
  sketchFeatureId:string;extrudeFeatureId:string;cutFeatureId:string;
  targetBodyId:string;
  axis:Readonly<{xMm:number;yMm:number;dx:number;dy:number}>;
  copies:readonly MirrorHolePair[];
}>;
export type MirrorHoleServices=Readonly<{
  runtime:Pick<WorkflowRuntime,'inspect'|'editPlateHoles'>;
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];writeTargets:readonly string[];
    payload:Record<string,unknown>}[]};
  sketch:{validateSketch(source:unknown):SketchDocument;
    solveSketch(source:SketchDocument):{status:string;geometry?:{
      points:readonly {id:string;x:number;y:number}[];
      circles:readonly {id:string;radius:number}[]}}};
}>;
export type MirrorHoleOperation=Readonly<{kind:'add';id:string;x:number;y:number;radius:number}>;
export type MirrorHoleResult=
  |Readonly<{kind:'refused';code:string;notCommitted:true;sourceRevision:number;
    mirrorCopies:readonly MirrorHoleOperation[];exactAuthority:false;
    independentInteroperability:false}>
  |Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;
    invalidation:WorkflowInvalidation;mirrorCopies:readonly MirrorHoleOperation[];
    semanticIds:{sketchId:string;extrudeId:string;cutId:string;bodyId:string};
    nativeHandoff:{kind:'runtime_evaluation_required';cutFeatureId:string;
      bodyId:string;sourceRevision:number;
      compatibility:'not_claimed_ask_RUNTIME_provider';
      exactAuthority:false;independentInteroperability:false};
    exactAuthority:false;independentInteroperability:false}>;
/** One undoable non-associative mirror; SKETCH/RUNTIME are authoritative. */
export declare function mirrorProfileHoles(
  history:UndoHistory,request:MirrorHoleRequest,services:MirrorHoleServices
):MirrorHoleResult;
