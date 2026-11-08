import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseOcct8OrthogonalProfileRequest,expectedOcct8OrthogonalMetrics,
  assessOcct8OrthogonalResponse} from '../src/occt8-orthogonal-profile-v4.mjs';
import {runPinnedOcct8OrthogonalProfileChain}
  from '../src/local-occt8-orthogonal-profile-provider.mjs';
import {requestFromRuntimeOcct8Orthogonal}
  from '../src/runtime-occt8-orthogonal-profile-provider.mjs';
import {buildAuthoredLBracket,editAuthoredLBracketThickness,MODEL_L_BODY_ID,
  MODEL_L_CUT_IDS} from '../examples/runtime-occt8-l-profile-document.mjs';
import {buildAuthoredUBracket,editAuthoredUBracketThickness,
  editAuthoredUBracketRightFlange,editAuthoredUBracketPocketDepth,
  MODEL_U_BODY_ID,MODEL_U_CUT_IDS,MODEL_PARTNER_BODY_ID,MODEL_PARTNER_CUT_IDS}
  from '../examples/runtime-occt8-u-profile-document.mjs';

const FIXTURE=JSON.parse(await readFile(
  new URL('../../../native/examples/occt8-u-bracket-orthogonal.request.json',import.meta.url)));
const edit=callback=>{const q=structuredClone(FIXTURE);callback(q);return q;};

test('U-bracket: selected eight-edge concave profile, ordered cutters, analytic output',()=>{
  const q=parseOcct8OrthogonalProfileRequest(FIXTURE);
  assert.equal(q.profile.vertices.length,8);
  assert.deepEqual(q.cuts.map(c=>c.featureId),[
    'cut.left.blind','cut.right.through']);
  const m=expectedOcct8OrthogonalMetrics(q);
  assert.ok(Math.abs(m.volumeMm3-(48800-75*Math.PI-960))<1e-8);
  assert.ok(Math.abs(m.surfaceAreaMm2-(16200+30*Math.PI+112))<1e-8);
  const changed=edit(q=>{
    q.profile.thickness=12;q.cuts[1].cutDepthMm=12;q.revision=9;
  });
  const p=parseOcct8OrthogonalProfileRequest(changed);
  assert.deepEqual(p.cuts.map(c=>c.featureId),q.cuts.map(c=>c.featureId));
  assert.equal(p.profile.profileId,q.profile.profileId);
  const rebuilt=expectedOcct8OrthogonalMetrics(p);
  assert.ok(Math.abs(rebuilt.volumeMm3-(73200-75*Math.PI-1440))<1e-8);
});

test('recess, boundary contact, overlap, wrong winding, altered profile identity fail closed',()=>{
  const bad=[
    edit(q=>{q.cuts[0].x=0;q.cuts[0].y=10;}),
    edit(q=>{q.cuts[0].x=-55;q.cuts[0].y=10;}),
    edit(q=>{q.cuts[0].x=47;q.cuts[0].y=10;}),
    edit(q=>{q.cuts[0].featureId=q.profile.profileId;}),
    edit(q=>{q.profile.vertices.reverse();}),
    edit(q=>{q.profile.vertices[4]={x:35,y:40};}),
    edit(q=>{q.cuts[1].cutDepthMm=9;}),
    edit(q=>{q.units='in';}),
  ];
  for(const q of bad)
    assert.throws(()=>parseOcct8OrthogonalProfileRequest(q));
});

