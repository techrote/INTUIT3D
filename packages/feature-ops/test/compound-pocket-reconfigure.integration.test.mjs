import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  reconfigureCompoundPockets,COMPOUND_POCKET_FORMAT,COMPOUND_POCKET_VERSION
} from '@intuit3d/feature-ops/compound-pocket-reconfigure/v1';

test('public compound pocket protocol and two-body real CAD replay',()=>{
  assert.equal(COMPOUND_POCKET_FORMAT,
    'intuit3d.feature-ops.compound-pocket-reconfigure');
  assert.equal(COMPOUND_POCKET_VERSION,1);
  const fixture=fileURLToPath(
    new URL('../examples/compound-pocket-reconfigure.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',fixture],{
    encoding:'utf8',timeout:30000,maxBuffer:1024*1024
  });
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  const result=JSON.parse(run.stdout);
  assert.equal(result.consumer,'real_SKETCH_INTENT_RUNTIME');
  assert.deepEqual(result.selectedCutIds,
    ['cut.guard.relief','cut.backer.relief']);
  assert.deepEqual(result.newExtents,
    [{kind:'through_all'},{kind:'blind',depthMm:2.5}]);
  assert.equal(result.retiredSketchId,'sketch.relief');
  assert.equal(result.undoFrames,1);
  assert.equal(result.undoRedoArchive,'passed');
  assert.equal(result.invalidTargets,'rejected_before_commit');
  assert.equal(result.depthEditedMm,14);
  assert.equal(result.unchangedShimMm,3);
  assert.ok(result.sketchInvalidation.includes('cut.guard.relief'));
  assert.ok(result.sketchInvalidation.includes('cut.backer.relief'));
  assert.ok(!result.sketchInvalidation.includes('extrude.shim'));
  assert.deepEqual(result.statuses,
    ['pending_exact_provider','pending_exact_provider']);
  assert.equal(result.nativeBrep,'not_executed');
  assert.equal(result.step,'not_executed');
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
});

test('malformed compound pocket headers refuse before consulting any service',()=>{
  const doc={projectId:'project.compound',revision:7};
  const history={document:doc};
  const edit={
    sourceEventId:'source.a',extentEventId:'extent.a',
    cutFeatureId:'cut.a',targetBodyId:'body.a',
    afterBodyWriterId:'extrude.a',
    expectedSourceSketchId:'sketch.old',
    expectedProfileCandidateId:'cycle:old',
    sourceSketchId:'sketch.next',profileCandidateId:'cycle:next',
    releasePreviousSketchDependency:true,
    fromExtent:{kind:'blind',depthMm:2},
    toExtent:{kind:'through_all'}
  };
  const request={
    format:COMPOUND_POCKET_FORMAT,version:COMPOUND_POCKET_VERSION,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    units:'mm',frame:'local_xy',
    edits:[edit,{...edit,sourceEventId:'source.b',extentEventId:'extent.b',
      cutFeatureId:'cut.b',targetBodyId:'body.b',
      afterBodyWriterId:'extrude.b'}]
  };
  let inspections=0,commits=0;
  const services={runtime:{commit:()=>{commits++;},
    inspect:()=>{inspections++;return {};}}};
  const invalid=[
    {...request,format:'wrong'},
    {...request,version:2},
    {...request,expectedProjectId:'other.project'},
    {...request,expectedRevision:6},
    {...request,units:'in'},
    {...request,frame:'world'},
    {...request,edits:[]},
    {...request,edits:[edit]},
    {...request,edits:[...request.edits,undefined]},
    {...request,edits:Array(9).fill(edit)},
    {...request,edits:[edit,edit]},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,sourceEventId:edit.extentEventId}:e)},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,toExtent:e.fromExtent}:e)},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,toExtent:{kind:'blind',depthMm:-1}}:e)},
    {...request,edits:request.edits.map((e,i)=>i?
      {...e,releasePreviousSketchDependency:undefined}:e)},
    {...request,retireSketch:{eventId:'extent.a',featureId:'sketch.old'}},
    {...request,retireSketch:{eventId:'retire.bad',featureId:'unrelated'}},
    {...request,extra:'field'}
  ];
  for(const bad of invalid){
    assert.throws(()=>reconfigureCompoundPockets(history,bad,services));
    assert.equal(inspections,0);
    assert.equal(commits,0);
    assert.equal(history.document.revision,7);
  }
});
