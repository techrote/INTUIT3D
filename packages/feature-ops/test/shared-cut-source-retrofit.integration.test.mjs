import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SHARED_CUT_SOURCE_FORMAT,SHARED_CUT_SOURCE_VERSION,replaceSharedCutProfiles}
  from '@intuit3d/feature-ops/shared-cut-source-retrofit/v1';

test('public selected shared cut source contract exports',()=>{
  assert.equal(SHARED_CUT_SOURCE_FORMAT,
    'intuit3d.feature-ops.shared-cut-source-retrofit');
  assert.equal(SHARED_CUT_SOURCE_VERSION,1);
  assert.equal(typeof replaceSharedCutProfiles,'function');
});
test('two independent-body cut sketches migrate together with SKETCH proof and archive',()=>{
  const path=fileURLToPath(new URL('../examples/shared-cut-source-retrofit.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',path],{
    encoding:'utf8',timeout:25000,maxBuffer:1024*1024
  });
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  const result=JSON.parse(run.stdout);
  assert.equal(result.kind,'real_SKETCH_INTENT_RUNTIME_consumer');
  assert.deepEqual(result.editedCutIds,['cut.guard.relief','cut.backer.relief']);
  assert.equal(result.oldSketchRetired,'sketch.relief');
  assert.equal(result.undoFrames,1);
  assert.equal(result.undoRedoArchive,'passed');
  assert.equal(result.invalidSelections,'refused_before_mutation');
  assert.equal(result.guardDepthMm,14);
  assert.equal(result.unchangedShimDepthMm,3);
  assert.ok(result.sourceEditInvalidated.includes('cut.guard.relief'));
  assert.ok(result.sourceEditInvalidated.includes('cut.backer.relief'));
  assert.ok(!result.sourceEditInvalidated.includes('extrude.shim'));
  assert.deepEqual(result.statuses,['pending_exact_provider','pending_exact_provider']);
  assert.equal(result.nativeBrep,'not_executed');
  assert.equal(result.step,'not_executed');
  assert.equal(result.exactAuthority,false);
});
