/** Isolated orchestration safety tests. Mock services here are NOT CAD qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflowRuntime, WORKFLOW_RUNTIME_FORMAT} from '../index.mjs';

const sketchDoc = {version:1,units:'mm',points:[],lines:[],circles:[],constraints:[]};
const feature = (id,kind,dependsOn=[],payload={},writeTargets=[])=>
  ({id,kind,dependsOn,payload,writeTargets});
const plan = (items,statuses={}) => ({projectId:'unit.project',revision:3,
  authoredOrder:items.map(f=>f.id),executableOrder:items.filter(f=>!statuses[f.id]).map(f=>f.id),
  features:items.map(f=>({feature:f,status:statuses[f.id]??'ready',diagnostics:[]}))});
const history = {document:{projectId:'unit.project',revision:3}};
function rig(p, overrides={}) {
  const scalarOverrides=overrides.gates??{};
  const services={
    model:{planProject:()=>p},
    transactions:{parseUndoHistory:x=>x,commitUndoableTransaction:(h,events,n)=>({h,events,n}),
      undoTransaction:(h,ids,n)=>({h,ids,n}),redoTransaction:(h,ids,n)=>({h,ids,n})},
    bindings:{evaluateDimensionBindingPlan:()=>({projectId:p.projectId,revision:p.revision,
      featureGates:p.features.map(({feature,status})=>scalarOverrides[feature.id]??{
        featureId:feature.id,status:status==='ready'?'admissible':'unready',
        resolvedPayload:status==='ready'?feature.payload:null,diagnostics:[]})})},
    dimensions:{commitUndoableDimensionEditBatch:(h,r)=>({h,r})},
    archive:{createModelArchive:h=>({history:h}),serializeModelArchive:x=>JSON.stringify(x),
      deserializeModelArchive:x=>JSON.parse(x)},
    sketch:{validateSketch:s=>s,solveSketch:()=>({status:'solved',diagnostics:[]})},
    discovery:{discoverPlateProfiles:()=>({status:'ready',inputSignature:'sketch.sig',
      candidates:[{id:'cycle:plate'}]}),admitDiscoveredPlateProfile:()=>({status:'analytic_profile_only',
        units:'mm',areaMm2:9600,holes:[{id:'holeA'}],outer:[]})},
  };
  Object.assign(services,overrides.services??{});
  return createWorkflowRuntime(services);
}
const sketchFeature = ()=>feature('sketch.plate','sketch',[],{sketch:sketchDoc});
const extrude = (dependsOn=['sketch.plate'],thickness=8)=>feature('plate','extrude',dependsOn,
  {sourceSketchId:'sketch.plate',thicknessMm:thickness},['body.plate']);

test('solver-admitted profile produces only analytic and preview states, never exact solid',()=>{
  const result=rig(plan([sketchFeature(),extrude()])).inspect(history);
  assert.equal(result.format,WORKFLOW_RUNTIME_FORMAT);
  assert.equal(result.revision,3);
  assert.equal(result.exactGeometryAvailable,false);
  assert.deepEqual(result.features.map(x=>x.status),['analytic_profile_only','preview_only']);
  assert.equal(result.features[1].profile.holes[0].id,'holeA');
  assert.equal(result.features[1].evidence,'sketch_analytic_only');
  assert.equal(result.features[1].bodyId,'body.plate');
});

test('unready sketch blocks solid, with no fallback numeric geometry',()=>{
  const p=plan([sketchFeature(),extrude()],{ 'sketch.plate':'pending' });
  const result=rig(p).inspect(history);
  assert.equal(result.features[0].status,'pending_intent');
  assert.equal(result.features[1].status,'blocked_dependency');
  assert.equal(Object.hasOwn(result.features[1],'profile'),false);
});

test('unready scalar gate refuses authored numeric fallback',()=>{
  const p=plan([sketchFeature(),extrude()]);
  const result=rig(p,{gates:{plate:{featureId:'plate',status:'unready',resolvedPayload:null,
    diagnostics:[{code:'MODEL_UNREADY'}]}}}).inspect(history);
  assert.equal(result.features[1].status,'blocked_scalar');
  assert.equal(result.features[1].scalarStatus,'unready');
  assert.equal(Object.hasOwn(result.features[1],'thicknessMm'),false);
});

test('conflicted plan preserves authored order and source diagnostic',()=>{
  const p=plan([sketchFeature(),extrude()],{'sketch.plate':'conflicted'});
  const result=rig(p).inspect(history);
  assert.deepEqual(result.authoredOrder,['sketch.plate','plate']);
  assert.equal(result.features[0].status,'ambiguous_intent');
  assert.equal(result.features[1].status,'blocked_dependency');
});

test('solver contradictory constraints and ambiguous profile refuse preview extrusion',()=>{
  const p=plan([sketchFeature(),extrude()]);
  const unsolved=rig(p,{services:{sketch:{validateSketch:s=>s,solveSketch:()=>({status:'conflicted',
    diagnostics:[{code:'contradictory_constraints'}]})}}}).inspect(history);
  assert.equal(unsolved.features[0].status,'unsolved_sketch');
  assert.equal(unsolved.features[1].status,'blocked_dependency');
  const ambiguous=rig(p,{services:{discovery:{discoverPlateProfiles:()=>({status:'ambiguous',
    reason:'explicit_selection_or_repair_required',candidates:[],rejected:[]}),
    admitDiscoveredPlateProfile:()=>{throw new Error('must not admit');}}}}).inspect(history);
  assert.equal(ambiguous.features[0].status,'invalid_profile');
  assert.equal(ambiguous.features[1].status,'blocked_dependency');
});

test('non-analytic or forged admission fails closed',()=>{
  const result=rig(plan([sketchFeature(),extrude()]),{services:{discovery:{
    discoverPlateProfiles:()=>({status:'ready',inputSignature:'x',candidates:[{id:'x'}]}),
    admitDiscoveredPlateProfile:()=>({status:'validated_exact'})}}}).inspect(history);
  assert.equal(result.features[0].status,'invalid_profile');
  assert.equal(result.features[1].status,'blocked_dependency');
});

test('extrude without explicit source dependency, body, or positive thickness is refused',()=>{
  for(const bad of [extrude([],8),extrude(['sketch.plate'],0),
    feature('plate','extrude',['sketch.plate'],{sourceSketchId:'sketch.plate',thicknessMm:8},[])]){
    const result=rig(plan([sketchFeature(),bad])).inspect(history);
    assert.equal(result.features[1].status,'invalid_feature');
  }
});

test('native cut remains pending even if upstream preview looks healthy',()=>{
  const cut=feature('cut','cut',['plate'],{targetBodyId:'body.plate'},['body.plate']);
  const result=rig(plan([sketchFeature(),extrude(),cut])).inspect(history);
  assert.equal(result.features[2].status,'pending_exact_provider');
  assert.equal(result.exactGeometryAvailable,false);
});

test('mismatched binding revision is rejected rather than consuming stale payload',()=>{
  const p=plan([sketchFeature()]);
  assert.throws(()=>rig(p,{services:{bindings:{evaluateDimensionBindingPlan:()=>({
    projectId:'unit.project',revision:2,featureGates:[]})}}}).inspect(history),/fence/);
});

test('authoritative commands, undo, redo, and archive delegate without shadow journal',()=>{
  const runtime=rig(plan([]));
  const commands=[{eventId:'event.one'}];
  assert.deepEqual(runtime.commit(history,commands,3),{h:history,events:commands,n:3});
  assert.deepEqual(runtime.undo(history,['undo.one'],3),{h:history,ids:['undo.one'],n:3});
  assert.deepEqual(runtime.redo(history,['redo.one'],3),{h:history,ids:['redo.one'],n:3});
  assert.deepEqual(runtime.editDimensions(history,{request:'batch'}),{h:history,r:{request:'batch'}});
  assert.deepEqual(runtime.reopen(runtime.save(history)),history);
});

test('missing required service module functions are refused',()=>{
  assert.throws(()=>createWorkflowRuntime({}),/missing model.planProject/);
});
