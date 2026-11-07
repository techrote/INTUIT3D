import {
  createDimensionedPlateSheet,measurePlateFromProject,renderPlateDrawingSvg,
  type PlateDrawingRequest,type PlateDrawingMeasurement
} from '../index.mjs';
const request:PlateDrawingRequest={projectJson:'{}',sketchFeatureId:'sketch.plate',profileId:'plate'};
const measured:PlateDrawingMeasurement=measurePlateFromProject(request);
const svg:string=renderPlateDrawingSvg(measured,{drawingId:'A1'});
const res=createDimensionedPlateSheet(request);
const isNonExact:false=res.measurement.nativeExact;
const mime:'image/svg+xml'=res.mimeType;
void [svg,isNonExact,mime];
