import {
  createDimensionedPlateSheet,measurePlateFromProject,renderPlateDrawingSvg,
  createRoundedPlateSheet,measureRoundedPlateFromProject,
  type PlateDrawingRequest,type PlateDrawingMeasurement,
  type RoundedPlateDrawingMeasurement
} from '../index.mjs';
const request:PlateDrawingRequest={projectJson:'{}',sketchFeatureId:'sketch.plate',profileId:'plate'};
const measured:PlateDrawingMeasurement=measurePlateFromProject(request);
const svg:string=renderPlateDrawingSvg(measured,{drawingId:'A1'});
const res=createDimensionedPlateSheet(request);
const isNonExact:false=res.measurement.nativeExact;
const mime:'image/svg+xml'=res.mimeType;
void [svg,isNonExact,mime];

const curved:RoundedPlateDrawingMeasurement=measureRoundedPlateFromProject(request);
const curvedSvg:string=renderPlateDrawingSvg(curved,{drawingId:'A2'});
const curvedSheet=createRoundedPlateSheet(request);
const isCurved:'rounded_plate'=curvedSheet.measurement.outlineKind;
const stillNonExact:false=curvedSheet.measurement.nativeExact;
void [curvedSvg,isCurved,stillNonExact];
