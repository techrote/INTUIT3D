import {createObroundSlot,inspectObroundSlot} from '../obround-slot.mjs';
import {inspectObroundSlotHandles,dragObroundSlotHandle}
  from '../obround-slot-handles.mjs';
import {parseArcSketch,serializeArcSketch} from '../arc-constraints.mjs';
let doc=createObroundSlot({id:'mount',overallLengthMm:60,
  diameterMm:12,originXmm:10,originYmm:20});
const print=(step,source)=>{const profile=inspectObroundSlot(source,'mount').profile;
  console.log(JSON.stringify({step,areaMm2:profile.materialAreaMm2,
    curveIds:profile.boundary.map(c=>c.id),nativeExact:profile.exactBrepAvailable}));};
const apply=(step,kind,target)=>{
  const view=inspectObroundSlotHandles(doc,'mount');
  const result=dragObroundSlotHandle(doc,'mount',{version:1,
    handleId:'mount:'+kind,expectedSignature:view.sourceSignature,target});
  if(result.kind!=='accepted')throw new Error(result.reason);
  doc=result.sketch;print(step,doc);
};
print('initial',doc);
apply('length','length-right',{x:100,y:26});
apply('diameter','diameter-top',{x:40,y:36});
apply('position','position',{x:80,y:50});
doc=parseArcSketch(serializeArcSketch(doc));
print('reopen',doc);
const invalid=dragObroundSlotHandle(doc,'mount',{
  version:1,handleId:'mount:length-right',
  expectedSignature:serializeArcSketch(doc),
  target:{x:0,y:0}});
console.log(JSON.stringify({step:'rejected',kind:invalid.kind,reason:invalid.reason}));
