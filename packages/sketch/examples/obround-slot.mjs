import {createObroundSlot,inspectObroundSlot,editObroundSlot}
  from '../obround-slot.mjs';
import {serializeArcSketch,parseArcSketch} from '../arc-constraints.mjs';
const summary=(step,result)=>console.log(JSON.stringify({step,solved:result.status==='solved',
  areaMm2:result.profile?.materialAreaMm2??null,
  curveIds:result.profile?.boundary.map(c=>c.id)??[],
  nativeExact:result.profile?.exactBrepAvailable??false}));
const start=createObroundSlot({id:'mounting-slot',overallLengthMm:60,diameterMm:12});
const a=inspectObroundSlot(start,'mounting-slot');summary('created',a);
const updated=editObroundSlot(start,'mounting-slot',
  {kind:'resize',overallLengthMm:80,diameterMm:16},a.sourceSignature);
if(updated.kind!=='accepted')throw new Error(updated.reason);
summary('resized',inspectObroundSlot(updated.sketch,'mounting-slot'));
const moved=editObroundSlot(updated.sketch,'mounting-slot',
  {kind:'move',originXmm:20,originYmm:30},updated.sourceSignature);
if(moved.kind!=='accepted')throw new Error(moved.reason);
const reopened=parseArcSketch(serializeArcSketch(moved.sketch));
summary('moved-reopened',inspectObroundSlot(reopened,'mounting-slot'));
const invalid=editObroundSlot(reopened,'mounting-slot',
  {kind:'resize',overallLengthMm:10,diameterMm:16},serializeArcSketch(reopened));
console.log(JSON.stringify({step:'refused',kind:invalid.kind,reason:invalid.reason}));
