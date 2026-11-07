import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime,RuntimeReport,WorkflowInvalidation} from '@intuit3d/workflow-runtime';
import type {SketchDocument,PlateProfile} from '@intuit3d/sketch';

export declare const FEATURE_OPS_FORMAT: 'intuit3d.feature-ops';
export declare const FEATURE_OPS_VERSION: 1;
export type MountingFlangeHole = Readonly<{id:string;xMm:number;yMm:number;radiusMm:number}>;
export type MountingFlangeSpec = Readonly<{
  widthMm:number;depthMm:number;units:'mm';frame:'local_centered_xy';
  holes:readonly MountingFlangeHole[];
}>;
export type FeatureOpsServices = Readonly<{
  runtime:Pick<WorkflowRuntime,'commit'|'inspect'|'diff'>;
  model:{featuresOf(document:UndoHistory['document']):readonly {id:string;kind:string;dependsOn:readonly string[];writeTargets:readonly string[];payload:Record<string,unknown>}[]};
  sketch:{validateSketch(source:unknown):SketchDocument;solveSketch(source:SketchDocument):{status:string}};
  discovery:{discoverPlateProfiles(source:SketchDocument):{status:string;candidates?:readonly {id:string}[]};
    admitDiscoveredPlateProfile(source:SketchDocument,proposal:unknown,candidateId:string):PlateProfile};
}>;
export type FlangeAuthorRequest = Readonly<{
  format:typeof FEATURE_OPS_FORMAT;version:typeof FEATURE_OPS_VERSION;
  eventId:string;expectedRevision:number;
  sketchFeatureId:string;extrudeFeatureId:string;cutFeatureId:string;targetBodyId:string;
  thicknessMm:number;spec:MountingFlangeSpec;
}>;
export declare function mountingFlangeSketch(
  spec:MountingFlangeSpec, sketch:FeatureOpsServices['sketch'], discovery:FeatureOpsServices['discovery']
):Readonly<{sketch:SketchDocument;profile:PlateProfile;source:'accepted_SKETCH_analytic_only';exactAuthority:false}>;
export declare function authorMountingFlange(
  history:UndoHistory,request:FlangeAuthorRequest,services:FeatureOpsServices
):Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;invalidation:WorkflowInvalidation;
  semanticIds:{sketchId:string;extrudeId:string;cutId:string;bodyId:string};
  nativeHandoff:{kind:'experimental_plate_only';cutFeatureId:string;bodyId:string;sourceRevision:number;
    exactAuthority:false;independentInteroperability:false};
  exactAuthority:false;independentInteroperability:false}>;
export declare function editExtrudeThickness(
  history:UndoHistory,request:Readonly<{eventId:string;featureId:string;expectedRevision:number;thicknessMm:number}>,
  services:Pick<FeatureOpsServices,'runtime'|'model'>
):Readonly<{kind:'committed';history:UndoHistory;report:RuntimeReport;
  previousStatus:string|undefined;status:string|undefined;invalidation:WorkflowInvalidation;
  exactAuthority:false;independentInteroperability:false}>;

/** A full desired authored flange configuration, not a delta or one-shot pattern. */
export type FlangeReconfigurationRequest = Readonly<{
  eventId:string;expectedRevision:number;
  sketchFeatureId:string;extrudeFeatureId:string;cutFeatureId:string;
  targetBodyId:string;thicknessMm:number;spec:MountingFlangeSpec;
}>;
export declare function reconfigureMountingFlange(
  history:UndoHistory,request:FlangeReconfigurationRequest,services:FeatureOpsServices
):Readonly<{
  kind:'committed';history:UndoHistory;report:RuntimeReport;
  invalidation:WorkflowInvalidation;
  semanticIds:{sketchId:string;extrudeId:string;cutId:string;bodyId:string};
  holeChanges:{added:readonly string[];removed:readonly string[];retained:readonly string[]};
  previousThicknessMm:number;thicknessMm:number;
  nativeHandoff:{kind:'experimental_plate_only';cutFeatureId:string;bodyId:string;
    sourceRevision:number;exactAuthority:false;independentInteroperability:false};
  exactAuthority:false;independentInteroperability:false;
}>;
