import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAnalyticProfileArea,ANALYTIC_AREA_GUARD_VERSION} from '../analytic-area.mjs';
import {createSketch,solveSketch,buildPlateProfile,serializeSketch,parseSketch} from '../index.mjs';
import {discoverPlateProfiles,admitDiscoveredPlateProfile} from '../profile-discovery.mjs';

const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const coords=vertices=>vertices.map(p=>[p.x,p.y]);
const fixedLoop=vertices=>{
  const points=vertices.map((p,i)=>({id:'p'+i,x:p.x,y:p.y}));
  const lines=points.map((p,i)=>({id:'edge'+i,start:p.id,end:points[(i+1)%points.length].id}));
  const constraints=points.map(p=>({id:'fix:'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}));
  return createSketch({version:1,units:'mm',points,lines,circles:[],constraints});
};
test('versioned analytic-only area matches ordinary plate and circular holes',()=>{
  assert.equal(ANALYTIC_AREA_GUARD_VERSION,1);
  const result=assessAnalyticProfileArea(rectangle(120,80),[{radius:6},{radius:6}]);
  assert.equal(result.status,'verified');
  assert.ok(Math.abs(result.areaMm2-(9600-72*Math.PI))<1e-9);
});
test('exact integer shoelace survives huge translation and floating Infinity cancellation',()=>{
  const origin=1e155,next=origin+1e140,span=next-origin;
  const vertices=[{x:origin,y:origin},{x:next,y:origin},{x:next,y:next},{x:origin,y:next}];
  let legacy=0;
  for(let i=0;i<4;i++){
    const a=vertices[i],b=vertices[(i+1)%4];
    legacy+=a.x*b.y-b.x*a.y;
  }
  assert.equal(Number.isFinite(legacy),false);
  const result=assessAnalyticProfileArea(vertices);
  assert.equal(result.status,'verified');
  assert.ok(Math.abs(result.areaMm2/(span*span)-1)<1e-13);
  const doc=fixedLoop(vertices),solution=solveSketch(doc);
  assert.equal(solution.status,'solved');
  const profile=buildPlateProfile(doc,solution,doc.lines.map(x=>x.id));
  assert.ok(Math.abs(profile.areaMm2/(span*span)-1)<1e-13);
  const replay=parseSketch(serializeSketch(doc));
  const discovery=discoverPlateProfiles(replay);
  assert.equal(discovery.status,'ready');
  assert.equal(discovery.candidates[0].profile.areaMm2,profile.areaMm2);
  assert.equal(admitDiscoveredPlateProfile(replay,discovery,discovery.candidates[0].id).areaMm2,profile.areaMm2);
});
test('orientation and cycle starting point cannot change an area preview',()=>{
  const polygon=rectangle(120,80),base=assessAnalyticProfileArea(polygon,[{radius:6}]);
  for(let i=0;i<4;i++){
    const rotated=[...polygon.slice(i),...polygon.slice(0,i)];
    for(const order of [rotated,[...rotated].reverse()]){
      assert.deepEqual(assessAnalyticProfileArea(order,[{radius:6}]),base);
    }
  }
});
test('unrepresentable positive areas fail closed instead of Infinity or zero',()=>{
  assert.equal(assessAnalyticProfileArea(rectangle(1e200,1e200)).reason,'unrepresentable_area');
  assert.equal(assessAnalyticProfileArea(rectangle(1e-200,1e-200)).reason,'unrepresentable_area');
});
test('pi bound refuses sign ambiguity without declaring a positive net area',()=>{
  const ambiguous=assessAnalyticProfileArea(rectangle(1,Math.PI),[{radius:1}]);
  assert.deepEqual(ambiguous,{version:1,status:'rejected',reason:'uncertain_net_area',areaMm2:null});
  assert.equal(assessAnalyticProfileArea(rectangle(2,2),[{radius:2}]).reason,'nonpositive_net_area');
});
test('invalid input, nonsimple loops and resource limits are never previewed',()=>{
  assert.equal(assessAnalyticProfileArea([{x:0,y:0}]).reason,'invalid_input');
  assert.equal(assessAnalyticProfileArea(rectangle(1,1),[{radius:NaN}]).reason,'invalid_input');
  assert.equal(assessAnalyticProfileArea(rectangle(1,1),[{radius:0}]).reason,'invalid_input');
  assert.equal(assessAnalyticProfileArea([{x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0}]).reason,'invalid_boundary:nonadjacent_intersection');
  assert.equal(assessAnalyticProfileArea(rectangle(1,1),Array.from({length:65},()=>({radius:.01}))).reason,'budget_exceeded');
});
test('profile admission retains explicit numeric refusal on large solved rectangle',()=>{
  const doc=fixedLoop(rectangle(1e200,1e200));
  const result=solveSketch(doc);
  assert.equal(result.status,'solved');
  assert.throws(()=>buildPlateProfile(doc,result,doc.lines.map(x=>x.id)),/unrepresentable_area/);
  const discovery=discoverPlateProfiles(doc);
  assert.equal(discovery.status,'no_profile');
  assert.match(discovery.rejected[0].detail,/unrepresentable_area/);
});