test('native report: stale revisions and wrong physical/STEP mass cannot become authority',()=>{
  const q=parseOcct8OrthogonalProfileRequest(FIXTURE);
  const m=expectedOcct8OrthogonalMetrics(q);
  const metric={valid:true,solidCount:1,...m,cylindricalHoles:[
    {x:-47,y:10,radius:5,axisZ:1}
  ]};
  const response={protocol:q.protocol,requestId:q.requestId,
    featureId:q.featureId,revision:q.revision,
    backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',status:'validated_exact',
    units:'mm',source:metric,stepReadback:metric,stepWritten:true,
    stepPath:'/private/u.step',stepSha256:'0'.repeat(64),
    stepVerification:'occt-8.0.1-same-engine'};
  const assessment=assessOcct8OrthogonalResponse(q,response,{currentRevision:8});
  assert.equal(assessment.kind,'experimental_report');
  assert.equal(assessment.exactAuthority,false);
  assert.equal(assessment.independentInteroperability,false);
  assert.equal(assessOcct8OrthogonalResponse(q,response,{currentRevision:9}).code,'stale_revision');
  assert.throws(()=>assessOcct8OrthogonalResponse(q,{...response,
    source:{...metric,volumeMm3:m.volumeMm3-90}},{currentRevision:8}),/mass/);
  assert.throws(()=>assessOcct8OrthogonalResponse(q,{...response,
    stepVerification:'independent-CAD'},{currentRevision:8}),/STEP receipt/);
});

test('real INTENT/SKETCH/RUNTIME journal L is also representable as contour v4',()=>{
  const before=buildAuthoredLBracket();
  const options=f=>({runtime:f.runtime,model:f.model,requestId:'u.runtime',exportStep:true});
  const base=requestFromRuntimeOcct8Orthogonal(before.history,MODEL_L_BODY_ID,options(before));
  assert.equal(base.profile.vertices.length,6);
  assert.equal(base.profile.profileId,'sketch.bracket');
  assert.deepEqual(base.cuts.map(c=>c.featureId),MODEL_L_CUT_IDS);
  assert.equal(expectedOcct8OrthogonalMetrics(base).volumeMm3,32720);
  const changed=editAuthoredLBracketThickness(before,12);
  const rebuilt=requestFromRuntimeOcct8Orthogonal(
    changed.history,MODEL_L_BODY_ID,options(changed));
  assert.equal(rebuilt.profile.thickness,12);
  assert.equal(expectedOcct8OrthogonalMetrics(rebuilt).volumeMm3,49200);
  assert.equal(rebuilt.profile.profileId,base.profile.profileId);
  const reopened=changed.runtime.reopen(changed.runtime.save(changed.history));
  const afterReopen=requestFromRuntimeOcct8Orthogonal(
    reopened,MODEL_L_BODY_ID,options(changed));
  assert.deepEqual(afterReopen.profile.vertices,rebuilt.profile.vertices);
  assert.deepEqual(afterReopen.cuts,rebuilt.cuts);
});

test('uninstalled native binary never yields fabricated exact geometry or STEP',async()=>{
  const q={...FIXTURE,exportStep:false};
  const r=await runPinnedOcct8OrthogonalProfileChain(q,{
    workerExecutable:'/intuit3d/nonexistent/occt8',
    readCurrentRevision:()=>q.revision,timeoutMs:1000,
  });
  assert.equal(r.kind,'unresolved');
  assert.equal(r.artifact,null);
});

