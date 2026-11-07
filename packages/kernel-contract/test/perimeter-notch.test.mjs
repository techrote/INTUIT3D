import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateBodyCutRequest} from '../src/local-body-cut-provider.mjs';

const fixture=new URL('../../../native/examples/l-bracket-separate-cut.request.json',import.meta.url);
const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y],i,a)=>({
  id:'line.'+i,kind:'line',start:{x,y},
  end:{x:a[(i+1)%4][0],y:a[(i+1)%4][1]}}));
async function notch(){
  const q=JSON.parse(await readFile(fixture,'utf8'));
  q.protocol='intuit3d/kernel/profile-body-notch-v4';
  q.cutDepthMm=8;
  q.baseExtrude.profile.boundary=rect(-60,-40,60,40);
  q.baseExtrude.profile.holes=[
    {id:'bore.left',centerId:'center.left',x:-30,y:0,radiusMm:6},
    {id:'bore.right',centerId:'center.right',x:30,y:0,radiusMm:6}
  ];
  q.baseExtrude.profile.signedBoundaryAreaMm2=9600;
  q.baseExtrude.profile.materialAreaMm2=9600-2*Math.PI*36;
  q.cutTool.profile.boundary=rect(50,-10,70,10);
  q.cutTool.profile.signedBoundaryAreaMm2=400;
  q.cutTool.profile.materialAreaMm2=400;
  return q;
}
test('v4 admits a real through/notch and a blind edge pocket without changing v2',async()=>{
  const q=await notch();
  assert.equal(validateBodyCutRequest(q),q);
  assert.equal(validateBodyCutRequest({...q,cutDepthMm:3}).cutDepthMm,3);
  const old={...q,protocol:'intuit3d/kernel/profile-body-cut-v2'};
  assert.equal(validateBodyCutRequest(old),old);
});
test('v4 prevents unsupported and no-material perimeter edits before launch',async()=>{
  const q=await notch(),invalid=[
    {...q,cutDepthMm:0},
    {...q,cutDepthMm:9},
    {...q,cutDepthMm:true},
    {...q,cutTool:{...q.cutTool,profile:{...q.cutTool.profile,
      boundary:rect(80,-10,100,10)}}},
    {...q,cutTool:{...q.cutTool,profile:{...q.cutTool.profile,
      boundary:rect(20,-10,40,10)}}},
    {...q,cutTool:{...q.cutTool,profile:{...q.cutTool.profile,
      boundary:rect(30,-10,70,10),signedBoundaryAreaMm2:800,
      materialAreaMm2:800}}},
    {...q,baseExtrude:{...q.baseExtrude,profile:{...q.baseExtrude.profile,
      boundary:q.baseExtrude.profile.boundary.slice(0,3)}}},
    {...q,cutTool:{...q.cutTool,profile:{...q.cutTool.profile,
      boundary:q.cutTool.profile.boundary.map((edge,i)=>i===0?
        {...edge,kind:'arc'}:edge)}}}
  ];
  for(const candidate of invalid)
    assert.throws(()=>validateBodyCutRequest(candidate),Error);
});
