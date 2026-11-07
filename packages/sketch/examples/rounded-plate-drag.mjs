import {plateSketchFixture,serializeSketch,parseSketch} from '../index.mjs';
import {createRoundedPlateIntent,serializeRoundedPlateIntent,
  parseRoundedPlateIntent} from '../rounded-plate.mjs';
import {inspectRoundedPlateHandles,editRoundedPlateHandle} from '../rounded-plate-handles.mjs';

let sketch=plateSketchFixture();
let intent=createRoundedPlateIntent({version:1,id:'fillet:plate',
  edgeIds:['bottom','right','top','left'],holeIds:['holeA','holeB'],radiusMm:8});
const describe=()=>{
  const r=inspectRoundedPlateHandles(sketch,intent);
  console.log(JSON.stringify({status:r.status,areaMm2:r.geometry?.areaMm2??null,
    radiusMm:intent.radiusMm,handles:r.handles.map(h=>h.id)}));
};
const edit=(id,target)=>{
  const state=inspectRoundedPlateHandles(sketch,intent);
  const candidate=editRoundedPlateHandle(sketch,intent,{version:1,
    handleId:id,target,expectedSketchSignature:state.sketchSignature,
    expectedIntentSignature:state.intentSignature});
  if(candidate.status!=='solved')throw Error('edit did not solve: '+JSON.stringify(candidate.diagnostics));
  sketch=candidate.sketch;intent=candidate.intent;
};
describe();
edit('dimension:width',{x:140,y:0});
edit('corner-radius:p1',{x:108,y:0});
edit('hole-center:holeA',{x:40,y:40});
const saved=JSON.stringify({sketch:serializeSketch(sketch),
  intent:serializeRoundedPlateIntent(intent)});
sketch=parseSketch(JSON.parse(saved).sketch);
intent=parseRoundedPlateIntent(JSON.parse(saved).intent);
describe();
