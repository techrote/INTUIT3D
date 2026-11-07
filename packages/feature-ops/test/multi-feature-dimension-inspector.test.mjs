import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSelectedFeatureDimensions,prepareSelectedFeatureDimensionEdits}
  from '../src/multi-feature-dimension-inspector.mjs';

function fixture(){
 const history={document:{projectId:'project.valve',revision:12}};
 const profile={status:'analytic_profile_only',id:'cycle:test'};
 const features=[
  {id:'sketch.body',kind:'sketch',writeTargets:[],payload:{sketch:{version:1}},dependsOn:[]},
  {id:'sketch.cut',kind:'sketch',writeTargets:[],payload:{sketch:{version:1}},dependsOn:[]},
  {id:'extrude.body',kind:'extrude',writeTargets:['body.a'],dependsOn:['sketch.body'],payload:{sourceSketchId:'sketch.body',thicknessMm:10,units:'mm',frame:'local_xy'}},
  {id:'cut.a',kind:'cut',writeTargets:['body.a'],dependsOn:['extrude.body','sketch.cut'],payload:{sourceSketchId:'sketch.cut',targetBodyId:'body.a',profileCandidateId:'cycle:test',throughAll:false,depthMm:3,units:'mm',frame:'local_xy'}}
 ];
 let called={commit:0,inspect:0};
 const services={
  model:{featuresOf:()=>features},
  runtime:{inspect:()=>{called.inspect++;return {features:[{featureId:'sketch.body',status:'analytic_profile_only',profile},{featureId:'sketch.cut',status:'analytic_profile_only',profile},{featureId:'extrude.body',status:'preview_only'},{featureId:'cut.a',status:'pending_exact_provider'}]};},commit:()=>{called.commit++;throw Error('do not commit');}},
  sketch:{validateSketch:s=>s},
  discovery:{discoverPlateProfiles:()=>({status:'ready',candidates:[{id:'cycle:test'}]}),admitDiscoveredPlateProfile:()=>profile},
  cutChain:{inspectBodyCutChain:()=>({status:'ready',projectId:'project.valve',revision:12,bodyWriterIds:['extrude.body','cut.a']}),
  inspectBodyCutExtent:()=>({projectId:'project.valve',revision:12,semanticStatus:'ready',extent:{kind:'blind',depthMm:3}})}
 };
 const request={expectedProjectId:'project.valve',expectedRevision:12,selections:[
  {featureId:'extrude.body',targetBodyId:'body.a'},
  {featureId:'cut.a',targetBodyId:'body.a'}]};
 return {history,features,services,request,called};
}
test('read-only selected rows build current explicit, revision-fenced Apply without committing',()=>{
 const {history,services,request,called}=fixture();
 const selection=inspectSelectedFeatureDimensions(history,request,services);
 assert.equal(selection.rows.length,2);
 assert.deepEqual(selection.rows.map(r=>r.kind),['extrusion_depth','cut_extent']);
 assert.equal(selection.rows[0].currentDepthMm,10);
 assert.deepEqual(selection.rows[1].currentExtent,{kind:'blind',depthMm:3});
 assert.equal(selection.rows[1].afterBodyWriterId,'extrude.body');
 const edit=prepareSelectedFeatureDimensionEdits(selection,[
  {featureId:'cut.a',eventId:'edit.cut',toExtent:{kind:'through_all'}},
  {featureId:'extrude.body',eventId:'edit.extrude',toDepthMm:14}
 ]);
 assert.equal(edit.expectedRevision,12);
 assert.deepEqual(edit.edits.map(e=>e.kind),['extrusion_depth','cut_extent']);
 assert.equal(edit.edits[0].fromDepthMm,10);
 assert.deepEqual(edit.edits[1].fromExtent,{kind:'blind',depthMm:3});
 assert.deepEqual(edit.edits[1].toExtent,{kind:'through_all'});
 assert.equal(called.commit,0);
});
test('selection refuses stale project/revision and wrong body before mutation',()=>{
 const {history,services,request,called}=fixture();
 assert.throws(()=>inspectSelectedFeatureDimensions(history,{...request,expectedRevision:11},services),/stale/);
 assert.equal(called.inspect,0);
 assert.throws(()=>inspectSelectedFeatureDimensions(history,{...request,selections:[request.selections[0],{featureId:'cut.a',targetBodyId:'body.other'}]},services),/explicit body writer/);
 assert.equal(called.commit,0);
});
test('selection rejects stale predecessor and changed source profile',()=>{
 const {history,services,request,features}=fixture();
 features[3].dependsOn=['extrude.other','sketch.cut'];
 assert.throws(()=>inspectSelectedFeatureDimensions(history,request,services),/predecessor/);
 features[3].dependsOn=['extrude.body','sketch.cut'];
 features[3].payload.profileCandidateId='cycle:old';
 assert.throws(()=>inspectSelectedFeatureDimensions(history,request,services),/predecessor/);
});
test('Apply refuses partial, duplicate, no-op and malformed editor changes',()=>{
 const {history,services,request}=fixture();
 const selection=inspectSelectedFeatureDimensions(history,request,services);
 const good=[{featureId:'extrude.body',eventId:'edit.extrude',toDepthMm:14},{featureId:'cut.a',eventId:'edit.cut',toExtent:{kind:'blind',depthMm:5}}];
 const cases=[
  [good[0]],
  [{...good[0],toDepthMm:10},good[1]],
  [good[0],{...good[1],eventId:'edit.extrude'}],
  [good[0],{...good[1],toExtent:{kind:'blind',depthMm:0}}],
  [good[0],{...good[1],toExtent:{kind:'through_all',depthMm:5}}],
  [good[0],{...good[1],featureId:'cut.other'}],
  [good[0],{...good[1],unknown:true}]
 ];
 for(const broken of cases)assert.throws(()=>prepareSelectedFeatureDimensionEdits(selection,broken));
 assert.equal(prepareSelectedFeatureDimensionEdits(selection,good).edits.length,2);
});
