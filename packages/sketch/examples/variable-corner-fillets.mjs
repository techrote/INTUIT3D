import {plateSketchFixture,editConstraint,serializeSketch,parseSketch} from '../index.mjs';
import {
  createVariableRoundedPlateIntent,editVariableRoundedPlateRadius,
  serializeVariableRoundedPlateIntent,parseVariableRoundedPlateIntent,
  solveVariableRoundedPlate,inspectVariableRoundedPlateHandles,
  dragVariableRoundedPlateCorner
} from '../rounded-plate.mjs';

let sketch=plateSketchFixture();
let intent=createVariableRoundedPlateIntent({version:2,id:'fillet:plate',
  edgeIds:['bottom','right','top','left'],holeIds:['holeA','holeB'],
  cornerRadii:[
    {vertexId:'p0',radiusMm:4},{vertexId:'p1',radiusMm:8},
    {vertexId:'p2',radiusMm:12},{vertexId:'p3',radiusMm:6}
  ]});
const report=step=>{
  const v=solveVariableRoundedPlate(sketch,intent);
  if(v.status!=='solved')throw Error(step+' failed: '+JSON.stringify(v.diagnostics));
  console.log(JSON.stringify({step,status:v.status,previewOnly:v.previewOnly,
    cornerRadiiMm:v.geometry.cornerRadiiMm,areaMm2:v.geometry.areaMm2,
    arcIds:v.geometry.boundary.filter(e=>e.kind==='arc').map(e=>e.id),
    holeIds:v.geometry.holes.map(e=>e.id)}));
};
report('initial');
const inspection=inspectVariableRoundedPlateHandles(sketch,intent);
const candidate=dragVariableRoundedPlateCorner(sketch,intent,{version:2,
  handleId:'corner-radius:p1',target:{x:105,y:0},
  expectedSketchSignature:inspection.sketchSignature,
  expectedIntentSignature:inspection.intentSignature});
if(candidate.status!=='solved')throw Error('drag not solved');
intent=candidate.intent;
report('drag-p1-only');
sketch=editConstraint(sketch,'width',{value:145});
intent=editVariableRoundedPlateRadius(intent,'p2',10);
report('width-and-p2');
const archive=JSON.stringify({sketch:serializeSketch(sketch),
  intent:serializeVariableRoundedPlateIntent(intent)});
const loaded=JSON.parse(archive);
sketch=parseSketch(loaded.sketch);
intent=parseVariableRoundedPlateIntent(loaded.intent);
report('reopened');
