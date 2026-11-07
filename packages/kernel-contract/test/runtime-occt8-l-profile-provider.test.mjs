import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestFromRuntimeOcct8LProfile,runPinnedRuntimeOcct8LProfile,
} from '../src/runtime-occt8-l-profile-provider.mjs';
import {
  buildAuthoredLBracket,editAuthoredLBracketThickness,
  MODEL_L_BODY_ID,MODEL_L_CUT_IDS,
} from '../examples/runtime-occt8-l-profile-document.mjs';
import {expectedOcct8LProfileMetrics} from '../src/occt8-l-profile-v3.mjs';

const options=(f,requestId='native.l.fixture')=>({
  runtime:f.runtime,model:f.model,requestId,exportStep:true,
});
test('actual committed INTENT/SKETCH/RUNTIME 6-edge L maps to typed C++ geometry',()=>{
  const f=buildAuthoredLBracket();
  const q=requestFromRuntimeOcct8LProfile(f.history,MODEL_L_BODY_ID,options(f));
  assert.equal(q.protocol,'intuit3d/kernel/l-profile-cut-chain-v3');
  assert.equal(q.featureId,MODEL_L_BODY_ID);
  assert.equal(q.profile.profileId,'sketch.bracket');
  assert.deepEqual(
    [q.profile.width,q.profile.depth,q.profile.legWidth,q.profile.footHeight,q.profile.thickness],
    [120,80,30,20,8]);
  assert.deepEqual(q.cuts.map(x=>x.featureId),MODEL_L_CUT_IDS);
  assert.deepEqual(q.cuts.map(x=>x.kind),['rectangle','rectangle']);
  assert.deepEqual(q.cuts.map(x=>x.cutDepthMm),[8,3]);
  assert.equal(expectedOcct8LProfileMetrics(q).volumeMm3,32720);
  // An unrelated body exists but is never accidentally included in this STEP.
  assert.ok(f.model.featuresOf(f.history.document).some(x=>
    x.writeTargets?.includes('body.spacer')));
});

test('retrospective 8 -> 12 mm edit only invalidates dependency branch; undo and archive replay',()=>{
  const f=buildAuthoredLBracket();
  const edited=editAuthoredLBracketThickness(f,12);
  const q=requestFromRuntimeOcct8LProfile(
    edited.history,MODEL_L_BODY_ID,options(edited));
  assert.equal(q.profile.thickness,12);
  assert.deepEqual(q.cuts.map(x=>x.cutDepthMm),[12,3]);
  assert.equal(expectedOcct8LProfileMetrics(q).volumeMm3,49200);
  for(const id of ['extrude.bracket',...MODEL_L_CUT_IDS])
    assert.ok(edited.invalidation.invalidatedFeatureIds.includes(id),id);
  assert.ok(!edited.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
  const undo=edited.runtime.undo(edited.history,['undo.l.thickness']);
  const redo=edited.runtime.redo(undo,['redo.l.thickness']);
  assert.equal(requestFromRuntimeOcct8LProfile(
    undo,MODEL_L_BODY_ID,options(edited,'native.undo')).profile.thickness,8);
  assert.equal(requestFromRuntimeOcct8LProfile(
    redo,MODEL_L_BODY_ID,options(edited,'native.redo')).profile.thickness,12);
  const reopen=edited.runtime.reopen(edited.runtime.save(edited.history));
  assert.equal(requestFromRuntimeOcct8LProfile(
    reopen,MODEL_L_BODY_ID,options(edited,'native.reopen')).profile.thickness,12);
});

test('rejects wrong body, stale RUNTIME, and shifted or mirrored unsupported L',()=>{
  const f=buildAuthoredLBracket();
  assert.throws(()=>requestFromRuntimeOcct8LProfile(
    f.history,'body.spacer',options(f)),/unique base extrusion|body cuts/);
  const staleRuntime={inspect:h=>({...f.runtime.inspect(h),revision:h.document.revision-1})};
  assert.throws(()=>requestFromRuntimeOcct8LProfile(
    f.history,MODEL_L_BODY_ID,{...options(f),runtime:staleRuntime}),
    /exact-revision|RUNTIME/i);
  function mutateProfile(pointTransform) {
    const runtime={inspect:h=>{
      const r=structuredClone(f.runtime.inspect(h));
      const a=r.features.find(x=>x.featureId==='sketch.bracket');
      const b=r.features.find(x=>x.featureId==='extrude.bracket');
      for(const p of a.profile.outer)pointTransform(p);
      b.profile=structuredClone(a.profile);
      return r;
    }};
    return requestFromRuntimeOcct8LProfile(
      f.history,MODEL_L_BODY_ID,{...options(f),runtime});
  }
  assert.throws(()=>mutateProfile(p=>{p.x+=10;}),/centered local XY/);
  assert.throws(()=>mutateProfile(p=>{p.x=-p.x;}),/counterclockwise|solved|area/);
});

test('missing pinned binary remains unresolved, never exact or exported',async()=>{
  const f=buildAuthoredLBracket();
  const r=await runPinnedRuntimeOcct8LProfile(f.history,MODEL_L_BODY_ID,{
    ...options(f),workerExecutable:'/intuit3d/not-an-OCCT8-worker',
    readCurrentRevision:()=>f.history.document.revision,
  });
  assert.equal(r.kind,'unresolved');
  assert.equal(r.semanticBodyId,MODEL_L_BODY_ID);
  assert.equal(r.exactAuthority,false);
  assert.equal(r.independentInteroperability,false);
  assert.equal(r.runtimeOcct8LProfileVersion,1);
});
