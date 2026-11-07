/** Contract shape tests only: synthetic records, NOT solver/native execution.
 * scenario.mjs exercises the real accepted SKETCH/INTENT/FEATUREOPS/RUNTIME.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mapAdmittedChainToPinnedL,admitFreshReceipt} from './adapter.mjs';
const L=[[-60,-40],[60,-40],[60,-15],[-30,-15],[-30,40],[-60,40]];
const pocket=[[-50,-5],[-37,-5],[-37,20],[-50,20]];
const slot=[[-50,-32],[-20,-32],[-20,-22],[-50,-22]];
function profile(coords,id) {
 let sum=0;
 const boundary=coords.map(([x,y],i)=>{
  const [u,v]=coords[(i+1)%coords.length];sum+=x*v-u*y;
  return {id:id+'.e'+i,kind:'line',start:{x,y},end:{x:u,y:v}};
 });
 return {format:'intuit3d.analytic-arc-profile',version:1,id,units:'mm',
  sourceSignature:'source.'+id,providerSubmissionReady:true,
  globalSelfIntersectionChecked:true,holeContainmentChecked:true,
  nativeProfileAdmissible:false,stepQualified:false,
  boundary,holes:[],signedBoundaryAreaMm2:sum/2,materialAreaMm2:sum/2};
}
function fixture(t=8,p=3) {
 const [base,slotP,pocketP]=[profile(L,'base'),profile(slot,'slot'),profile(pocket,'pocket')];
 const selection={projectId:'project.L',revision:7,
  baseSketchId:'sketch.bracket',baseProfileCandidateId:'cycle:bracket',
  baseSourceSignature:base.sourceSignature,
  cuts:[{cutFeatureId:'cut.slot',sourceSketchId:'sketch.slot',profileCandidateId:'cycle:slot',
    sourceSignature:slotP.sourceSignature},
   {cutFeatureId:'cut.pocket',sourceSketchId:'sketch.pocket',profileCandidateId:'cycle:pocket',
    sourceSignature:pocketP.sourceSignature}]};
 const chain={protocol:'intuit3d/kernel/profile-body-cut-chain-v3',
  requestId:'cad.7',targetBodyId:'body.bracket',revision:7,units:'mm',exportStep:true,
  baseExtrude:{protocol:'intuit3d/kernel/arc-extrude-v1',featureId:'extrude.bracket',
   revision:7,units:'mm',thicknessMm:t,exportStep:false,profile:base},
  cuts:[{cutFeatureId:'cut.slot',cutDepthMm:t,
    cutTool:{protocol:'intuit3d/kernel/arc-extrude-v1',revision:7,thicknessMm:t,
      exportStep:false,profile:slotP}},
   {cutFeatureId:'cut.pocket',cutDepthMm:p,
    cutTool:{protocol:'intuit3d/kernel/arc-extrude-v1',revision:7,thicknessMm:t,
      exportStep:false,profile:pocketP}}]};
 return {selection,chain};
}
const map=x=>mapAdmittedChainToPinnedL(x.chain,x.selection,x.chain.revision);
function move(p,dx,dy){for(const e of p.boundary){
 e.start.x+=dx;e.start.y+=dy;e.end.x+=dx;e.end.y+=dy;}}
test('8 mm real-shaped L and two ordered rectangular cuts map to native subset',()=>{
 const m=map(fixture());
 assert.equal(m.state,'pending_physical');assert.deepEqual(m.request.profile,
  {profileId:'sketch.bracket',width:120,depth:80,legWidth:30,footHeight:25,thickness:8});
 assert.deepEqual(m.request.cuts.map(c=>[c.featureId,c.cutDepthMm]),
  [['cut.slot',8],['cut.pocket',3]]);
 assert.equal(m.exactAuthority,false);assert.equal(m.provenance.nativeWireCarriesSolverGeometry,false);
 assert.equal(4650*8-300*8-325*3,33825);
});
test('12 mm thickness and 5 mm pocket map without reallocating semantic IDs',()=>{
 const m=map(fixture(12,5));
 assert.equal(m.request.profile.thickness,12);
 assert.deepEqual(m.request.cuts.map(c=>c.cutDepthMm),[12,5]);
 assert.equal(4650*12-300*12-325*5,50575);
});
test('refuses stale model revision',()=>{
 const x=fixture();assert.throws(()=>mapAdmittedChainToPinnedL(x.chain,x.selection,8),/stale/);
});
test('refuses stale solver signature',()=>{
 const x=fixture();x.selection.baseSourceSignature='obsolete';assert.throws(()=>map(x),/source changed/);
});
test('refuses removed SKETCH identity',()=>{
 const x=fixture();delete x.selection.baseSketchId;assert.throws(()=>map(x),/SKETCH evidence/);
});
test('refuses a different cut feature target',()=>{
 const x=fixture();x.selection.cuts[0].cutFeatureId='cut.other';assert.throws(()=>map(x),/mismatch/);
});
test('does not recenter an off-origin L silently',()=>{
 const x=fixture();move(x.chain.baseExtrude.profile,1,0);assert.throws(()=>map(x),/centred/);
});
test('refuses non-L profile',()=>{
 const x=fixture();x.chain.baseExtrude.profile.boundary[3].end.x=-20;
 assert.throws(()=>map(x));
});
test('refuses a holed or islanded base',()=>{
 const x=fixture();x.chain.baseExtrude.profile.holes=[{id:'circle'}];
 assert.throws(()=>map(x),/hole-free/);
});
test('refuses diagonal cut',()=>{
 const x=fixture();x.chain.cuts[0].cutTool.profile.boundary[0].end.y+=1;
 assert.throws(()=>map(x),/axis-aligned|closed/);
});
test('refuses cut outside native L stock',()=>{
 const x=fixture();move(x.chain.cuts[0].cutTool.profile,90,0);
 assert.throws(()=>map(x),/outside/);
});
test('refuses touching or overlapping cut footprints',()=>{
 const x=fixture();move(x.chain.cuts[1].cutTool.profile,0,-27);
 assert.throws(()=>map(x),/touch|outside/);
});
test('refuses an overdepth pocket',()=>{
 const x=fixture();x.chain.cuts[1].cutDepthMm=9;
 assert.throws(()=>map(x),/depth outside body/);
});
test('rejects receipt of obsolete revision/project or altered cut order',()=>{
 const m=map(fixture());
 const receipt={kind:'experimental_report',revision:7,featureId:'body.bracket',
  profileId:'sketch.bracket',cutFeatureIds:['cut.slot','cut.pocket'],
  exactAuthority:false,independentInteroperability:false,
  artifact:{sha256:'a'.repeat(64)}};
 assert.equal(admitFreshReceipt(m,receipt,'project.L',7).kind,'experimental_physical_only');
 assert.throws(()=>admitFreshReceipt(m,receipt,'project.L',8),/obsolete STEP receipt/);
 assert.throws(()=>admitFreshReceipt(m,receipt,'other',7),/different project/);
 assert.throws(()=>admitFreshReceipt(m,{...receipt,
  cutFeatureIds:['cut.pocket','cut.slot']},'project.L',7),/source-matched/);
});
