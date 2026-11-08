import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperimentalPlateWorkflow,rectanglePlateFromProfile} from '../experimental-plate.mjs';

const sketch={id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],payload:{}};
const plate={id:'plate',kind:'extrude',dependsOn:['sketch.plate'],writeTargets:['body.plate'],
  payload:{sourceSketchId:'sketch.plate',thicknessMm:8}};
const cut={id:'cut',kind:'cut',dependsOn:['plate'],writeTargets:['body.plate'],
  payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}};
const profile={status:'analytic_profile_only',units:'mm',outer:[
  {id:'p0',x:0,y:0},{id:'p1',x:120,y:0},{id:'p2',x:120,y:80},{id:'p3',x:0,y:80}],
  holes:[{id:'holeA',x:35,y:40,radius:6},{id:'holeB',x:85,y:40,radius:6}]};
function rig(opts={}) {
  const original=[sketch,plate,cut].map(x=>structuredClone(x));
  const features=opts.features||original;
  const history={document:{projectId:'demo',revision:3}}, live={current:history};
  const state=()=>({projectId:'demo',revision:history.document.revision,
    features:features.map(f=>({featureId:f.id,kind:f.kind,status:f.kind==='cut'?'pending_exact_provider':
      f.kind==='extrude'?'preview_only':'analytic_profile_only',
      ...(f.kind==='extrude'?{sourceSketchId:'sketch.plate',bodyId:'body.plate',
        thicknessMm:opts.thickness??8,profile:opts.profile??profile}:{})}))});
  let calls=0, seen={};
  const contract={PLATE_PROTOCOL:'intuit3d/kernel/plate-v1',EXPERIMENTAL_BACKEND:'OCP-python-prototype',
    EXPERIMENTAL_OCCT_VERSION:'7.9.3.1',parsePlateRequest(raw){
      assert.equal(raw.protocol,this.PLATE_PROTOCOL);assert.equal(raw.plate.holes.length,2);
      assert.equal(raw.plate.width,120);assert.equal(raw.plate.depth,80);return raw;
    }};
  const provider=opts.provider|| (async (request,options)=>{
    ++calls;seen={request,options};
    if(opts.during) opts.during(live,request,options);
    return {kind:'experimental_report',requestId:request.requestId,
      featureId:request.featureId,revision:request.revision,backend:contract.EXPERIMENTAL_BACKEND,
      occtVersion:contract.EXPERIMENTAL_OCCT_VERSION,
      exactAuthority:false,independentInteroperability:false,
      observed:{source:{valid:true}},artifact:request.exportStep?{
        path:'/tmp/plate.step',verification:'same_engine_step_readback'}:null};
  });
  const runner=createExperimentalPlateWorkflow({runtime:{inspect:state,save:history=>JSON.stringify(history)},
    model:{featuresOf:()=>features},plateContract:contract,runExperimentalPlate:provider});
  const evaluate=(extra={})=>runner.evaluate(history,{
    cutFeatureId:'cut',requestId:'plate.req.1',readCurrentHistory:()=>live.current,...extra});
  return {runner,history,live,evaluate,seen:()=>seen,calls:()=>calls};
}
test('rectangle and holes translate into kernel centred coordinates',()=>{
  assert.deepEqual(rectanglePlateFromProfile(profile,8),{width:120,depth:80,thickness:8,
    holes:[{x:-25,y:0,radius:6},{x:25,y:0,radius:6}]});
});
test('plate+cut dispatch retains live revision, truthful experimental receipt',async()=>{
  const a=rig(),out=await a.evaluate();
  assert.equal(out.kind,'experimental_plate_evaluated');
  assert.equal(out.extrudeFeatureId,'plate');assert.equal(out.sourceSketchId,'sketch.plate');
  assert.equal(out.exactAuthority,false);assert.equal(out.independentInteroperability,false);
  assert.deepEqual(out.intendedPlate.holes,[{x:-25,y:0,radius:6},{x:25,y:0,radius:6}]);
  assert.equal(a.calls(),1);assert.equal(a.seen().options.readCurrentRevision(),3);
  assert.equal(a.seen().request.featureId,'cut');
});
test('STEP output path is passed only to trusted provider',async()=>{
  const a=rig(),out=await a.evaluate({exportStep:true,stepOutput:'/tmp/out.step'});
  assert.equal(out.kind,'experimental_plate_evaluated');
  assert.equal(a.seen().options.stepOutput,'/tmp/out.step');
  assert.equal(out.artifact.verification,'same_engine_step_readback');
});
test('revision change during work cannot return current result',async()=>{
  const a=rig({during:(live,req,opts)=>{
    assert.equal(opts.readCurrentRevision(),3);
    live.current={document:{projectId:'demo',revision:4}};
    assert.notEqual(opts.readCurrentRevision(),3);
  }});
  assert.equal((await a.evaluate()).code,'stale_revision');
});
test('same project, same revision and identical feature report cannot substitute a different journal',async()=>{
  const a=rig({during:(live,request,options)=>{
    assert.equal(options.readCurrentRevision(),request.revision);
    // The fixture's feature evaluation report is deliberately unchanged.
    // Only non-feature journal metadata differs: a report-only fence accepted
    // this as current and could publish a native result for the wrong archive.
    live.current={...live.current,journalWitness:'divergent-history'};
    assert.notEqual(options.readCurrentRevision(),request.revision);
  }});
  assert.equal((await a.evaluate()).code,'stale_revision');
});
test('same-revision journal divergence refuses dispatch before invoking native',async()=>{
  const a=rig();
  a.live.current={...a.history,journalWitness:'different-history'};
  assert.equal((await a.evaluate()).code,'stale_revision');
  assert.equal(a.calls(),0);
});
test('swapped project with same revision is refused',async()=>{
  const a=rig({during:(live,req,opts)=>{
    live.current={document:{projectId:'different',revision:3}};
    assert.notEqual(opts.readCurrentRevision(),3);
  }});
  assert.equal((await a.evaluate()).code,'stale_revision');
});
test('pre-dispatch stale revision or abort never invokes provider',async()=>{
  const a=rig();a.live.current={document:{projectId:'demo',revision:9}};
  assert.equal((await a.evaluate()).code,'stale_revision');assert.equal(a.calls(),0);
  const b=rig(),ctrl=new AbortController();ctrl.abort();
  assert.equal((await b.evaluate({signal:ctrl.signal})).code,'cancelled');assert.equal(b.calls(),0);
});
test('timeout, cancellation, worker crash remain unresolved',async()=>{
  for(const code of ['timeout','worker_crash','cancelled']){
    const a=rig({provider:async()=>({kind:'unresolved',code})});
    assert.equal((await a.evaluate()).code,code);
  }
  assert.equal((await rig({provider:async()=>{throw Error('spawn failed');}}).evaluate()).code,'worker_crash');
});
test('fake exact or independent success cannot be promoted',async()=>{
  const a=rig({provider:async()=>({kind:'experimental_report',exactAuthority:true,
    independentInteroperability:true})});
  assert.equal((await a.evaluate()).code,'requires_reconciliation');
});
test('rotated or unsupported polygon fails before native work',async()=>{
  const rotated=structuredClone(profile);
  rotated.outer=[{x:0,y:0},{x:10,y:10},{x:0,y:20},{x:-10,y:10}];
  assert.throws(()=>rectanglePlateFromProfile(rotated,8),/rotated polygon/);
  const a=rig({profile:rotated});
  assert.equal((await a.evaluate()).code,'unsupported_profile');assert.equal(a.calls(),0);
});
test('missing cut-body link or competing body writer fails closed',async()=>{
  const a=rig({features:[sketch,plate,{...cut,payload:{...cut.payload,targetBodyId:'other'}}]});
  assert.equal((await a.evaluate()).code,'unsupported_feature');
  const b=rig({features:[sketch,plate,cut,{id:'other.write',kind:'cut',dependsOn:['plate'],
    writeTargets:['body.plate'],payload:{}}]});
  assert.equal((await b.evaluate()).code,'unsupported_feature');
});

