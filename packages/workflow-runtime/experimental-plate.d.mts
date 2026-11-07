import type {ProjectDocument, Feature} from '@intuit3d/model';
import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime} from './index.mjs';

export declare const EXPERIMENTAL_PLATE_WORKFLOW_FORMAT:'intuit3d.workflow-experimental-plate';
export declare const EXPERIMENTAL_PLATE_WORKFLOW_VERSION:1;
export type ExperimentalPlateGeometry = Readonly<{
  width:number; depth:number; thickness:number;
  holes:readonly Readonly<{x:number;y:number;radius:number}>[];
}>;
export interface PlateWorkflowOptions {
  cutFeatureId:string;
  requestId:string;
  readCurrentHistory:()=>UndoHistory;
  exportStep?:boolean;
  stepOutput?:string;
  timeoutMs?:number;
  signal?:AbortSignal;
}
export type ExperimentalPlateWorkflowResult = Readonly<{
  format:typeof EXPERIMENTAL_PLATE_WORKFLOW_FORMAT;
  version:1;
  exactAuthority:false;
  independentInteroperability:false;
}> & (
  Readonly<{
    kind:'unresolved';
    code:string; reason:string; projectId?:string;revision?:number;
    cutFeatureId?:string;artifact:null;
  }> |
  Readonly<{
    kind:'experimental_plate_evaluated';
    projectId:string;revision:number;cutFeatureId:string;
    extrudeFeatureId:string;sourceSketchId:string;bodyId:string;
    requestId:string;intendedPlate:ExperimentalPlateGeometry;
    backend:string;occtVersion:string;
    observed:unknown;
    artifact:unknown;
    note:string;
  }>
);
export interface ExperimentalPlateWorkflow {
  evaluate(history:UndoHistory,options:PlateWorkflowOptions):Promise<ExperimentalPlateWorkflowResult>;
}
/** Only rectangular, axis-aligned, single-profile SKETCH plates supported. */
export declare function rectanglePlateFromProfile(
  profile: {status:'analytic_profile_only';units:'mm';outer:readonly Readonly<{x:number;y:number}>[];
    holes:readonly Readonly<{x:number;y:number;radius:number}>[]},
  thicknessMm:number,
):ExperimentalPlateGeometry;
/**
 * Pure browser-safe adapter accepting the trusted Node-only kernel provider
 * as a callback. The returned experimental status never establishes product
 * exactness or independent STEP interchange.
 */
export declare function createExperimentalPlateWorkflow<Request extends {
  protocol:string;requestId:string;featureId:string;revision:number;units:'mm';
  plate:ExperimentalPlateGeometry;exportStep:boolean;
}>(services:Readonly<{
  runtime:Pick<WorkflowRuntime,'inspect'>;
  model:{featuresOf(document:ProjectDocument):readonly Feature[]};
  plateContract:{
    PLATE_PROTOCOL:string;
    EXPERIMENTAL_BACKEND:string;
    EXPERIMENTAL_OCCT_VERSION:string;
    parsePlateRequest(raw:unknown):Request;
  };
  runExperimentalPlate:(request:Request,options:{
    readCurrentRevision:()=>number;
    stepOutput?:string;
    timeoutMs:number;
    signal?:AbortSignal;
  })=>Promise<unknown>;
}>):ExperimentalPlateWorkflow;
