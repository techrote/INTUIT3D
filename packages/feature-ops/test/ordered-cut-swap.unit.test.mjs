import test from 'node:test';
import assert from 'node:assert/strict';
import {swapOrderedBodyCuts,ORDERED_CUT_SWAP_FORMAT,ORDERED_CUT_SWAP_VERSION}
  from '../src/ordered-cut-swap.mjs';

function fixture(){
  const profileA={id:'cycle:slot',status:'analytic_profile_only'};
  const profileB={id:'cycle:pocket',status:'analytic_profile_only'};
  const before=[
    {id:'sketch.slot',kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:{kind:'slot'}}},
    {id:'sketch.pocket',kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:{kind:'pocket'}}},
    {id:'extrude.housing',kind:'extrude',dependsOn:[],writeTargets:['body.housing'],payload:{thicknessMm:9}},
    {id:'cut.slot',kind:'cut',dependsOn:['extrude.housing','sketch.slot'],writeTargets:['body.housing'],
      payload:{targetBodyId:'body.housing',sourceSketchId:'sketch.slot',profileCandidateId:'cycle:slot',
        units:'mm',frame:'local_xy',throughAll:true}},
    {id:'cut.pocket',kind:'cut',dependsOn:['cut.slot','sketch.pocket'],writeTargets:['body.housing'],
      payload:{targetBodyId:'body.housing',sourceSketchId:'sketch.pocket',profileCandidateId:'cycle:pocket',
        units:'mm',frame:'local_xy',throughAll:false,depthMm:3}},
    {id:'cut.window',kind:'cut',dependsOn:['cut.pocket','sketch.slot'],writeTargets:['body.housing'],
      payload:{targetBodyId:'body.housing',sourceSketchId:'sketch.slot',profileCandidateId:'cycle:slot',
        units:'mm',frame:'local_xy',throughAll:true}},
    {id:'extrude.spacer',kind:'extrude',dependsOn:[],writeTargets:['body.spacer'],payload:{thicknessMm:4}}
  ];
  const after=before.map(f=>f.id==='cut.slot'?{...f,dependsOn:['cut.pocket','sketch.slot']}:
    f.id==='cut.pocket'?{...f,dependsOn:['extrude.housing','sketch.pocket']}:
    f.id==='cut.window'?{...f,dependsOn:['cut.slot','sketch.slot']}:f);
  const history={document:{projectId:'valve.manifold',revision:7}};
  const order=['extrude.housing','cut.slot','cut.pocket','cut.window'];
  const changed=['extrude.housing','cut.pocket','cut.slot','cut.window'];
  let committed=0,previewed=0;
  const report={features:[
    {featureId:'sketch.slot',status:'analytic_profile_only',profile:profileA},
    {featureId:'sketch.pocket',status:'analytic_profile_only',profile:profileB},
    {featureId:'cut.slot',status:'pending_exact_provider'},
    {featureId:'cut.pocket',status:'blocked_dependency'},
  ]};
  const services={
    model:{featuresOf:doc=>doc.revision===7?before:after},
    runtime:{inspect:()=>report,diff:()=>({invalidatedFeatureIds:['cut.slot','cut.pocket','cut.window']})},
    sketch:{validateSketch:doc=>doc},
    discovery:{discoverPlateProfiles:doc=>({status:'ready',candidates:[
      {id:doc.kind==='pocket'?'cycle:pocket':'cycle:slot'}]}),
      admitDiscoveredPlateProfile:(doc,_,selected)=>({id:selected,status:'analytic_profile_only'})},
    cutChain:{inspectBodyCutChain:doc=>({projectId:doc.projectId,revision:doc.revision,status:'ready',
      bodyWriterIds:order,eligibleAfterWriterId:'cut.window'})},
    cutOrder:{previewBodyCutSwap:(doc,request)=>{
      previewed++;
      assert.equal(request.format,'intuit3d.body-cut-order');
      assert.deepEqual(request.eventIds,['swap.pocket','swap.slot','swap.window']);
      return {writerOrderBefore:order,writerOrderAfter:changed,events:[{},{},{}],
        authoredTimelineChanged:false,exactGeometryAuthority:false,requiresNativeRebuild:true,
        invalidation:{readyToEvaluate:['cut.pocket','cut.slot','cut.window']}};
    },commitUndoableBodyCutSwap:()=>{
      committed++;
      return {document:{projectId:'valve.manifold',revision:10}};
    }}
  };
  const request={format:ORDERED_CUT_SWAP_FORMAT,version:ORDERED_CUT_SWAP_VERSION,
    expectedProjectId:'valve.manifold',expectedRevision:7,units:'mm',frame:'local_xy',
    targetBodyId:'body.housing',firstCutFeatureId:'cut.slot',secondCutFeatureId:'cut.pocket',
    expectedWriterOrder:order,cutSelections:[
      {cutFeatureId:'cut.slot',sourceSketchId:'sketch.slot',profileCandidateId:'cycle:slot',extent:{kind:'through_all'}},
      {cutFeatureId:'cut.pocket',sourceSketchId:'sketch.pocket',profileCandidateId:'cycle:pocket',extent:{kind:'blind',depthMm:3}}
    ],eventIds:['swap.pocket','swap.slot','swap.window']};
  return {history,request,services,get committed(){return committed},get previewed(){return previewed}};
}

