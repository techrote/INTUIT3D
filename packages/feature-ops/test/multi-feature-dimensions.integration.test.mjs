import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {editMultipleBodyDimensions,
  MULTI_FEATURE_DIMENSIONS_FORMAT as FORMAT,
  MULTI_FEATURE_DIMENSIONS_VERSION as VERSION}
  from '../src/multi-feature-dimensions.mjs';

test('actual three-body valve housing edits five dimensions atomically, undo/replay and reject bad targets',()=>{
  const script=fileURLToPath(new URL('../examples/valve-housing-dimension-batch.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',script],
    {encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||String(run.error));
  const result=JSON.parse(run.stdout);
  assert.equal(result.consumer,'real_INTENT_SKETCH_RUNTIME');
  assert.equal(result.editCount,5);
  assert.equal(result.undoFrames,1);
  assert.deepEqual(result.depthsMm,{housing:14,cap:9,spacer:4});
  assert.deepEqual(result.valveExtent,{kind:'through_all'});
  assert.ok(result.dependentInvalidation.includes('cut.valve'));
  assert.ok(result.dependentInvalidation.includes('cut.capport'));
  assert.ok(!result.dependentInvalidation.includes('extrude.spacer'));
  assert.equal(result.status,'blocked_dependency');
  assert.equal(result.undoRedoArchive,'passed');
  assert.equal(result.invalidSelections,'rejected_before_commit');
  assert.equal(result.exactAuthority,false);
  assert.equal(result.nativeBrep,'not_executed');
  assert.equal(result.step,'not_executed');
});

test('malformed batches, unsupported versions and stale source reject before service invocation',()=>{
  const history={document:{projectId:'project.x',revision:17}};
  const edit={
    kind:'extrusion_depth',eventId:'edit.extrude',
    extrudeFeatureId:'extrude.x',targetBodyId:'body.x',
    sourceSketchId:'sketch.x',profileCandidateId:'cycle:x',
    fromDepthMm:4,toDepthMm:5};
  const original={format:FORMAT,version:VERSION,
    expectedProjectId:'project.x',expectedRevision:17,units:'mm',
    frame:'local_xy',edits:[edit,{...edit,eventId:'edit.two',
      extrudeFeatureId:'extrude.two',targetBodyId:'body.two'}]};
  let read=0;
  const services={runtime:{commit:()=>{throw new Error('should not commit');},
    inspect:()=>{read++;return {features:[]};},diff:()=>({})},
    model:{featuresOf:()=>{read++;return [];}},sketch:{validateSketch:x=>x},
    discovery:{discoverPlateProfiles:()=>({}),admitDiscoveredPlateProfile:()=>({})},
    cutChain:{inspectBodyCutChain:()=>({}),inspectBodyCutExtent:()=>({}),
      previewBodyCutExtentEdit:()=>({})}};
  const cases=[
    {...original,format:'other'},
    {...original,version:2},
    {...original,expectedProjectId:'another'},
    {...original,expectedRevision:16},
    {...original,units:'cm'},
    {...original,frame:'world'},
    {...original,edits:[]},
    {...original,edits:[edit]},
    {...original,edits:[...original.edits,undefined]},
    {...original,edits:Array(17).fill(edit)},
    {...original,edits:original.edits,unexpected:true}
  ];
  for(const request of cases){
    assert.throws(()=>editMultipleBodyDimensions(history,request,services));
    assert.equal(read,0,'invalid request must never inspect or mutate model');
  }
});

test('valid header with duplicated feature identity cannot commit',()=>{
  const history={document:{projectId:'project.x',revision:3}};
  let committed=0;
  const profile={status:'analytic_profile_only',id:'cycle:x'};
  const extrude={id:'extrude.x',kind:'extrude',dependsOn:['sketch.x'],
    writeTargets:['body.x'],payload:{sourceSketchId:'sketch.x',
      thicknessMm:4,units:'mm',frame:'local_xy'}};
  const sketches=[{id:'sketch.x',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:{version:1}}},extrude];
  const services={
    runtime:{
      inspect:()=>({features:[
        {featureId:'sketch.x',status:'analytic_profile_only',profile},
        {featureId:'extrude.x',status:'preview_only'}
      ]}),
      commit:()=>{committed++;throw new Error('unexpected commit');},
      diff:()=>({invalidatedFeatureIds:[]})
    },
    model:{featuresOf:()=>sketches},
    sketch:{validateSketch:v=>v},
    discovery:{discoverPlateProfiles:()=>({status:'ready',candidates:[{id:'cycle:x'}]}),
      admitDiscoveredPlateProfile:()=>profile},
    cutChain:{
      inspectBodyCutChain:()=>({status:'ready',projectId:'project.x',revision:3,
        bodyWriterIds:['extrude.x']}),
      inspectBodyCutExtent:()=>({}),
      previewBodyCutExtentEdit:()=>({})
    }
  };
  const first={kind:'extrusion_depth',eventId:'edit.first',
    extrudeFeatureId:'extrude.x',targetBodyId:'body.x',
    sourceSketchId:'sketch.x',profileCandidateId:'cycle:x',
    fromDepthMm:4,toDepthMm:5};
  const request={format:FORMAT,version:VERSION,expectedProjectId:'project.x',
    expectedRevision:3,units:'mm',frame:'local_xy',
    edits:[first,{...first,eventId:'edit.second',toDepthMm:6}]};
  assert.throws(()=>editMultipleBodyDimensions(history,request,services),/duplicate feature/);
  assert.equal(committed,0);
  assert.equal(history.document.revision,3);
});
