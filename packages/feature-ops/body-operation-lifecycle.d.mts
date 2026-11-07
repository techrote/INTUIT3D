import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {FeatureRemovalImpact,FeatureLifecyclePreview,
  FeatureRemovalRequest,FeatureRestorationRequest} from '@intuit3d/model/feature-lifecycle';
export declare const BODY_OPERATION_LIFECYCLE_FORMAT:
  'intuit3d.feature-ops.body-operation-lifecycle';
export declare const BODY_OPERATION_LIFECYCLE_VERSION:1;
export type BodyOperationSelection=Readonly<{
  format:typeof BODY_OPERATION_LIFECYCLE_FORMAT;
  version:typeof BODY_OPERATION_LIFECYCLE_VERSION;
  expectedProjectId:string;expectedRevision:number;
  units:'mm';frame:'local_xy';
  targetBodyId:string;featureId:string;
}>;
export type BodyOperationRemoval=BodyOperationSelection&Readonly<{
  expectedDependents:readonly string[];
  mode:'reject_if_referenced'|'keep_dependents_pending'|'cascade_descendants';
  confirmCascade:boolean;eventIds:readonly string[];
}>;
export type BodyOperationRestore=Readonly<{
  format:typeof BODY_OPERATION_LIFECYCLE_FORMAT;
  version:typeof BODY_OPERATION_LIFECYCLE_VERSION;
  expectedProjectId:string;expectedRevision:number;units:'mm';frame:'local_xy';
  targetBodyId:string;featureIds:readonly string[];eventIds:readonly string[];
  admission:'require_ready'|'permit_unresolved';
}>;
export type BodyOperationLifecycleServices=Readonly<{
  model:{featuresOf(document:UndoHistory['document']):readonly {
    id:string;kind:string;dependsOn:readonly string[];
    writeTargets:readonly string[];payload:Record<string,unknown>;
  }[]};
  runtime:Pick<WorkflowRuntime,'inspect'|'diff'>;
  lifecycle:{
    inspectFeatureRemoval(document:UndoHistory['document'],featureId:string):FeatureRemovalImpact;
    previewFeatureRemoval(document:UndoHistory['document'],
      request:FeatureRemovalRequest):FeatureLifecyclePreview;
    previewFeatureRestoration(document:UndoHistory['document'],
      request:FeatureRestorationRequest):FeatureLifecyclePreview;
    commitUndoableFeatureRemoval(history:UndoHistory,
      request:FeatureRemovalRequest):UndoHistory;
    commitUndoableFeatureRestoration(history:UndoHistory,
      request:FeatureRestorationRequest):UndoHistory;
  };
}>;
export type BodyOperationImpact=Readonly<{
  format:typeof BODY_OPERATION_LIFECYCLE_FORMAT;version:1;
  kind:'impact';projectId:string;revision:number;bodyId:string;
  featureId:string;featureKind:string;
  directDependents:readonly string[];transitiveDependents:readonly string[];
  cascadeIds:readonly string[];dependentBodyWriters:readonly string[];
  exactAuthority:false;
}>;
export type BodyOperationRemovalResult=Readonly<{
  kind:'committed';action:'remove';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;impact:FeatureRemovalImpact;
  removedFeatureIds:readonly string[];
  retainedDependentStatuses:readonly {featureId:string;status:string}[];
  structuralInvalidation:FeatureLifecyclePreview['invalidation'];
  nativeHandoff:Readonly<{kind:'invalidate_previous_body_geometry';
    bodyId:string;sourceRevision:number;exactAuthority:false}>;
  exactAuthority:false;independentInteroperability:false;
}>;
export type BodyOperationRestoreResult=Readonly<{
  kind:'committed';action:'restore';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;restoredFeatureIds:readonly string[];
  statuses:readonly {featureId:string;status:string}[];
  structuralInvalidation:FeatureLifecyclePreview['invalidation'];
  nativeHandoff:Readonly<{kind:'runtime_evaluation_required';
    bodyId:string;sourceRevision:number;
    compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false}>;
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function inspectSelectedBodyRemoval(
  history:UndoHistory,request:BodyOperationSelection,
  services:BodyOperationLifecycleServices):BodyOperationImpact;
export declare function removeSelectedBodyOperation(
  history:UndoHistory,request:BodyOperationRemoval,
  services:BodyOperationLifecycleServices):BodyOperationRemovalResult;
export declare function restoreSelectedBodyOperations(
  history:UndoHistory,request:BodyOperationRestore,
  services:BodyOperationLifecycleServices):BodyOperationRestoreResult;
