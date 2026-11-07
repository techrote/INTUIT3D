
import {createVariableRoundedPlateSheet,measureVariableRoundedPlateFromProject,
  renderPlateDrawingSvg,
  type PlateDrawingRequest,type VariableRoundedPlateDrawingMeasurement} from '../index.mjs';
const req:PlateDrawingRequest={projectJson:'{}',sketchFeatureId:'sketch.plate',profileId:'plate'};
const curved:VariableRoundedPlateDrawingMeasurement=measureVariableRoundedPlateFromProject(req);
const svg:string=renderPlateDrawingSvg(curved);
const sheet=createVariableRoundedPlateSheet(req);
const radius:number=sheet.measurement.cornerRadiiMm['plate:p0'];
const stillNonExact:false=sheet.measurement.nativeExact;
void [svg,radius,stillNonExact];
