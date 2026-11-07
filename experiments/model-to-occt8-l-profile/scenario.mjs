/** Two ordered cuts on an L-bracket plus an independent spacer, semantic only. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mapAdmittedChainToPinnedL,admitFreshReceipt} from './adapter.mjs';
import {reconfigureOrderedCutExtent,ORDERED_CUT_EXTENT_EDIT_FORMAT,ORDERED_CUT_EXTENT_EDIT_VERSION}
 from '@intuit3d/feature-ops/ordered-cut-extent-edit/v1';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as cutChain from '@intuit3d/model/body-cut-chain';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorProfileExtrusion,authorProfileBodyCut,editExtrudeThickness,
  PROFILE_OPS_FORMAT,PROFILE_OPS_VERSION} from '@intuit3d/feature-ops';
import {appendOrderedProfileCut,ORDERED_CUT_FORMAT,ORDERED_CUT_VERSION}
  from '@intuit3d/feature-ops/ordered-cut/v1';
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={runtime,model,sketch,discovery,cutChain};
function profile(key,coords) {
  const points=coords.map(([x,y],n)=>({id:key+'.p'+n,x,y}));
  return sketch.validateSketch({version:1,units:'mm',points,
    lines:points.map((p,n)=>({id:key+'.e'+n,start:p.id,end:points[(n+1)%points.length].id})),
    circles:[],constraints:points.map(p=>({id:'fix.'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}))});
}
const shapes=[
  ['sketch.bracket',profile('bracket',[[-60,-40],[60,-40],[60,-15],[-30,-15],[-30,40],[-60,40]])],
  ['sketch.slot',profile('slot',[[-50,-32],[-20,-32],[-20,-22],[-50,-22]])],
  ['sketch.pocket',profile('pocket',[[-50,-5],[-37,-5],[-37,20],[-50,20]])],
  ['sketch.spacer',profile('spacer',[[0,0],[40,0],[40,20],[0,20]])]
];
let h=transactions.startUndoHistory(model.newProject('two-ordered-cut-bracket'));
h=runtime.commit(h,shapes.map(([id,doc])=>({eventId:'make.'+id,
  type:'feature.create',feature:{id,kind:'sketch',dependsOn:[],writeTargets:[],payload:{sketch:doc}}})),h.document.revision);
const selected=Object.fromEntries(shapes.map(([id,doc])=>{
  const proposed=discovery.discoverPlateProfiles(doc);
  if(proposed.status!=='ready'||proposed.candidates.length!==1)throw Error('unadmitted '+id);
  return [id,proposed.candidates[0].id];
}));
function addExtrude(sketchId,extrudeId,bodyId,depthMm) {
  const next=authorProfileExtrusion(h,{format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
    eventId:'author.'+extrudeId,expectedRevision:h.document.revision,sourceSketchId:sketchId,
    profileCandidateId:selected[sketchId],extrudeFeatureId:extrudeId,outputBodyId:bodyId,
    depthMm,units:'mm',frame:'local_xy'},services);
  h=next.history;
}
addExtrude('sketch.bracket','extrude.bracket','body.bracket',8);
addExtrude('sketch.spacer','extrude.spacer','body.spacer',5);
h=authorProfileBodyCut(h,{format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
  eventId:'author.cut.slot',expectedRevision:h.document.revision,
  sourceSketchId:'sketch.slot',profileCandidateId:selected['sketch.slot'],
  extrudeFeatureId:'extrude.bracket',cutFeatureId:'cut.slot',targetBodyId:'body.bracket',
  units:'mm',frame:'local_xy'},services).history;
const cut=appendOrderedProfileCut(h,{format:ORDERED_CUT_FORMAT,version:ORDERED_CUT_VERSION,
  expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
  eventId:'author.cut.pocket',sourceSketchId:'sketch.pocket',
  profileCandidateId:selected['sketch.pocket'],afterBodyWriterId:'cut.slot',
  cutFeatureId:'cut.pocket',targetBodyId:'body.bracket',units:'mm',frame:'local_xy',
  extent:{kind:'blind',depthMm:3}},services);
h=cut.history;
const before=h;
const initialMapping=await admitPinnedRequest(before,'r8');
// The first cut is an explicit through-all feature; the ordered pocket is blind.
const extentEdit={format:ORDERED_CUT_EXTENT_EDIT_FORMAT,
 version:ORDERED_CUT_EXTENT_EDIT_VERSION,units:'mm',frame:'local_xy',
 eventId:'pocket.3to5',expectedProjectId:h.document.projectId,
 expectedRevision:h.document.revision,cutFeatureId:'cut.pocket',
 targetBodyId:'body.bracket',
 from:{afterBodyWriterId:'cut.slot',sourceSketchId:'sketch.pocket',
 profileCandidateId:selected['sketch.pocket'],extent:{kind:'blind',depthMm:3}},
 toExtent:{kind:'blind',depthMm:5}};
const documentBefore=JSON.stringify(h.document);
for(const modified of [
 {...extentEdit,expectedRevision:extentEdit.expectedRevision-1},
 {...extentEdit,targetBodyId:'body.spacer'},
 {...extentEdit,from:{...extentEdit.from,sourceSketchId:'sketch.deleted'}},
 {...extentEdit,from:{...extentEdit.from,profileCandidateId:'cycle:obsolete'}}
]){assert.throws(()=>reconfigureOrderedCutExtent(h,modified,services));
 assert.equal(JSON.stringify(h.document),documentBefore);}
const pocketEdit=reconfigureOrderedCutExtent(h,extentEdit,services);
assert.ok(pocketEdit.invalidation.invalidatedFeatureIds.includes('cut.pocket'));
assert.ok(!pocketEdit.invalidation.invalidatedFeatureIds.includes('extrude.spacer'));
h=pocketEdit.history;
const undonePocket=runtime.undo(h,['undo.pocket.3to5']);
assert.equal(cutChain.inspectBodyCutExtent(undonePocket.document,'cut.pocket','body.bracket').extent.depthMm,3);
h=runtime.redo(undonePocket,['redo.pocket.3to5']);
assert.equal(cutChain.inspectBodyCutExtent(h.document,'cut.pocket','body.bracket').extent.depthMm,5);
const edit=editExtrudeThickness(h,{eventId:'thicken.bracket',featureId:'extrude.bracket',
  expectedRevision:h.document.revision,thicknessMm:12},services);
const reopened=runtime.reopen(runtime.save(runtime.redo(runtime.undo(edit.history,['undo.thicken']),['redo.thicken'])));
const features=model.featuresOf(reopened.document);
const answer={
  semanticBodyTerminal:cutChain.inspectBodyCutChain(reopened.document,'body.bracket').eligibleAfterWriterId,
  pocketDepthMm:features.find(f=>f.id==='cut.pocket').payload.depthMm,
  afterEditThicknessMm:features.find(f=>f.id==='extrude.bracket').payload.thicknessMm,
  independentSpacerThicknessMm:features.find(f=>f.id==='extrude.spacer').payload.thicknessMm,
  pocketRuntimeStatus:runtime.inspect(reopened).features.find(f=>f.featureId==='cut.pocket').status,
  affected:edit.invalidation.invalidatedFeatureIds,
  exactAuthority:false,independentInteroperability:false
};
if(answer.affected.includes('extrude.spacer'))throw Error('unrelated spacer invalidated');
console.log(JSON.stringify(answer,null,2));

const SOURCE_MAIN='156118e021cba6c431aa70cbfbd3a0bf5b04dcf6';
const SOURCE_KERNEL='d18cee2861d487d82790d07d6c6e1eaa77f783b9';
const SOURCE_OCCT='b8f597c677811d1f9f4d8a97f5ae2825c0353a42';
const out=resolve(process.argv[2]||'/tmp/intuit3d-l-contract-experiment');
await mkdir(out,{recursive:true});
const finalMapping=await admitPinnedRequest(reopened,'r12');
let beforePhysical={kind:'pending_physical',reason:'pinned worker/source absent'};
let afterPhysical={kind:'pending_physical',reason:'pinned worker/source absent'};
if(initialMapping && finalMapping) {
 assert.equal(initialMapping.request.profile.thickness,8);
 assert.equal(finalMapping.request.profile.thickness,12);
 assert.deepEqual(initialMapping.request.cuts.map(c=>c.cutDepthMm),[8,3]);
 assert.deepEqual(finalMapping.request.cuts.map(c=>c.cutDepthMm),[12,5]);
 assert.equal(initialMapping.request.profile.profileId,finalMapping.request.profile.profileId);
 assert.equal(initialMapping.request.featureId,finalMapping.request.featureId);
 assert.notEqual(initialMapping.request.revision,finalMapping.request.revision);
 const admitted=await loadKernel67();
 const worker=process.env.INTUIT3D_OCCT8_WORKER;
 if(worker && process.env.INTUIT3D_OCCT8_SOURCE_SHA===SOURCE_OCCT){
  try {await access(worker,FS.X_OK);
    const exec=async(mapping,history,label)=>{
     const receipt=await admitted.provider.runPinnedOcct8LProfileChain(mapping.request,{
      workerExecutable:resolve(worker),readCurrentRevision:()=>history.document.revision,
      stepOutput:join(out,label+'.step'),timeoutMs:120000});
     if(receipt.kind!=='experimental_report')return {kind:'pending_physical',result:receipt};
     return {...admitFreshReceipt(mapping,receipt,history.document.projectId,
       history.document.revision),artifact:receipt.artifact,
       observed:receipt.observed};
    };
    beforePhysical=await exec(initialMapping,before,'l-8-pocket-3');
    afterPhysical=await exec(finalMapping,reopened,'l-12-pocket-5');
    if(beforePhysical.kind==='experimental_physical_only'&&
       afterPhysical.kind==='experimental_physical_only'){
     assert.notEqual(beforePhysical.stepSha256,afterPhysical.stepSha256);
     assert.ok(beforePhysical.observed.source.volumeMm3 <
               afterPhysical.observed.source.volumeMm3);
    }
  }catch(e){if(e?.code!=='ENOENT' && e?.code!=='EACCES')throw e;}
 }
 if(beforePhysical.kind==='experimental_physical_only')
  assert.throws(()=>admitFreshReceipt(initialMapping,{
    kind:'experimental_report',revision:initialMapping.request.revision,
    featureId:initialMapping.request.featureId,
    profileId:initialMapping.request.profile.profileId,
    cutFeatureIds:initialMapping.request.cuts.map(c=>c.featureId),
    artifact:{sha256:beforePhysical.stepSha256},exactAuthority:false,
    independentInteroperability:false
  },reopened.document.projectId,reopened.document.revision));
 const tampered=structuredClone(finalMapping.request);
 // The conversion must never admit a mutated, unsupported six-sided L.
 const raw=admitted.chain.requestFromRuntimeBodyCutChain(reopened,'body.bracket',{
  runtime,model,requestId:'cad.tampered',exportStep:true});
 raw.baseExtrude.profile.boundary[0].end.y+=1;
 const sketchState=runtime.inspect(reopened).features;
 const proof=makeSelection(reopened,raw);
 assert.throws(()=>mapAdmittedChainToPinnedL(raw,proof,reopened.document.revision));
}
await writeFile(join(out,'authoritative-history.json'),runtime.save(reopened),{flag:'wx'});
await writeFile(join(out,'manifest.json'),JSON.stringify({
 sourceMain:SOURCE_MAIN,sourceKernel67:SOURCE_KERNEL,pinnedOcctSource:SOURCE_OCCT,
 revisionBefore:before.document.revision,revisionAfter:reopened.document.revision,
 selectedProfiles:selected,
 identities:{base:'extrude.bracket',body:'body.bracket',orderedCuts:['cut.slot','cut.pocket']},
 expectedVolume8Pocket3:33825,expectedVolume12Pocket5:50575,
 initialMapping,finalMapping,beforePhysical,afterPhysical,
 pocketInvalidation:pocketEdit.invalidation,thicknessInvalidation:edit.invalidation,
 pendingExact:true,exactAuthority:false,independentInteroperability:false
},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({contractExperiment:'DONE',pinnedSource:SOURCE_KERNEL,
 semanticUndoRedoArchive:'passed',mapping:finalMapping?'admitted':'missing_unmerged_PR67_source',
 beforePhysical:beforePhysical.kind,afterPhysical:afterPhysical.kind,
 expectedVolumes:[33825,50575]},null,2));

async function loadKernel67(){
 const root=process.env.INTUIT3D_KERNEL67_ROOT;
 if(!root)return null;
 const src=name=>import(pathToFileURL(resolve(root,'packages/kernel-contract/src',name)).href);
 return {chain:await src('runtime-body-cut-chain-provider.mjs'),
  contract:await src('occt8-l-profile-v3.mjs'),
  provider:await src('local-occt8-l-profile-provider.mjs')};
}
function makeSelection(history,request){
 const active=model.featuresOf(history.document);
 const report=runtime.inspect(history);
 const inspectSketch=id=>{
  const f=active.find(x=>x.id===id),state=report.features.find(x=>x.featureId===id);
  assert.equal(f?.kind,'sketch');
  const doc=sketch.validateSketch(f.payload.sketch);
  const d=discovery.discoverPlateProfiles(doc);
  assert.equal(d.status,'ready');assert.equal(d.candidates.length,1);
  assert.equal(d.candidates[0].id,selected[id]);
  assert.deepEqual(discovery.admitDiscoveredPlateProfile(doc,d,selected[id]),state.profile);
  return {sourceSketchId:id,profileCandidateId:selected[id],
   sourceSignature:state.sketchSignature};
 };
 const base=inspectSketch('sketch.bracket');
 const cuts=request.cuts.map(c=>{
  const f=active.find(x=>x.id===c.cutFeatureId);
  assert.deepEqual(f.writeTargets,['body.bracket']);
  const p=inspectSketch(f.payload.sourceSketchId);
  return {cutFeatureId:c.cutFeatureId,...p};
 });
 return {projectId:history.document.projectId,revision:history.document.revision,
  baseSketchId:base.sourceSketchId,baseProfileCandidateId:base.profileCandidateId,
  baseSourceSignature:base.sourceSignature,cuts};
}
async function admitPinnedRequest(history,label){
 const kernel=await loadKernel67();
 if(!kernel)return null;
 const raw=kernel.chain.requestFromRuntimeBodyCutChain(history,'body.bracket',{
  runtime,model,requestId:'cad.'+label,exportStep:true});
 const evidence=makeSelection(history,raw);
 const adapted=mapAdmittedChainToPinnedL(raw,evidence,history.document.revision);
 assert.equal(kernel.contract.parseOcct8LProfileRequest(adapted.request).featureId,'body.bracket');
 return adapted;
}