test('nonterminal reorder changes real DAG, preserves semantic cuts and remains explicitly pending native',()=>{
  const x=fixture(),r=swapOrderedBodyCuts(x.history,x.request,x.services);
  assert.equal(r.kind,'committed');
  assert.equal(x.previewed,1);assert.equal(x.committed,1);
  assert.deepEqual(r.writerOrderAfter,['extrude.housing','cut.pocket','cut.slot','cut.window']);
  assert.deepEqual(r.statuses,[{cutFeatureId:'cut.slot',status:'pending_exact_provider'},
    {cutFeatureId:'cut.pocket',status:'blocked_dependency'}]);
  assert.equal(r.nativeHandoff.sourceRevision,10);
  assert.equal(r.nativeHandoff.exactAuthority,false);
  assert.equal(r.authoredTimelineChanged,false);
  assert.ok(r.invalidation.invalidatedFeatureIds.includes('cut.window'));
});
test('stale, ambiguous, noncommuting, wrong target and malformed selectors never commit',()=>{
  const bad=[
    x=>x.request.expectedRevision=6,
    x=>x.request.expectedProjectId='other',
    x=>x.request.units='cm',
    x=>x.request.frame='global',
    x=>x.request.targetBodyId='body.spacer',
    x=>x.request.secondCutFeatureId='cut.window',
    x=>x.request.expectedWriterOrder=['extrude.housing','cut.pocket','cut.slot','cut.window'],
    x=>x.request.eventIds=['swap.pocket','swap.slot'],
    x=>x.request.eventIds=['dup','dup','dup'],
    x=>x.request.cutSelections[1].extent={kind:'blind',depthMm:0},
    x=>x.request.cutSelections[1].extent={kind:'through_all'},
    x=>x.request.cutSelections[1].profileCandidateId='cycle:wrong',
    x=>x.request.cutSelections[1].sourceSketchId='sketch.slot',
    x=>x.services.cutChain.inspectBodyCutChain=()=>({status:'unavailable'}),
    x=>x.services.discovery.discoverPlateProfiles=()=>({status:'ambiguous'}),
    x=>x.services.runtime.inspect=()=>({features:[]}),
    x=>x.services.cutOrder.previewBodyCutSwap=()=>{throw new Error('noncommuting topology');}
  ];
  for(const mutate of bad){
    const x=fixture();mutate(x);
    assert.throws(()=>swapOrderedBodyCuts(x.history,x.request,x.services));
    assert.equal(x.committed,0);assert.equal(x.history.document.revision,7);
  }
});
test('misleading INTENT preview and unvalidated provider states refuse',()=>{
  for(const mutation of [
    x=>x.services.cutOrder.previewBodyCutSwap=()=>({writerOrderBefore:x.request.expectedWriterOrder,
      writerOrderAfter:x.request.expectedWriterOrder,events:[{},{},{}],
      exactGeometryAuthority:false,requiresNativeRebuild:true,authoredTimelineChanged:false}),
    x=>x.services.runtime.inspect=()=>({features:[
      {featureId:'sketch.slot',status:'analytic_profile_only',profile:{id:'cycle:slot',status:'analytic_profile_only'}},
      {featureId:'sketch.pocket',status:'analytic_profile_only',profile:{id:'cycle:pocket',status:'analytic_profile_only'}},
      {featureId:'cut.slot',status:'validated_exact'},
      {featureId:'cut.pocket',status:'blocked_dependency'}]})
  ]){
    const x=fixture();mutation(x);
    assert.throws(()=>swapOrderedBodyCuts(x.history,x.request,x.services));
    assert.equal(x.committed,0);
  }
});