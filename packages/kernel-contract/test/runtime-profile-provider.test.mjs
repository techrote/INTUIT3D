import test from 'node:test';
import assert from 'node:assert/strict';
import {requestFromRuntimeProfile} from '../src/runtime-profile-provider.mjs';
const outer=[[-80,-50],[80,-50],[80,-10],[10,-10],[10,50],[-80,50]].map(
  ([x,y],i)=>({id:'p'+i,x,y}));
const profile={status:'analytic_profile_only',units:'mm',outer,
  holes:[{id:'bolt',centerId:'bolt.center',x:-50,y:0,radius:6}],
  areaMm2:11800-Math.PI*36};
const report=()=>({format:'intuit3d.workflow-runtime-evaluation',version:1,
  exactGeometryAvailable:false,revision:5,features:[
    {featureId:'sketch.l',kind:'sketch',status:'analytic_profile_only',
      evidence:'sketch_analytic_only',sketchSignature:'real-sketch-signature',profile},
    {featureId:'extrude.l',kind:'extrude',status:'preview_only',
      evidence:'sketch_analytic_only',sourceSketchId:'sketch.l',bodyId:'body.l',
      thicknessMm:8,profile}]});
test('maps the accepted six-sided FEATUREOPS profile directly to native OCP request',()=>{
  const mapped=requestFromRuntimeProfile(report(),'extrude.l',{requestId:'bracket.native'});
  assert.equal(mapped.protocol,'intuit3d/kernel/arc-extrude-v1');
  assert.equal(mapped.profile.boundary.length,6);
  assert.equal(mapped.profile.holes[0].radiusMm,6);
  assert.equal(mapped.semanticBodyId,'body.l');
  assert.ok(Math.abs(mapped.profile.materialAreaMm2-(11800-Math.PI*36))<1e-8);
  assert.equal(mapped.exportStep,true);
});
test('refuses forged or mismatched runtime admission rather than promoting a preview',()=>{
  const r=report();r.features[1].status='pending_exact_provider';
  assert.throws(()=>requestFromRuntimeProfile(r,'extrude.l',{requestId:'fail'}),/solved authored/);
  const a=report();a.features[1].profile={...profile,areaMm2:1};
  assert.throws(()=>requestFromRuntimeProfile(a,'extrude.l',{requestId:'fail'}),/identical admitted/);
  const b=report();b.features[0].status='unsolved_sketch';
  assert.throws(()=>requestFromRuntimeProfile(b,'extrude.l',{requestId:'fail'}),/identical admitted/);
  const c=report();c.features[0].profile={...profile,outer:[...outer].reverse()};
  assert.throws(()=>requestFromRuntimeProfile(c,'extrude.l',{requestId:'fail'}),/identical admitted/);
  const d=report();d.features[1].thicknessMm=-1;
  assert.throws(()=>requestFromRuntimeProfile(d,'extrude.l',{requestId:'fail'}),/solved authored/);
});
