import test from 'node:test';
import assert from 'node:assert/strict';
import {requestFromRuntimeOcct8RectCuts,runPinnedRuntimeOcct8RectCuts}
  from '../src/runtime-occt8-cut-provider.mjs';

function shape(coords,holes=[]) {
  const area=coords.reduce((s,[x,y],i)=>{
    const [nx,ny]=coords[(i+1)%coords.length];return s+x*ny-nx*y;
  },0)/2;
  return {status:'analytic_profile_only',units:'mm',
    outer:coords.map(([x,y],i)=>({id:'p'+i,x,y})),
    holes:holes.map((h,i)=>({id:'circle'+i,centerId:'center'+i,...h})),
    areaMm2:area-holes.reduce((s,h)=>s+Math.PI*h.radius*h.radius,0)};
}
const plate=shape([[-60,-40],[60,-40],[60,40],[-60,40]],
  [{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]);
const window=shape([[0,-24],[10,-24],[10,-16],[0,-16]]);
const pocket=shape([[-16,15],[-4,15],[-4,25],[-16,25]]);
const sketch=(featureId,profile)=>({featureId,kind:'sketch',modelStatus:'ready',
  status:'analytic_profile_only',evidence:'sketch_analytic_only',
  sketchSignature:'solved.'+featureId,profile});
function fixture(){
  const features=[
    {id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[]},
    {id:'sketch.window',kind:'sketch',dependsOn:[],writeTargets:[]},
    {id:'sketch.pocket',kind:'sketch',dependsOn:[],writeTargets:[]},
    {id:'extrude.plate',kind:'extrude',dependsOn:['sketch.plate'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',
        units:'mm',frame:'local_xy'}},
    {id:'cut.window',kind:'cut',dependsOn:['extrude.plate','sketch.window'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.window',
        targetBodyId:'body.plate',units:'mm',frame:'local_xy'}},
    {id:'cut.pocket',kind:'cut',dependsOn:['cut.window','sketch.pocket'],
      writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.pocket',
        targetBodyId:'body.plate',throughAll:false,depthMm:3,
        units:'mm',frame:'local_xy'}}
  ];
  const report={format:'intuit3d.workflow-runtime-evaluation',version:1,
    exactGeometryAvailable:false,projectId:'plate.test',revision:8,features:[
      sketch('sketch.plate',plate),
      sketch('sketch.window',window),
      sketch('sketch.pocket',pocket),
      {featureId:'extrude.plate',kind:'extrude',modelStatus:'ready',
        status:'preview_only',evidence:'sketch_analytic_only',
        sourceSketchId:'sketch.plate',bodyId:'body.plate',
        thicknessMm:8,profile:plate},
      {featureId:'cut.window',kind:'cut',modelStatus:'ready',status:'pending_exact_provider'},
      {featureId:'cut.pocket',kind:'cut',modelStatus:'ready',status:'blocked_dependency'},
    ]};
  return {history:{document:{projectId:'plate.test',revision:8}},features,report};
}
const opts=f=>({runtime:{inspect:()=>f.report},
  model:{featuresOf:()=>f.features},requestId:'native.pockets',exportStep:true});

test('actual RUNTIME geometry converts to pinned C++ two-cut request without chronology inference',()=>{
  const f=fixture();
  [f.features[4],f.features[5]]=[f.features[5],f.features[4]];
  const q=requestFromRuntimeOcct8RectCuts(f.history,'body.plate',opts(f));
  assert.equal(q.protocol,'intuit3d/kernel/plate-cut-chain-v1');
  assert.deepEqual(q.plate,{width:120,depth:80,thickness:8,
    holes:[{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]});
  assert.equal(q.featureId,'body.plate');
  assert.deepEqual(q.cuts.map(c=>[c.featureId,c.cutDepthMm]),[
    ['cut.window',8],['cut.pocket',3]]);
});

test('retrospective thickness propagates to through-cut but preserves authored blind depth',()=>{
  const f=fixture();f.report.features.find(x=>x.featureId==='extrude.plate').thicknessMm=12;
  const q=requestFromRuntimeOcct8RectCuts(f.history,'body.plate',opts(f));
  assert.equal(q.plate.thickness,12);
  assert.deepEqual(q.cuts.map(c=>c.cutDepthMm),[12,3]);
});

test('refuses unsupported base profiles and contradictory writer ordering',()=>{
  const f=fixture();
  const skew={...plate,outer:[...plate.outer]};
  skew.outer[0]={...skew.outer[0],x:-58};
  const bad=fixture();
  bad.report.features.find(x=>x.featureId==='sketch.plate').profile=skew;
  bad.report.features.find(x=>x.featureId==='extrude.plate').profile=skew;
  assert.throws(()=>requestFromRuntimeOcct8RectCuts(bad.history,'body.plate',opts(bad)),TypeError);
  f.features.find(x=>x.id==='cut.pocket').dependsOn=['extrude.plate','sketch.pocket'];
  assert.throws(()=>requestFromRuntimeOcct8RectCuts(f.history,'body.plate',opts(f)),TypeError);
});

test('native failure is retained as unresolved, not authoritative body result',async()=>{
  const f=fixture();
  const response=await runPinnedRuntimeOcct8RectCuts(f.history,'body.plate',{
    ...opts(f),workerExecutable:'/unavailable/intuit3d_occt8_plate',
    readCurrentRevision:()=>8,
  });
  assert.equal(response.kind,'unresolved');
  assert.equal(response.exactAuthority,false);
  assert.equal(response.semanticBodyId,'body.plate');
});
