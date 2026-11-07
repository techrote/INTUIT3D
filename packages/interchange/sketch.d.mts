import type {SketchDocument,SketchSolution} from '../sketch/index.mjs';
import type {ArcSketchDocument,ArcSketchSolution} from '../sketch/arc-constraints.mjs';
import type {DxfSketch} from './dxf.mjs';
export const SKETCH_INTERCHANGE_VERSION:1;
export interface SketchEntityProvenance {
 dxfEntityId:string;sketchEntityId:string;layer:string;
 sourceEntity:string;sourceHandle?:string;
}
export interface LinearSketchImport {
 version:1;kind:'linear';units:'mm';sourceUnits:'mm'|'in';
 document:SketchDocument;provenance:SketchEntityProvenance[];
 status:'analytic_sketch_only';physicalExactness:'not_evaluated';
}
export interface ArcSketchImport {
 version:1;kind:'arc';units:'mm';sourceUnits:'mm'|'in';
 document:ArcSketchDocument;provenance:SketchEntityProvenance[];
 status:'analytic_sketch_only';physicalExactness:'not_evaluated';
}
export function toLinearSketch(source:DxfSketch):LinearSketchImport;
export function toArcSketch(source:DxfSketch):ArcSketchImport;
export function exportSolvedSketch(
 admitted:LinearSketchImport,document:SketchDocument,solution:SketchSolution
):DxfSketch;
export function exportSolvedSketch(
 admitted:ArcSketchImport,document:ArcSketchDocument,solution:ArcSketchSolution
):DxfSketch;
export function sketchImportPreview(source:DxfSketch,options?:{arcs?:boolean}):{
 admitted:LinearSketchImport|ArcSketchImport;
 solution:SketchSolution|ArcSketchSolution;
 previewOnly:true;stepQualified:false;providerSubmissionReady:false;
 requiresAuthoritativeJournalCommit:true;
};
