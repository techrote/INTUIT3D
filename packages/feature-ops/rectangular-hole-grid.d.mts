import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument,SketchSolution} from '@intuit3d/sketch';
export declare const RECTANGULAR_HOLE_GRID_FORMAT:'intuit3d.feature-ops.rectangular-hole-grid';
export declare const RECTANGULAR_HOLE_GRID_VERSION:1;
export type RectangularGridIdentity=Readonly<{
  sourceHoleId:string;idPrefix:string;columns:number;rows:number;
}>;
export type RectangularGridCreate=RectangularGridIdentity&Readonly<{
  pitchXmm:number;pitchYmm:number;
}>;
export type RectangularGridResize=RectangularGridIdentity&Readonly<{
  scaleX:number;scaleY:number;radiusScale:number;
}>;
export type RectangularGridRequest<T extends RectangularGridCreate|RectangularGridResize|RectangularGridReshape>=Readonly<{
  format:typeof RECTANGULAR_HOLE_GRID_FORMAT;
  version:typeof RECTANGULAR_HOLE_GRID_VERSION;
  eventId:string;expectedProjectId:string;expectedRevision:number;
  units:'mm';frame:'local_xy';
  sketchFeatureId:string;extrudeFeatureId:string;cutFeatureId:string;
  targetBodyId:string;grid:T;
}>;
export type RectangularGridServices=Readonly<{
  runtime:Pick<WorkflowRuntime,'inspect'|'patternPlateHoles'|'resizePlateHoleLayout'|'editPlateHoles'>;
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];
    writeTargets:readonly string[];payload:Record<string,unknown>;
  }[]};
  sketch?:Readonly<{
    validateSketch(source:unknown):SketchDocument;
    solveSketch(source:SketchDocument):SketchSolution;
  }>;
}>;
export type RectangularGridResult=
  |Readonly<{kind:'refused';code:string;notCommitted:true;sourceRevision:number;
    gridHoleIds:readonly string[];exactAuthority:false;independentInteroperability:false}>
  |Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;
    invalidation:WorkflowInvalidation;gridHoleIds:readonly string[];
    semanticIds:{sketchId:string;extrudeId:string;cutId:string;bodyId:string};
    status:'pending_exact_provider';
    nativeHandoff:{kind:'runtime_evaluation_required';cutFeatureId:string;
      bodyId:string;sourceRevision:number;
      compatibility:'not_claimed_ask_RUNTIME_provider';
      exactAuthority:false;independentInteroperability:false};
    exactAuthority:false;independentInteroperability:false}>;
/** One-shot rectangular grid of 2–32 solved holes. No associative feature. */
export declare function authorRectangularHoleGrid(
  history:UndoHistory,request:RectangularGridRequest<RectangularGridCreate>,
  services:RectangularGridServices
):RectangularGridResult;
/** Retrospective one-shot selected-copy grid rescale, solved-source pivot. */
export declare function resizeRectangularHoleGrid(
  history:UndoHistory,request:RectangularGridRequest<RectangularGridResize>,
  services:RectangularGridServices&{sketch:NonNullable<RectangularGridServices['sketch']>}
):RectangularGridResult;

/** Existing regular grid extent, fixed signed pitches, and desired cell count.
 * Current solved coordinates must still match this explicitly supplied grid.
 * Non-associative semantic edit; no physical STEP/Boolean is implied. */
export type RectangularGridReshape=RectangularGridCreate&Readonly<{
  nextColumns:number;nextRows:number;
}>;
export type RectangularGridReshapeResult=
 |Readonly<{kind:'refused';code:string;notCommitted:true;sourceRevision:number;
    changes:{added:readonly string[];removed:readonly string[];retained:readonly string[]};
    gridHoleIds:readonly string[];exactAuthority:false;independentInteroperability:false}>
 |Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;
    invalidation:WorkflowInvalidation;
    changes:{added:readonly string[];removed:readonly string[];retained:readonly string[]};
    gridHoleIds:readonly string[];
    semanticIds:{sketchId:string;extrudeId:string;cutId:string;bodyId:string};
    status:'pending_exact_provider';
    nativeHandoff:{kind:'runtime_evaluation_required';cutFeatureId:string;
      bodyId:string;sourceRevision:number;
      compatibility:'not_claimed_ask_RUNTIME_provider';
      exactAuthority:false;independentInteroperability:false};
    exactAuthority:false;independentInteroperability:false}>;
/** Change grid row and column counts in one undoable admitted SKETCH edit. */
export declare function reshapeRectangularHoleGrid(
  history:UndoHistory,request:RectangularGridRequest<RectangularGridReshape>,
  services:RectangularGridServices&{sketch:NonNullable<RectangularGridServices['sketch']>}
):RectangularGridReshapeResult;
