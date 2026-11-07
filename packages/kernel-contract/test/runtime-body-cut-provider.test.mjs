import test from 'node:test';
import assert from 'node:assert/strict';
import {requestFromRuntimeBodyCut} from '../src/runtime-body-cut-provider.mjs';

const polygon=(xy)=>xy.map(([x,y],i)=>({id:'p'+i,x,y}));
const shape=(outer,holes=[])=>({status:'analytic_profile_only',units:'mm',
  outer:polygon(outer),holes,areaMm2:
    outer.reduce((sum,[x,y],i)=>{const [u,v]=outer[(i+1)%outer.length];
      return sum+x*v-u*y;},0)/2-
    holes.reduce((sum,h)=>sum+Math.PI*h.radius*h.radius,0)});
const base=shape([[-80,-50],[80,-50],[80,-10],[10,-10],[10,50],[-80,50]],
  [{id:'bore',centerId:'bore.center',x:-50,y:0,radius:6}]);
const window=shape([[-42,-34],[-26,-34],[-26,-22],[-42,-22]]);
const fresh=()=>({
  history:{document:{projectId:'demo',revision:4}},
  report:{format:'intuit3d.workflow-runtime-evaluation',version:1,projectId:'demo',
    revision:4,exactGeometryAvailable:false,features:[
      {featureId:'sketch.bracket',kind:'sketch',modelStatus:'ready',
        status:'analytic_profile_only',evidence:'sketch_analytic_only',
        sketchSignature:'solved.bracket',profile:base},
      {featureId:'sketch.window',kind:'sketch',modelStatus:'ready',
        status:'analytic_profile_only',evidence:'sketch_analytic_only',
        sketchSignature:'solved.window',profile:window},
      {featureId:'extrude.bracket',kind:'extrude',modelStatus:'ready',
        status:'preview_only',evidence:'sketch_analytic_only',
        sourceSketchId:'sketch.bracket',bodyId:'body.bracket',
        thicknessMm:8,profile:base},
      {featureId:'cut.window',kind:'cut',modelStatus:'ready',
        status:'pending_exact_provider'}]},
  features:[
    {id:'sketch.bracket',kind:'sketch',writeTargets:[],dependsOn:[]},
    {id:'sketch.window',kind:'sketch',writeTargets:[],dependsOn:[]},
    {id:'extrude.bracket',kind:'extrude',writeTargets:['body.bracket'],
      dependsOn:['sketch.bracket'],payload:{sourceSketchId:'sketch.bracket',
        units:'mm',frame:'local_xy'}},
    {id:'cut.window',kind:'cut',writeTargets:['body.bracket'],
      dependsOn:['extrude.bracket','sketch.window'],
      payload:{sourceSketchId:'sketch.window',targetBodyId:'body.bracket',
        units:'mm',frame:'local_xy'}}
  ]
});
const request=(s)=>requestFromRuntimeBodyCut(s.history,'cut.window',{
  runtime:{inspect:()=>s.report},model:{featuresOf:()=>s.features},
  requestId:'physical.cut.rev4',exportStep:true});

test('maps distinct authored cut and target body to exact pair of analytic native profiles',()=>{
  const q=request(fresh());
  assert.equal(q.targetBodyId,'body.bracket');
  assert.equal(q.baseExtrude.featureId,'extrude.bracket');
  assert.equal(q.baseExtrude.profile.boundary.length,6);
  assert.equal(q.baseExtrude.profile.holes.length,1);
  assert.equal(q.cutTool.profile.boundary.length,4);
  assert.equal(q.cutTool.profile.holes.length,0);
  assert.equal(q.cutTool.profile.materialAreaMm2,192);
  assert.equal(q.revision,4);
  assert.equal(q.exportStep,true);
});
test('fails closed on wrong body, stale report or non-admitted tool sketch',()=>{
  const wrong=fresh();wrong.features[3].payload.targetBodyId='body.else';
  assert.throws(()=>request(wrong),/pending explicit cut/);
  const stale=fresh();stale.report.revision=3;
  assert.throws(()=>request(stale),/fresh exact-revision/);
  const impossible=fresh();impossible.report.features[1].status='unsolved_sketch';
  assert.throws(()=>request(impossible),/solved, admitted sketch/);
  const badArea=fresh();badArea.report.features[1].profile={...window,areaMm2:193};
  assert.throws(()=>request(badArea),/solved cut area disagrees/);
  const same=fresh();same.features[3].payload.sourceSketchId='sketch.bracket';
  assert.throws(()=>request(same),/separate cut sketch/);
  const missing=fresh();missing.features[3].dependsOn=['extrude.bracket'];
  assert.throws(()=>request(missing),/separate cut sketch/);
  const alias=fresh();alias.features.push({id:'cut.window.tool',kind:'dummy',writeTargets:[]});
  assert.throws(()=>request(alias),/generated tool\/request/);
});
