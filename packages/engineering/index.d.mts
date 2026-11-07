export const ENGINEERING_DRAWING_VERSION:1;
export const ENGINEERING_DRAWING_FORMAT:'intuit3d.engineering.plate-sheet';
export type PlateDrawingMeasurement={
  format:'intuit3d.engineering.plate-sheet';version:1;
  status:'analytic_sketch_only';units:'mm';nativeExact:false;independentStepQualified:false;
  provenance:{projectId:string;projectRevision:number;sketchFeatureId:string;profileId:string;
    sketchSignature:string;solverStatus:'solved'};
  bounds:{minX:number;minY:number;maxX:number;maxY:number};
  widthMm:number;heightMm:number;
  boundary:{id:string;xMm:number;yMm:number}[];
  holes:{id:string;centerId:string;xMm:number;yMm:number;offsetXmm:number;offsetYmm:number;
    radiusMm:number;diameterMm:number}[];
  holePitchMm:number;analyticAreaMm2:number;
};
export type PlateDrawingRequest={projectJson:string;sketchFeatureId:string;profileId:string;
  title?:string;drawingId?:string};
export function measurePlateFromProject(source:Pick<PlateDrawingRequest,
  'projectJson'|'sketchFeatureId'|'profileId'>):PlateDrawingMeasurement;
export function renderPlateDrawingSvg(measurement:PlateDrawingMeasurement,
  options?:{title?:string;drawingId?:string}):string;
export function createDimensionedPlateSheet(request:PlateDrawingRequest):{
  format:'intuit3d.engineering.plate-sheet';version:1;mimeType:'image/svg+xml';
  filename:string;measurement:PlateDrawingMeasurement;svg:string;
};

/** A source-authored constructive SKETCH fillet (not exact native geometry). */
export type RoundedPlateDrawingMeasurement=PlateDrawingMeasurement & {
  outlineKind:'rounded_plate';
  cornerRadiusMm:number;
  perimeterMm:number;
  boundaryLengths:Array<{id:string;kind:'line'|'arc';lengthMm:number}>;
  boundaryCurves:Array<
    | {kind:'line';id:string;sourceEdgeId:string;
      start:{x:number;y:number};end:{x:number;y:number}}
    | {kind:'arc';id:string;sourceVertexId:string;
      center:{x:number;y:number};start:{x:number;y:number};
      end:{x:number;y:number};radiusMm:number;
      startAngleRad:number;sweepRad:number}
  >;
  provenance:PlateDrawingMeasurement['provenance'] & {
    roundedIntentId:string;roundedIntentSignature:string
  };
};
export function measureRoundedPlateFromProject(source:Pick<PlateDrawingRequest,
  'projectJson'|'sketchFeatureId'|'profileId'>):RoundedPlateDrawingMeasurement;
/**
 * Requires the real project sketch feature to carry an authoritative
 * payload.roundedPlateIntent serialized by SKETCH's v1 fillet-intent API.
 */
export function createRoundedPlateSheet(request:PlateDrawingRequest):{
  format:'intuit3d.engineering.plate-sheet';version:1;mimeType:'image/svg+xml';
  filename:string;measurement:RoundedPlateDrawingMeasurement;svg:string;
};


/** One independently authored radius for each rectangle vertex, from SKETCH v2. */
export type VariableRoundedPlateDrawingMeasurement=PlateDrawingMeasurement & {
  outlineKind:'rounded_plate';
  cornerRadiiMm:Record<string,number>;
  perimeterMm:number;
  boundaryLengths:Array<{id:string;kind:'line'|'arc';lengthMm:number}>;
  boundaryCurves:RoundedPlateDrawingMeasurement['boundaryCurves'];
  provenance:PlateDrawingMeasurement['provenance'] & {
    variableIntentId:string;variableIntentSignature:string
  };
};
export function measureVariableRoundedPlateFromProject(
  source:Pick<PlateDrawingRequest,'projectJson'|'sketchFeatureId'|'profileId'>
):VariableRoundedPlateDrawingMeasurement;
export function createVariableRoundedPlateSheet(request:PlateDrawingRequest):{
  format:'intuit3d.engineering.plate-sheet';version:1;mimeType:'image/svg+xml';
  filename:string;measurement:VariableRoundedPlateDrawingMeasurement;svg:string;
};
