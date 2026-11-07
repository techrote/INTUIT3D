import test from 'node:test';
import assert from 'node:assert/strict';
import {authorMountingFlange,editExtrudeThickness,mountingFlangeSketch,reconfigureMountingFlange,FEATURE_OPS_FORMAT,FEATURE_OPS_VERSION} from '../src/index.mjs';
const spec = (holes=[{id:'northA',xMm:-45,yMm:20,radiusMm:5},{id:'northB',xMm:45,yMm:20,radiusMm:5},{id:'southA',xMm:-45,yMm:-20,radiusMm:5},{id:'southB',xMm:45,yMm:-20,radiusMm:5}]) => ({widthMm:140,depthMm:80,units:'mm',frame:'local_centered_xy',holes});
const services = () => {
  const fakeSketch = {
    validateSketch: o => structuredClone(o),
    solveSketch: () => ({status:'solved'}),
  };
  const discovery = {
    discoverPlateProfiles: () => ({status:'ready',candidates:[{id:'cycle:outer'}]}),
    admitDiscoveredPlateProfile: (s) => ({status:'analytic_profile_only',units:'mm',holes:s.circles,outer:s.points.slice(0,4)}),
  };
  const model = {featuresOf: doc => doc.features};
  const runtime = {
    commit: (h,events,rev) => {
      assert.equal(rev,h.document.revision);
      const features=structuredClone(h.document.features);
      for(const event of events) {
        if(event.type==='feature.create') features.push(event.feature);
        else if(event.type==='feature.edit') {
          const i=features.findIndex(f=>f.id===event.featureId);
          features[i]={...features[i],...event.patch};
        }
      }
      return {document:{revision:rev+events.length,features},events:[...(h.events||[]),...events]};
    },
    inspect: h => ({features:h.document.features.map(f=>({featureId:f.id,
      status:f.kind==='sketch'?'analytic_profile_only':f.kind==='extrude'?'preview_only':'pending_exact_provider'}))}),
    diff: (a,b) => ({previousRevision:a.document.revision,revision:b.document.revision,exactReuseAllowed:false,invalidatedFeatureIds:b.document.features.filter(f=>f.kind!=='sketch').map(f=>f.id)})
  };
  return {sketch:fakeSketch,discovery,model,runtime};
};
const request = () => ({format:FEATURE_OPS_FORMAT,version:FEATURE_OPS_VERSION,eventId:'make.flange',expectedRevision:0,
  sketchFeatureId:'sketch.flange',extrudeFeatureId:'extrude.flange',cutFeatureId:'cut.flange',targetBodyId:'body.flange',thicknessMm:10,spec:spec()});
const history=()=>({document:{revision:0,features:[]}});

test('four-hole mounting flange creates stable SKETCH constraints without polygon/solver duplication',()=>{
  const {sketch,discovery}=services();
  const out=mountingFlangeSketch(spec(),sketch,discovery);
  assert.equal(out.sketch.circles.length,4);
  assert.equal(out.sketch.constraints.length,15);
  assert.deepEqual(out.sketch.points.slice(0,4).map(p=>[p.x,p.y]),[[-70,-40],[70,-40],[70,40],[-70,40]]);
  assert.deepEqual(out.sketch.circles.map(x=>x.id),['hole.northA','hole.northB','hole.southA','hole.southB']);
  assert.equal(out.exactAuthority,false);
});
test('single atomic INTENT transaction with explicit body ordering, dependency edges and revision fence',()=>{
  const out=authorMountingFlange(history(),request(),services());
  assert.equal(out.history.document.revision,3);
  assert.deepEqual(out.history.events.map(e=>e.type),Array(3).fill('feature.create'));
  assert.deepEqual(out.history.document.features[1].dependsOn,['sketch.flange']);
  assert.deepEqual(out.history.document.features[2].dependsOn,['extrude.flange']);
  assert.deepEqual(out.history.document.features[1].writeTargets,['body.flange']);
  assert.deepEqual(out.history.document.features[2].writeTargets,['body.flange']);
  assert.deepEqual(out.history.document.features[2].payload,{sourceSketchId:'sketch.flange',targetBodyId:'body.flange'});
  assert.deepEqual(out.nativeHandoff,{kind:'experimental_plate_only',cutFeatureId:'cut.flange',bodyId:'body.flange',sourceRevision:3,exactAuthority:false,independentInteroperability:false});
});
test('thickness edits preserve semantic body identity and invalidate dependent operations',()=>{
  const s=services(); const initial=authorMountingFlange(history(),request(),s);
  const changed=editExtrudeThickness(initial.history,{eventId:'edit.flange.thickness',featureId:'extrude.flange',expectedRevision:3,thicknessMm:15},s);
  assert.equal(changed.history.document.features[1].payload.thicknessMm,15);
  assert.equal(changed.history.document.features[1].writeTargets[0],'body.flange');
  assert.equal(changed.status,'preview_only');
  assert.ok(changed.invalidation.invalidatedFeatureIds.includes('cut.flange'));
});
test('rejects stale revision, duplicate identity, invalid hole dimension/frame and wrong source',()=>{
  const s=services(); const h=history();
  assert.throws(()=>authorMountingFlange(h,{...request(),expectedRevision:1},s),/stale/);
  assert.throws(()=>authorMountingFlange(h,{...request(),cutFeatureId:'extrude.flange'},s),/duplicate/);
  assert.throws(()=>authorMountingFlange(h,{...request(),spec:spec([{id:'x',xMm:0,yMm:0,radiusMm:0}])},s),/radiusMm/);
  assert.throws(()=>authorMountingFlange(h,{...request(),spec:{...spec(),frame:'world_xy'}},s),/frame/);
  assert.throws(()=>authorMountingFlange(h,{...request(),spec:spec([{id:'a',xMm:0,yMm:0,radiusMm:5},{id:'a',xMm:4,yMm:5,radiusMm:2}])},s),/duplicate/);
  assert.throws(()=>authorMountingFlange(h,{...request(),spec:spec([{id:'x:y',xMm:0,yMm:0,radiusMm:2}])},s),/colon/);
  const withWriter={document:{revision:0,features:[{id:'existing',kind:'extrude',writeTargets:['body.flange'],dependsOn:[],payload:{}}]}};
  assert.throws(()=>authorMountingFlange(withWriter,request(),s),/already has a writer/);
  const out=authorMountingFlange(h,request(),s);
  assert.throws(()=>editExtrudeThickness(out.history,{eventId:'x',featureId:'extrude.flange',expectedRevision:2,thicknessMm:12},s),/stale/);
});
test('refuses invalid/unadmitted SKETCH candidate instead of inventing geometry',()=>{
  const s=services();
  s.discovery.discoverPlateProfiles=()=>({status:'ambiguous',candidates:[{id:'a'},{id:'b'}]});
  assert.throws(()=>authorMountingFlange(history(),request(),s),/discovery/);
  s.discovery.discoverPlateProfiles=()=>({status:'ready',candidates:[{id:'a'}]});
  s.sketch.solveSketch=()=>({status:'underconstrained'});
  assert.throws(()=>authorMountingFlange(history(),request(),s),/sketch underconstrained/);
});
test('target identity collision is refused without journal mutation',()=>{
  const h=history(); const s=services(); h.document.features.push({id:'cut.flange',kind:'cut',dependsOn:[],writeTargets:[],payload:{}});
  assert.throws(()=>authorMountingFlange(h,request(),s),/already exists/);
  assert.equal(h.document.revision,0);
});


