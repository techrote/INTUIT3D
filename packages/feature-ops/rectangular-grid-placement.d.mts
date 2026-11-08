import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument,SketchSolution} from '@intuit3d/sketch';

export declare const GRID_PLACEMENT_FORMAT:'intuit3d.feature-ops.rectangular-grid-placement';
export declare const GRID_PLACEMENT_VERSION:1;

/** Explicit solved row/column basis: supports grids previously rotated.
 * Active axes are nonzero and, when both active, perpendicular. */
export type GridBasisVector=Readonly<{dxMm:number;dyMm:number}>;
export type GridPlacementRequest=Readonly<{
 format:typeof GRID_PLACEMENT_FORMAT;version:typeof GRID_PLACEMENT_VERSION;
 eventId:string;expectedProjectId:string;expectedRevision:number;
 units:'mm';frame:'local_xy';
 sketchFeatureId:string;extrudeFeatureId:string;cutFeatureId:string;
 targetBodyId:string;
 placement:Readonly<{
  sourceHoleId:string;idPrefix:string;columns:number;rows:number;
  stepX:GridBasisVector;stepY:GridBasisVector;
  pivotXmm:number;pivotYmm:number;rotateDegrees:number;
  translateXmm:number;translateYmm:number;
 }>;
}>;
export type GridPlacementServices=Readonly<{
 runtime:Pick<WorkflowRuntime,'inspect'|'transformPlateHoles'>;
 model:{featuresOf(document:UndoHistory['document']):readonly {
  id:string;kind:string;dependsOn:readonly string[];
  writeTargets:readonly string[];payload:Record<string,unknown>;
 }[]};
 sketch:{validateSketch(source:unknown):SketchDocument;
  solveSketch(source:SketchDocument):SketchSolution};
}>;
export type GridPlacementResult=
 |Readonly<{kind:'refused';code:string;notCommitted:true;sourceRevision:number;
   holeIds:readonly string[];exactAuthority:false;independentInteroperability:false}>
 |Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;
   invalidation:WorkflowInvalidation;holeIds:readonly string[];
   semanticIds:{sketchId:string;extrudeId:string;cutId:string;bodyId:string};
   placement:{pivotXmm:number;pivotYmm:number;rotateDegrees:number};
   status:'pending_exact_provider';
   nativeHandoff:{kind:'runtime_evaluation_required';cutFeatureId:string;
    bodyId:string;sourceRevision:number;
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false};
   exactAuthority:false;independentInteroperability:false}>;

/** Rigid edit of an existing complete named rectangular grid, including
 * the original hole, in ONE undoable RUNTIME transaction. This is not an
 * associative pattern or native B-rep/STEP implementation. */
export declare function placeRectangularHoleGrid(
 history:UndoHistory,request:GridPlacementRequest,
 services:GridPlacementServices
):GridPlacementResult;