test('single-body native scope refuses independent and future body writers before dispatch',async()=>{
  const extra={id:'extrude.independent',kind:'extrude',dependsOn:[],
    writeTargets:['body.second'],payload:{}};
  const multi=rig({features:[sketch,plate,cut,extra]});
  const refused=await multi.evaluate({exportStep:true});
  assert.equal(refused.kind,'unresolved');
  assert.equal(refused.code,'unsupported_feature');
  assert.deepEqual(refused.unsupportedFeatureIds,['extrude.independent']);
  assert.match(refused.reason,/plate-v1 native STEP cannot represent/);
  assert.equal(multi.calls(),0,'no partial single-body STEP may be dispatched');

  const future=rig({features:[sketch,plate,cut,{
    id:'future.body.operation',kind:'future-boolean',dependsOn:[],
    writeTargets:['body.other'],payload:{},
  }]});
  assert.deepEqual((await future.evaluate()).unsupportedFeatureIds,['future.body.operation']);
  assert.equal(future.calls(),0,'new unknown body-writing operations also fail closed');

  const parameter=rig({features:[sketch,plate,cut,{
    id:'parameter.height',kind:'parameter',dependsOn:[],
    writeTargets:[],payload:{},
  }]});
  assert.equal((await parameter.evaluate()).kind,'experimental_plate_evaluated',
    'non-geometric parameter history remains eligible');
  assert.equal(parameter.calls(),1);
});
