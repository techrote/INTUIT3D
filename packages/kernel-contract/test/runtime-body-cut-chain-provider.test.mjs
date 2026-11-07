import test from 'node:test';
import assert from 'node:assert/strict';
import {requestFromRuntimeBodyCutChain}
  from '../src/runtime-body-cut-chain-provider.mjs';

const shape=xy=>({status:'analytic_profile_only',units:'mm',
  outer:xy.map(([x,y],i)=>({id:'p'+i,x,y})),holes:[],
  areaMm2:xy.reduce((sum,[x,y],i)=>{
    const [nx,ny]=xy[(i+1)%xy.length];return sum+x*ny-nx*y;
  },0)/2});
const bracket=shape([[0,0],[120,0],[120,25],[30,25],[30,80],[0,80]]);
const slot=shape([[10,8],[40,8],[40,18],[10,18]]);
const pocket=shape([[10,35],[23,35],[23,60],[10,60]]);
const sketchEntry=(featureId,profile)=>({featureId,kind:'sketch',
  modelStatus:'ready',status:'analytic_profile_only',
  evidence:'sketch_analytic_only',sketchSignature:'solved.'+featureId,
  profile});
const cutEntry=(featureId,status)=>({featureId,kind:'cut',modelStatus:'ready',status});
function fixture(){
  const features=[
    {id:'sketch.bracket',kind:'sketch',dependsOn:[],writeTargets:[]},
    {id:'sketch.slot',kind:'sketch',dependsOn:[],writeTargets:[]},
    {id:'sketch.pocket',kind:'sketch',dependsOn:[],writeTargets:[]},
    {id:'extrude.bracket',kind:'extrude',dependsOn:['sketch.bracket'],
      writeTargets:['body.bracket'],payload:{sourceSketchId:'sketch.bracket',
        units:'mm',frame:'local_xy'}},
    {id:'cut.slot',kind:'cut',dependsOn:['extrude.bracket','sketch.slot'],
      writeTargets:['body.bracket'],payload:{sourceSketchId:'sketch.slot',
        targetBodyId:'body.bracket',units:'mm',frame:'local_xy'}},
    {id:'cut.pocket',kind:'cut',dependsOn:['cut.slot','sketch.pocket'],
      writeTargets:['body.bracket'],payload:{sourceSketchId:'sketch.pocket',
        targetBodyId:'body.bracket',throughAll:false,depthMm:3,
        units:'mm',frame:'local_xy'}},
    {id:'extrude.spacer',kind:'extrude',dependsOn:[],writeTargets:['body.spacer']}
  ];
  const report={format:'intuit3d.workflow-runtime-evaluation',version:1,
    exactGeometryAvailable:false,projectId:'demo',revision:7,features:[
      sketchEntry('sketch.bracket',bracket),
      sketchEntry('sketch.slot',slot),
      sketchEntry('sketch.pocket',pocket),
      {featureId:'extrude.bracket',kind:'extrude',modelStatus:'ready',
        status:'preview_only',evidence:'sketch_analytic_only',
        sourceSketchId:'sketch.bracket',bodyId:'body.bracket',
        thicknessMm:8,profile:bracket},
      cutEntry('cut.slot','pending_exact_provider'),
      cutEntry('cut.pocket','blocked_dependency')
    ]};
  return {history:{document:{projectId:'demo',revision:7}},features,report};
}
function request(f){
  return requestFromRuntimeBodyCutChain(f.history,'body.bracket',{
    runtime:{inspect:()=>f.report},model:{featuresOf:()=>f.features},
    requestId:'native.chain',exportStep:true});
}
test('uses named writer dependencies (not chronology) and admitted cut profiles',()=>{
  const f=fixture();
  // Writer order in the feature list is deliberately scrambled.
  [f.features[4],f.features[5]]=[f.features[5],f.features[4]];
  const q=request(f);
  assert.equal(q.protocol,'intuit3d/kernel/profile-body-cut-chain-v3');
  assert.equal(q.targetBodyId,'body.bracket');
  assert.equal(q.baseExtrude.profile.materialAreaMm2,4650);
  assert.deepEqual(q.cuts.map(x=>x.cutFeatureId),['cut.slot','cut.pocket']);
  assert.deepEqual(q.cuts.map(x=>x.cutDepthMm),[8,3]);
  assert.deepEqual(q.cuts.map(x=>x.cutTool.profile.materialAreaMm2),[300,325]);
  assert.deepEqual(q.cuts.map(x=>x.cutTool.revision),[7,7]);
  assert.equal(q.exportStep,true);
  assert.equal(q.revision,7);
});
test('retrospective thickness edit updates through tool and retains blind floor',()=>{
  const f=fixture();f.report.features.find(x=>x.featureId==='extrude.bracket').thicknessMm=12;
  const q=request(f);
  assert.deepEqual(q.cuts.map(x=>x.cutDepthMm),[12,3]);
  assert.equal(q.baseExtrude.thicknessMm,12);
});
test('refuses unordered or ambiguous body writers, unsupported dependencies and stale reports',()=>{
  const f=fixture();
  const cases=[
    x=>{x.features.find(v=>v.id==='cut.pocket').dependsOn=['extrude.bracket','sketch.pocket'];},
    x=>{x.features.find(v=>v.id==='cut.pocket').writeTargets=['body.other'];},
    x=>{x.features.find(v=>v.id==='cut.pocket').payload.targetBodyId='body.other';},
    x=>{x.features.find(v=>v.id==='cut.pocket').payload.depthMm=10;},
    x=>{x.report.revision=6;},
    x=>{x.report.features.find(v=>v.featureId==='sketch.pocket').status='unsolved_sketch';},
    x=>{x.report.features.find(v=>v.featureId==='cut.pocket').modelStatus='blocked';},
    x=>{x.features.push({id:'cut.slot.tool',kind:'dummy',writeTargets:[]});},
    x=>{x.report.features.find(v=>v.featureId==='sketch.slot').profile={...slot,areaMm2:301};}
  ];
  for(const mutate of cases){
    const candidate=fixture();mutate(candidate);
    assert.throws(()=>request(candidate),TypeError);
  }
  assert.equal(request(f).cuts.length,2);
});
