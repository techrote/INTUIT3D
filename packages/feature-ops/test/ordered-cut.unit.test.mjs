import test from 'node:test';
import assert from 'node:assert/strict';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT,ORDERED_CUT_VERSION} from '../src/ordered-cut.mjs';
function fixture(){
  const profile={status:'analytic_profile_only',id:'cycle:slot'};
  const features=[
    {id:'sketch.pocket',kind:'sketch',writeTargets:[],dependsOn:[],payload:{sketch:{version:1}}},
    {id:'extrude.body',kind:'extrude',writeTargets:['body.1'],dependsOn:['sketch.start'],payload:{sourceSketchId:'sketch.start'}},
    {id:'cut.first',kind:'cut',writeTargets:['body.1'],dependsOn:['extrude.body'],payload:{sourceSketchId:'sketch.start',targetBodyId:'body.1'}}
  ];
  const history={document:{projectId:'project.1',revision:6}},calls=[];
  const event={eventId:'cut.second.create',type:'feature.create',feature:{
    id:'cut.second',kind:'cut',writeTargets:['body.1'],dependsOn:['cut.first','sketch.pocket'],
    payload:{sourceSketchId:'sketch.pocket',targetBodyId:'body.1',throughAll:false,depthMm:3}
  }};
  const report={features:[{featureId:'sketch.pocket',status:'analytic_profile_only',profile},
    {featureId:'cut.first',status:'pending_exact_provider'},
    {featureId:'cut.second',status:'blocked_dependency'}]};
  const services={
    model:{featuresOf:h=>h.revision===6?features:[...features,event.feature]},
    sketch:{validateSketch:d=>d},
    discovery:{discoverPlateProfiles:()=>({status:'ready',candidates:[{id:'cycle:slot'}]}),
      admitDiscoveredPlateProfile:()=>profile},
    cutChain:{inspectBodyCutChain:()=>({status:'ready',eligibleAfterWriterId:'cut.first'}),
      previewBodyCutAppend:(doc,req)=>{calls.push({kind:'preview',doc,req});return {semanticStatus:'ready',event};}},
    runtime:{inspect:()=>report,commit:(h,events,revision)=>{
      calls.push({kind:'commit',events,revision});return {document:{projectId:'project.1',revision:7}};},
      diff:()=>({invalidatedFeatureIds:['cut.second']})}
  };
  const request={format:ORDERED_CUT_FORMAT,version:ORDERED_CUT_VERSION,
    expectedProjectId:'project.1',expectedRevision:6,eventId:'cut.second.create',
    units:'mm',frame:'local_xy',sourceSketchId:'sketch.pocket',
    profileCandidateId:'cycle:slot',afterBodyWriterId:'cut.first',targetBodyId:'body.1',
    cutFeatureId:'cut.second',extent:{kind:'blind',depthMm:3}};
  return {history,request,services,calls,report};
}
test('delegates terminal/body inspection and preview to INTENT then ONE RUNTIME commit',()=>{
  const x=fixture(),result=appendOrderedProfileCut(x.history,x.request,x.services);
  assert.equal(result.kind,'committed');
  assert.deepEqual(x.calls.map(c=>c.kind),['preview','commit']);
  assert.equal(x.calls[0].req.admission,'require_ready');
  assert.equal(x.calls[0].req.extent.depthMm,3);
  assert.equal(x.calls[1].events.length,1);
  assert.equal(result.status,'blocked_dependency');
  assert.equal(result.semanticStatus,'ready');
  assert.equal(result.exactAuthority,false);
});
test('ambiguous, unadmitted, stale, altered preview or invalid predecessor cannot commit',()=>{
  for(const mutate of [
    x=>x.request.expectedRevision=5,
    x=>x.request.profileCandidateId='cycle:other',
    x=>x.services.discovery.discoverPlateProfiles=()=>({status:'ambiguous'}),
    x=>x.services.cutChain.inspectBodyCutChain=()=>({status:'unavailable',eligibleAfterWriterId:null}),
    x=>x.services.cutChain.previewBodyCutAppend=()=>({semanticStatus:'ready',event:{type:'feature.create',feature:{id:'wrong',writeTargets:['body.1']}}}),
    x=>x.services.runtime.inspect=()=>({...x.report,features:x.report.features.filter(f=>f.featureId!=='cut.first')})
  ]){
    const x=fixture();mutate(x);
    assert.throws(()=>appendOrderedProfileCut(x.history,x.request,x.services));
    assert.equal(x.calls.filter(c=>c.kind==='commit').length,0);
  }
});
