import {plateSketchFixture} from '../index.mjs';
import {
  createVariableRoundedPlateIntent,editVariableRoundedPlateRadius,
  solveVariableRoundedPlate,inspectVariableRoundedPlateHandles,
  dragVariableRoundedPlateCorner,serializeVariableRoundedPlateIntent,
  parseVariableRoundedPlateIntent
} from '../rounded-plate.mjs';
import type {VariableRoundedPlateIntent,VariableRoundedPlateEdit,
  VariableRoundedPlateProfile,VariableRoundedPlateInspection} from '../rounded-plate.mjs';

const sketch=plateSketchFixture();
const authored:VariableRoundedPlateIntent=createVariableRoundedPlateIntent({
  version:2,id:'fillet:plate',edgeIds:['bottom','right','top','left'],
  holeIds:['holeA','holeB'],cornerRadii:[
    {vertexId:'p0',radiusMm:4},{vertexId:'p1',radiusMm:8},
    {vertexId:'p2',radiusMm:12},{vertexId:'p3',radiusMm:6}
  ]
});
const restored=parseVariableRoundedPlateIntent(serializeVariableRoundedPlateIntent(authored));
const next=editVariableRoundedPlateRadius(restored,'p1',10);
const solve=solveVariableRoundedPlate(sketch,next);
const profile:VariableRoundedPlateProfile|null=solve.geometry;
const inspection:VariableRoundedPlateInspection=inspectVariableRoundedPlateHandles(sketch,next);
const edit:VariableRoundedPlateEdit=dragVariableRoundedPlateCorner(sketch,next,{
  version:2,handleId:'corner-radius:p1',target:{x:110,y:0},
  expectedSketchSignature:inspection.sketchSignature,
  expectedIntentSignature:inspection.intentSignature
});
void [profile,edit,inspection,solve];
