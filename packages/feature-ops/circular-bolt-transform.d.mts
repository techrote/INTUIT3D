import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument,SketchSolution} from '@intuit3d/sketch';
export declare const BOLT_ORIENTATION_FORMAT:'intuit3d.feature-ops.bolt-orientation';
export declare const BOLT_ORIENTATION_VERSION:1;
export type BoltOrientationRequest=Readonly<{
 format:typeof BOLT_ORIENTATION_FORMAT;version:typeof BOLT_ORIENTATION_VERSION;
 eventId:string;expectedProjectId:string;expectedRevision:number;
 units:'mm';frame:'local_xy';
 sketchFeatureId:string;extrudeFeatureId:string;cutFeatureId:string;targetBodyId:string;
 orientation:Readonly<{
  sourceHoleId:string;idPrefix:string;instances:number;
  pivotXmm:number;pivotYmm:number;sweepDegrees:number;
  rotateDegrees:number;translateXmm:number;translateYmm:number;
 }>;
}>;
export type BoltOrientationServices=Readonly<{
 runtime:Pick<WorkflowRuntime,'inspect'|'transformPlateHoles'>;
 model:{featuresOf(document:UndoHistory['document']):readonly {
  id:string;kind:string;dependsOn:readonly string[];
  writeTargets:readonly string[];payload:Record<string,unknown>;
 }[]};
 sketch:{validateSketch(source:unknown):SketchDocument;
  solveSketch(source:SketchDocument):SketchSolution};
}>;
export type BoltOrientationResult=
 |Readonly<{kind:'refused';code:string;notCommitted:true;sourceRevision:number;
   holeIds:readonly string[];exactAuthority:false;independentInteroperability:false}>
 |Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;
   invalidation:WorkflowInvalidation;holeIds:readonly string[];
   semanticIds:{sketchId:string;extrudeId:string;cutId:string;bodyId:string};
   movedPivot:{xMm:number;yMm:number};
   pitchCircleRadiusMm:number;boreRadiusMm:number;
   status:'pending_exact_provider';
   nativeHandoff:{kind:'runtime_evaluation_required';cutFeatureId:string;
    bodyId:string;sourceRevision:number;compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false};
   exactAuthority:false;independentInteroperability:false}>;
/** One undoable phase rotation and XY translation of every named bolt-circle
 * hole, including source, after independent solved-pattern provenance checks.
 * Not an associative pattern or physically executed Boolean. */
export declare function orientCircularBoltPattern(
 history:UndoHistory,request:BoltOrientationRequest,
 services:BoltOrientationServices
):BoltOrientationResult;
