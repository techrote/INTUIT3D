import type {UndoHistory} from '@intuit3d/model/transactions';
import type {RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {FeatureOpsServices} from './index.mjs';
import type {ExtrusionRevisionFence,ExtrusionReplacement}
  from './extrusion-reconfiguration.d.mts';

export declare const FAMILY_BASE_FORMAT:'intuit3d.feature-ops.machined-family-base';
export declare const FAMILY_BASE_VERSION:1;

export type MachinedFamilyBaseEdit=Readonly<{
  eventId:string;extrudeFeatureId:string;outputBodyId:string;
  from:ExtrusionRevisionFence;to:ExtrusionReplacement;
}>;
export type MachinedFamilyBaseRequest=Readonly<{
  format:typeof FAMILY_BASE_FORMAT;version:1;
  expectedProjectId:string;expectedRevision:number;expectedDocumentFence:string;
  units:'mm';frame:'local_xy';edits:readonly MachinedFamilyBaseEdit[];
}>;
export type MachinedFamilyBaseServices=FeatureOpsServices&Readonly<{
  cutChain:{inspectBodyCutChain(document:UndoHistory['document'],bodyId:string):{
    status:string;projectId:string;revision:number;bodyWriterIds:readonly string[];
    eligibleAfterWriterId:string|null;
  }};
  model:FeatureOpsServices['model']&{serializeProject(document:UndoHistory['document']):string};
}>;
export type FamilyBaseSummary=Readonly<{
  outputBodyId:string;extrusionFeatureId:string;sourceSketchId:string;
  previousDepthMm:number;depthMm:number;selectedProfileId:string;
  orderedCutFeatureIds:readonly string[];reboundCutIds:readonly string[];
  cutDependencyChanges:readonly Readonly<{
    cutFeatureId:string;previousDependencies:readonly string[];
    nextDependencies:readonly string[];
  }>[];
  extrusionStatus:'preview_only';
  cutStatuses:readonly Readonly<{
    featureId:string;status:'pending_exact_provider'|'blocked_dependency'
  }>[];
}>;
export declare function inspectMachinedFamilyBase(
  history:UndoHistory,request:MachinedFamilyBaseRequest,
  services:MachinedFamilyBaseServices
):Readonly<{
  format:typeof FAMILY_BASE_FORMAT;version:1;kind:'family_base_inspection';
  projectId:string;revision:number;documentFence:string;
  units:'mm';frame:'local_xy';bodies:readonly FamilyBaseSummary[];
  eventIds:readonly string[];atomicFamilyEdit:true;
  providerStatus:'pending_exact_provider';
  exactAuthority:false;independentInteroperability:false;
}>;
export declare function applyMachinedFamilyBase(
  history:UndoHistory,request:MachinedFamilyBaseRequest,
  services:MachinedFamilyBaseServices
):Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;bodies:readonly FamilyBaseSummary[];
  eventIds:readonly string[];oneUndoFrame:true;
  providerStatus:'pending_exact_provider';
  nativeHandoff:Readonly<{
    kind:'runtime_evaluation_required';sourceRevision:number;
    bodyIds:readonly string[];compatibility:'not_claimed_ask_RUNTIME_provider';
    exactAuthority:false;independentInteroperability:false;
  }>;
  exactAuthority:false;independentInteroperability:false;
}>;
