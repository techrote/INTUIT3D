/** Versioned nonlinear analytic-arc sketch; NOT OCCT/B-rep or STEP admission. */
export const ARC_SKETCH_VERSION: 1;
export const ARC_SKETCH_FORMAT: 'intuit3d.arc-sketch';
export type ArcPoint={id:string;x:number;y:number};
export type ArcLine={id:string;start:string;end:string};
export type ArcPrimitive={id:string;center:string;start:string;end:string;direction:'ccw'|'cw'};
export type ArcCircle={id:string;center:string;radiusMm:number};
export type ArcConstraint=
 | {id:string;kind:'fixed';point:string;x:number;y:number}
 | {id:string;kind:'horizontal'|'vertical';line:string}
 | {id:string;kind:'distanceX'|'distanceY';a:string;b:string;value:number}
 | {id:string;kind:'coincident';a:string;b:string}
 | {id:string;kind:'arcRadius';arc:string;value:number}
 | {id:string;kind:'equalArcRadius';a:string;b:string}
 | {id:string;kind:'tangent';arc:string;line:string;at:'start'|'end'};
export interface ArcSketchDocument {
  format:'intuit3d.arc-sketch';version:1;units:'mm';
  points:ArcPoint[];lines:ArcLine[];arcs:ArcPrimitive[];
  circles:ArcCircle[];constraints:ArcConstraint[];
}
export interface ArcCurve extends ArcPrimitive {
  startAngleRad:number;sweepRad:number;radiusMm:number;
}
export interface ArcSketchGeometry {
  units:'mm';points:ArcPoint[];lines:ArcLine[];arcs:ArcCurve[];circles:ArcCircle[];
}
export type ArcSolveStatus='solved'|'underconstrained'|'conflicted'|'unresolved'|'numerical_failure';
export type ArcDiagnostic={code:string;candidates?:string[];count?:number;maxResidualMm?:number};
export interface ArcSketchSolution {
  version:1;sourceSignature:string;
  solverKind:'bounded_nonlinear_levenberg_marquardt';
  previewOnly:true;exactGeometryAvailable:false;
  numericalPolicy:{residualToleranceMm:number;rankRelativeTolerance:number;maxIterations:number};
  status:ArcSolveStatus;geometry:ArcSketchGeometry|null;
  rank:number|null;degreesOfFreedom:number|null;
  redundantEquations:number|null;iterations:number;diagnostics:ArcDiagnostic[];
}
export type ArcPreviewCurve=
 | {kind:'line';id:string;start:{x:number;y:number};end:{x:number;y:number}}
 | {kind:'arc';id:string;center:{x:number;y:number};start:{x:number;y:number};
    end:{x:number;y:number};radiusMm:number;startAngleRad:number;sweepRad:number};
export interface ArcWirePreview {
  version:1;status:'analytic_wire_preview_only';previewOnly:true;
  nativeProfileAdmissible:false;globalSelfIntersectionChecked:false;
  units:'mm';sourceSignature:string;boundary:ArcPreviewCurve[];
  holes:Array<{id:string;centerId:string;x:number;y:number;radiusMm:number}>;
  signedBoundaryAreaMm2:number;estimatedMaterialAreaMm2:number;
}
export function createArcSketch(source:unknown):ArcSketchDocument;
export function serializeArcSketch(doc:ArcSketchDocument):string;
export function parseArcSketch(json:string):ArcSketchDocument;
export function editArcConstraint(doc:ArcSketchDocument,id:string,
  patch:Partial<{value:number;x:number;y:number}>):ArcSketchDocument;
export function editArcCircleRadius(doc:ArcSketchDocument,id:string,radiusMm:number):ArcSketchDocument;
export function solveArcSketch(source:ArcSketchDocument):ArcSketchSolution;
export function suggestArcDrag(source:ArcSketchDocument,pointId:string,
  target:{x:number;y:number}):{
    version:1;sourceSignature:string;previewOnly:true;status:ArcSolveStatus;
    geometry:ArcSketchGeometry|null;diagnostics:ArcDiagnostic[];
    degreesOfFreedom:number|null;target:{pointId:string;x:number;y:number};
  };
export function buildArcWirePreview(source:ArcSketchDocument,solution:ArcSketchSolution,
  boundaryIds:string[],holeIds?:string[]):ArcWirePreview;
export function roundedPlateArcFixture(options?:{
  widthMm?:number;heightMm?:number;cornerRadiiMm?:number[];
  holeRadiiMm?:number[];
}):ArcSketchDocument;
