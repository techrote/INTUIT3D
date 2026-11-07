import {plateSketchFixture,serializeSketch} from '../index.mjs';
import {createRoundedPlateIntent} from '../rounded-plate.mjs';
import {inspectRoundedPlateHandles,editRoundedPlateHandle} from '../rounded-plate-handles.mjs';
import type {RoundedPlateHandle, RoundedPlateHandleInspection,
  RoundedPlateHandleEdit, RoundedPlateHandleDrag} from '../rounded-plate-handles.mjs';
const sketch=plateSketchFixture();
const intent=createRoundedPlateIntent({version:1,id:'fillet:plate',edgeIds:[
  'bottom','right','top','left'],holeIds:['holeA','holeB'],radiusMm:8});
const i:RoundedPlateHandleInspection=inspectRoundedPlateHandles(sketch,intent);
const h:RoundedPlateHandle[]=i.handles;
const drag:RoundedPlateHandleDrag={version:1,handleId:'dimension:width',
  target:{x:140,y:0},expectedSketchSignature:serializeSketch(sketch),
  expectedIntentSignature:i.intentSignature};
const r:RoundedPlateHandleEdit=editRoundedPlateHandle(sketch,intent,drag);
if(r.sketch&&r.intent&&r.geometry){
  const area:number=r.geometry.areaMm2;
  const previewOnly:true=r.previewOnly;
  void [area,previewOnly,h];
}
