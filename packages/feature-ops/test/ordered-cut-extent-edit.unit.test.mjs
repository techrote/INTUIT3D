import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconfigureOrderedCutExtent,ORDERED_CUT_EXTENT_EDIT_FORMAT,
  ORDERED_CUT_EXTENT_EDIT_VERSION
} from '../src/ordered-cut-extent-edit.mjs';

function fixture() {
  const profile={status:'analytic_profile_only',id:'cycle:pocket'};
  const cut={id:'cut.pocket',kind:'cut',
    dependsOn:['cut.slot','sketch.pocket'],writeTargets:['body.bracket'],
    payload:{sourceSketchId:'sketch.pocket',targetBodyId:'body.bracket',
      profileCandidateId:'cycle:pocket',units:'mm',frame:'local_xy',
      throughAll:false,depthMm:3}};
  const features=[
    {id:'sketch.pocket',kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketch:{version:1}}},
    {id:'cut.slot',kind:'cut',dependsOn:['extrude.bracket'],
      writeTargets:['body.bracket'],payload:{targetBodyId:'body.bracket'}},
    cut,
    {id:'cut.finish',kind:'cut',dependsOn:['cut.pocket','sketch.pocket'],
      writeTargets:['body.bracket'],payload:{targetBodyId:'body.bracket'}}
  ];
  const history={document:{projectId:'project.1',revision:6}};
  const nextCut={...cut,payload:{...cut.payload,depthMm:5}};
  const calls=[];
  const report={features:[
    {featureId:'sketch.pocket',status:'analytic_profile_only',profile},
    {featureId:'cut.pocket',status:'blocked_dependency'},
    {featureId:'cut.finish',status:'blocked_dependency'}]};
  const event={eventId:'edit.pocket',type:'feature.edit',
    featureId:'cut.pocket',patch:{payload:nextCut.payload}};
  const services={
    model:{featuresOf:doc=>doc.revision===6?features:
      features.map(feature=>feature.id==='cut.pocket'?nextCut:feature)},
    sketch:{validateSketch:doc=>doc},
    discovery:{
      discoverPlateProfiles:()=>({status:'ready',candidates:[{id:'cycle:pocket'}]}),
      admitDiscoveredPlateProfile:()=>profile},
    cutChain:{
      inspectBodyCutChain:()=>({status:'ready',bodyWriterIds:
        ['extrude.bracket','cut.slot','cut.pocket','cut.finish'],
        eligibleAfterWriterId:'cut.finish'}),
      inspectBodyCutExtent:()=>({projectId:'project.1',revision:6,
        extent:{kind:'blind',depthMm:3},semanticStatus:'ready'}),
      previewBodyCutExtentEdit:(doc,request)=>{
        calls.push({kind:'preview',doc,request});
        return {semanticStatus:'ready',event};}
    },
    runtime:{
      inspect:()=>report,
      commit:(doc,events,revision)=>{
        calls.push({kind:'commit',events,revision});
        return {document:{projectId:'project.1',revision:7}};
      },
      diff:()=>({invalidatedFeatureIds:['cut.pocket','cut.finish']})
    }
  };
  const request={
    format:ORDERED_CUT_EXTENT_EDIT_FORMAT,
    version:ORDERED_CUT_EXTENT_EDIT_VERSION,
    expectedProjectId:'project.1',expectedRevision:6,eventId:'edit.pocket',
    units:'mm',frame:'local_xy',cutFeatureId:'cut.pocket',
    targetBodyId:'body.bracket',
    from:{afterBodyWriterId:'cut.slot',sourceSketchId:'sketch.pocket',
      profileCandidateId:'cycle:pocket',extent:{kind:'blind',depthMm:3}},
    toExtent:{kind:'blind',depthMm:5}
  };
  return {history,request,services,calls,event,features,report};
}
test('nonterminal pocket edit uses INTENT preview and one RUNTIME transaction',()=>{
  const x=fixture();
  const r=reconfigureOrderedCutExtent(x.history,x.request,x.services);
  assert.equal(r.status,'blocked_dependency');
  assert.equal(r.semanticStatus,'ready');
  assert.deepEqual(x.calls.map(c=>c.kind),['preview','commit']);
  assert.equal(x.calls[0].request.admission,'require_ready');
  assert.deepEqual(x.calls[0].request.fromExtent,{kind:'blind',depthMm:3});
  assert.deepEqual(x.calls[0].request.toExtent,{kind:'blind',depthMm:5});
  assert.equal(x.calls[1].events.length,1);
  assert.equal(x.calls[1].events[0],x.event);
  assert.deepEqual(r.invalidation.invalidatedFeatureIds,
    ['cut.pocket','cut.finish']);
  assert.deepEqual(r.semanticIds,{cutId:'cut.pocket',
    bodyId:'body.bracket',sketchId:'sketch.pocket',predecessorId:'cut.slot'});
  assert.equal(r.exactAuthority,false);
  assert.equal(r.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
});
test('stale, ambiguous, noncommuting, unadmitted and malformed edits refuse before commit',()=>{
  const bad=[
    x=>x.request.expectedRevision=5,
    x=>x.request.expectedProjectId='other.project',
    x=>x.request.units='cm',
    x=>x.request.frame='world',
    x=>x.request.targetBodyId='body.spacer',
    x=>x.request.from.afterBodyWriterId='extrude.bracket',
    x=>x.request.from.sourceSketchId='sketch.unknown',
    x=>x.request.from.profileCandidateId='cycle:stale',
    x=>x.request.from.extent={kind:'blind',depthMm:4},
    x=>x.request.toExtent={kind:'blind',depthMm:3},
    x=>x.request.toExtent={kind:'blind',depthMm:0},
    x=>x.request.toExtent={kind:'blind',depthMm:Infinity},
    x=>x.request.toExtent={kind:'through_all',depthMm:5},
    x=>x.request.eventId='',
    x=>x.services.cutChain.inspectBodyCutChain=()=>({status:'unavailable',bodyWriterIds:[]}),
    x=>x.services.cutChain.inspectBodyCutExtent=()=>({projectId:'project.1',
      revision:6,semanticStatus:'ready',extent:{kind:'blind',depthMm:2}}),
    x=>x.services.discovery.discoverPlateProfiles=()=>({status:'ambiguous'}),
    x=>x.services.runtime.inspect=()=>({features:[]}),
    x=>x.services.cutChain.previewBodyCutExtentEdit=()=>({
      semanticStatus:'ready',event:{type:'feature.edit',featureId:'cut.else',
        patch:{payload:{}}}})
  ];
  for(const mutate of bad){
    const x=fixture();mutate(x);
    assert.throws(()=>reconfigureOrderedCutExtent(x.history,x.request,x.services));
    assert.deepEqual(x.calls.filter(c=>c.kind==='commit'),[]);
    assert.equal(x.history.document.revision,6);
  }
});
test('missing accepted INTENT extent-edit service fails closed',()=>{
  const x=fixture();
  x.services.cutChain=null;
  assert.throws(()=>reconfigureOrderedCutExtent(x.history,x.request,x.services),
    /accepted INTENT/);
});