test('reconfiguration atomically changes outline, named holes and extrusion while retaining body lineage',()=>{
  const s=services(), first=authorMountingFlange(history(),request(),s);
  const second=reconfigureMountingFlange(first.history,{
    eventId:'reconfigure.flange',expectedRevision:3,
    sketchFeatureId:'sketch.flange',extrudeFeatureId:'extrude.flange',
    cutFeatureId:'cut.flange',targetBodyId:'body.flange',thicknessMm:16,
    spec:{...spec([
      {id:'northA',xMm:-60,yMm:20,radiusMm:6},
      {id:'northB',xMm:60,yMm:20,radiusMm:6},
      {id:'southC',xMm:0,yMm:-25,radiusMm:8}
    ]),widthMm:180,depthMm:100}
  },s);
  assert.equal(second.history.document.revision,5);
  assert.deepEqual(second.history.events.slice(-2).map(e=>e.type),['feature.edit','feature.edit']);
  assert.deepEqual(second.holeChanges,{added:['hole.southC'],removed:['hole.southA','hole.southB'],
    retained:['hole.northA','hole.northB']});
  assert.equal(second.history.document.features.length,3);
  assert.equal(second.history.document.features[1].payload.thicknessMm,16);
  assert.deepEqual(second.history.document.features[2].writeTargets,['body.flange']);
  assert.deepEqual(second.history.document.features[2].dependsOn,['extrude.flange']);
  assert.ok(second.invalidation.invalidatedFeatureIds.includes('cut.flange'));
  assert.equal(first.history.document.features[1].payload.thicknessMm,10);
  assert.equal(first.history.document.features[0].payload.sketch.circles.length,4);
  assert.equal(second.nativeHandoff.sourceRevision,5);
  assert.equal(second.exactAuthority,false);
});

test('reconfiguration refuses stale revision, no-op, invalid specs and unrelated body or sketch without mutation',()=>{
  const s=services(), first=authorMountingFlange(history(),request(),s);
  const r={eventId:'edit.flange',expectedRevision:3,
    sketchFeatureId:'sketch.flange',extrudeFeatureId:'extrude.flange',
    cutFeatureId:'cut.flange',targetBodyId:'body.flange',thicknessMm:10,spec:spec()};
  assert.throws(()=>reconfigureMountingFlange(first.history,{...r,expectedRevision:2},s),/stale/);
  assert.throws(()=>reconfigureMountingFlange(first.history,r,s),/no change/);
  assert.throws(()=>reconfigureMountingFlange(first.history,{
    ...r,spec:{...spec(),widthMm:-4}},s),/positive finite/);
  const wrong=structuredClone(first.history);
  wrong.document.features[2].payload.targetBodyId='body.other';
  assert.throws(()=>reconfigureMountingFlange(wrong,{...r,thicknessMm:11},s),/lineage/);
  const writer=structuredClone(first.history);
  writer.document.features.push({id:'extraneous',kind:'cut',dependsOn:[],
    writeTargets:['body.flange'],payload:{}});
  assert.throws(()=>reconfigureMountingFlange(writer,{...r,thicknessMm:11},s),/additional writer/);
  assert.equal(first.history.document.revision,3);
  assert.equal(first.history.document.features.length,3);
});

test('reconfiguration refuses unadmitted profiles and retains original journal',()=>{
  const s=services(), first=authorMountingFlange(history(),request(),s);
  s.discovery.discoverPlateProfiles=()=>({status:'ambiguous',candidates:[]});
  assert.throws(()=>reconfigureMountingFlange(first.history,{
    eventId:'bad.config',expectedRevision:3,
    sketchFeatureId:'sketch.flange',extrudeFeatureId:'extrude.flange',
    cutFeatureId:'cut.flange',targetBodyId:'body.flange',thicknessMm:12,
    spec:{...spec(),depthMm:110}
  },s),/discovery/);
  assert.equal(first.history.document.revision,3);
});
