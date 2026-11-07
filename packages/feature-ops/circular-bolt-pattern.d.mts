import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
export declare const CIRCULAR_BOLT_PATTERN_FORMAT:'intuit3d.feature-ops.circular-bolt-pattern';
export declare const CIRCULAR_BOLT_PATTERN_VERSION:1;
export type CircularBoltPatternRequest=Readonly<{
  format:typeof CIRCULAR_BOLT_PATTERN_FORMAT;
  version:typeof CIRCULAR_BOLT_PATTERN_VERSION;
  eventId:string;expectedProjectId:string;expectedRevision:number;
  units:'mm';frame:'local_xy';
  sketchFeatureId:string;extrudeFeatureId:string;cutFeatureId:string;
  targetBodyId:string;
  pattern:Readonly<{
    sourceHoleId:string;idPrefix:string;instances:number;
    pivotXmm:number;pivotYmm:number;sweepDegrees:number;
  }>;
}>;
export type CircularBoltPatternServices=Readonly<{
  runtime:Pick<WorkflowRuntime,'inspect'|'patternCircularHoles'>;
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];
    writeTargets:readonly string[];payload:Record<string,unknown>;
  }[]};
}>;
export type CircularBoltPatternResult=
  |Readonly<{kind:'refused';code:string;notCommitted:true;sourceRevision:number;
    generatedHoleIds:readonly string[];exactAuthority:false;
    independentInteroperability:false}>
  |Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;
    invalidation:WorkflowInvalidation;generatedHoleIds:readonly string[];
    semanticIds:{sketchId:string;extrudeId:string;cutId:string;bodyId:string};
    pattern:CircularBoltPatternRequest['pattern'];
    status:'pending_exact_provider';
    nativeHandoff:{kind:'runtime_evaluation_required';cutFeatureId:string;
      bodyId:string;sourceRevision:number;
      compatibility:'not_claimed_ask_RUNTIME_provider';
      exactAuthority:false;independentInteroperability:false};
    exactAuthority:false;independentInteroperability:false}>;
/** A one-shot, revision-fenced bolt-circle pattern of solved SKETCH holes.
 * Copies have stable independent IDs. Not an associative/physical CAD feature. */
export declare function authorCircularBoltPattern(
  history:UndoHistory,request:CircularBoltPatternRequest,
  services:CircularBoltPatternServices
):CircularBoltPatternResult;