test('real authored U SKETCH -> ordered cuts -> retrospective 8 to 12 mm -> undo/reopen',()=>{
  const before=buildAuthoredUBracket();
  const opts=fixture=>({runtime:fixture.runtime,model:fixture.model,
    requestId:'native.real.u',exportStep:true});
  const base=requestFromRuntimeOcct8Orthogonal(
    before.history,MODEL_U_BODY_ID,opts(before));
  assert.equal(base.profile.profileId,'sketch.u');
  assert.equal(base.profile.vertices.length,8);
  assert.deepEqual(base.cuts.map(c=>c.featureId),MODEL_U_CUT_IDS);
  assert.deepEqual(base.cuts.map(c=>c.kind),['rectangle','rectangle']);
  assert.deepEqual(base.cuts.map(c=>c.cutDepthMm),[8,3]);
  assert.equal(expectedOcct8OrthogonalMetrics(base).volumeMm3,47600);
  const changed=editAuthoredUBracketThickness(before,12);
  assert.ok(changed.invalidation.invalidatedFeatureIds.includes('extrude.u'));
  for(const id of MODEL_U_CUT_IDS)
    assert.ok(changed.invalidation.invalidatedFeatureIds.includes(id));
  assert.ok(!changed.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
  const undone=changed.runtime.undo(changed.history,['undo.u.extrude']);
  const redone=changed.runtime.redo(undone,['redo.u.extrude']);
  assert.equal(requestFromRuntimeOcct8Orthogonal(
    undone,MODEL_U_BODY_ID,opts(changed)).profile.thickness,8);
  assert.equal(requestFromRuntimeOcct8Orthogonal(
    redone,MODEL_U_BODY_ID,opts(changed)).profile.thickness,12);
  const reopened=changed.runtime.reopen(changed.runtime.save(changed.history));
  const after=requestFromRuntimeOcct8Orthogonal(
    reopened,MODEL_U_BODY_ID,opts(changed));
  assert.equal(after.profile.thickness,12);
  assert.deepEqual(after.profile.vertices,base.profile.vertices);
  assert.deepEqual(after.cuts.map(c=>c.featureId),MODEL_U_CUT_IDS);
  assert.deepEqual(after.cuts.map(c=>c.cutDepthMm),[12,3]);
  assert.equal(expectedOcct8OrthogonalMetrics(after).volumeMm3,71520);
});


test('authored U right flange and blind pocket edits preserve body identity and replay',()=>{
  const original=buildAuthoredUBracket();
  const opts=f=>({runtime:f.runtime,model:f.model,
    requestId:'u.runtime.edits',exportStep:true});
  const initial=requestFromRuntimeOcct8Orthogonal(
    original.history,MODEL_U_BODY_ID,opts(original));
  assert.equal(expectedOcct8OrthogonalMetrics(initial).volumeMm3,47600);
  const thick=editAuthoredUBracketThickness(original,12);
  assert.equal(expectedOcct8OrthogonalMetrics(requestFromRuntimeOcct8Orthogonal(
    thick.history,MODEL_U_BODY_ID,opts(thick))).volumeMm3,71520);
  const flange=editAuthoredUBracketRightFlange(thick,130);
  const wider=requestFromRuntimeOcct8Orthogonal(
    flange.history,MODEL_U_BODY_ID,opts(flange));
  assert.equal(wider.profile.vertices[1].x,70);
  assert.equal(wider.profile.vertices[2].x,70);
  assert.equal(expectedOcct8OrthogonalMetrics(wider).volumeMm3,81120);
  assert.deepEqual(wider.cuts.map(c=>c.featureId),MODEL_U_CUT_IDS);
  for(const id of ['sketch.u','extrude.u',...MODEL_U_CUT_IDS])
    assert.ok(flange.invalidation.invalidatedFeatureIds.includes(id));
  assert.ok(!flange.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
  const pocket=editAuthoredUBracketPocketDepth(flange,5);
  const final=requestFromRuntimeOcct8Orthogonal(
    pocket.history,MODEL_U_BODY_ID,opts(pocket));
  assert.equal(final.cuts[1].cutDepthMm,5);
  assert.equal(expectedOcct8OrthogonalMetrics(final).volumeMm3,80960);
  assert.equal(final.profile.profileId,initial.profile.profileId);
  const undo=pocket.runtime.undo(pocket.history,['undo.u.depth']);
  const redo=pocket.runtime.redo(undo,['redo.u.depth']);
  assert.equal(requestFromRuntimeOcct8Orthogonal(
    undo,MODEL_U_BODY_ID,opts(pocket)).cuts[1].cutDepthMm,3);
  assert.equal(requestFromRuntimeOcct8Orthogonal(
    redo,MODEL_U_BODY_ID,opts(pocket)).cuts[1].cutDepthMm,5);
  const reopened=pocket.runtime.reopen(pocket.runtime.save(pocket.history));
  assert.deepEqual(requestFromRuntimeOcct8Orthogonal(
    reopened,MODEL_U_BODY_ID,opts(pocket)),final);
  assert.throws(()=>editAuthoredUBracketPocketDepth(pocket,0),/depth/);
  assert.throws(()=>editAuthoredUBracketPocketDepth(pocket,13),/depth/);
  assert.throws(()=>editAuthoredUBracketRightFlange(original,110));
  assert.equal(requestFromRuntimeOcct8Orthogonal(
    original.history,MODEL_U_BODY_ID,opts(original)).profile.vertices[1].x,60);
});

test('two named bodies: independent solved profiles, ordered targeted cuts, and unchanged nondependent solid',()=>{
  const original=buildAuthoredUBracket();
  const opts=f=>({runtime:f.runtime,model:f.model,
    requestId:'two.body.qualification',exportStep:true});
  const u=requestFromRuntimeOcct8Orthogonal(
    original.history,MODEL_U_BODY_ID,opts(original));
  const partner=requestFromRuntimeOcct8Orthogonal(
    original.history,MODEL_PARTNER_BODY_ID,opts(original));
  assert.equal(u.featureId,MODEL_U_BODY_ID);
  assert.equal(partner.featureId,MODEL_PARTNER_BODY_ID);
  assert.notEqual(u.profile.profileId,partner.profile.profileId);
  assert.notEqual(u.profile.vertices.length,partner.profile.vertices.length);
  assert.deepEqual(partner.cuts.map(c=>c.featureId),MODEL_PARTNER_CUT_IDS);
  assert.deepEqual(partner.cuts.map(c=>c.kind),['rectangle','rectangle']);
  assert.deepEqual(partner.cuts.map(c=>c.cutDepthMm),[6,2]);
  assert.equal(partner.profile.thickness,6);
  assert.equal(expectedOcct8OrthogonalMetrics(partner).volumeMm3,10156);
  assert.equal(expectedOcct8OrthogonalMetrics(u).volumeMm3,47600);

  // One original authoritative project and a physically independent body
  // writer DAG: editing the U changes neither partner sketch nor its cutters.
  const changes=[
    editAuthoredUBracketThickness(original,12),
  ];
  changes.push(editAuthoredUBracketRightFlange(changes.at(-1),130));
  changes.push(editAuthoredUBracketPocketDepth(changes.at(-1),5));
  for(const changed of changes){
    for(const id of ['sketch.partner','extrude.partner',...MODEL_PARTNER_CUT_IDS])
      assert.ok(!changed.invalidation.invalidatedFeatureIds.includes(id),
        'U edit dirtied unrelated named body '+id);
    const other=requestFromRuntimeOcct8Orthogonal(
      changed.history,MODEL_PARTNER_BODY_ID,opts(changed));
    assert.deepEqual(other.profile,partner.profile);
    assert.deepEqual(other.cuts,partner.cuts);
    assert.equal(expectedOcct8OrthogonalMetrics(other).volumeMm3,10156);
  }
  const final=changes.at(-1);
  const snapshot=final.runtime.save(final.history);
  const reopened=final.runtime.reopen(snapshot);
  const restored=requestFromRuntimeOcct8Orthogonal(
    reopened,MODEL_PARTNER_BODY_ID,opts(final));
  assert.deepEqual(restored.profile,partner.profile);
  assert.deepEqual(restored.cuts,partner.cuts);
  assert.equal(expectedOcct8OrthogonalMetrics(
    requestFromRuntimeOcct8Orthogonal(
      reopened,MODEL_U_BODY_ID,opts(final))).volumeMm3,80960);
  // v4 deliberately excludes a four-vertex rectangular base: no implicit
  // conversion of the independent spacer into an arbitrary target solid.
  assert.throws(()=>requestFromRuntimeOcct8Orthogonal(
    reopened,'body.spacer',opts(final)));
});
