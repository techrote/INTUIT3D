import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MACHINED_VARIANT_FORMAT,MACHINED_VARIANT_VERSION,
  inspectMachinedBodyVariant,createMachinedBodyVariant}
  from '../src/machined-body-variant.mjs';

test('public machined body variant API retains a versioned consumer contract',()=>{
  assert.equal(MACHINED_VARIANT_FORMAT,'intuit3d.feature-ops.machined-body-variant');
  assert.equal(MACHINED_VARIANT_VERSION,1);
  assert.equal(typeof inspectMachinedBodyVariant,'function');
  assert.equal(typeof createMachinedBodyVariant,'function');
});
test('real SKETCH/INTENT/RUNTIME new-body + two-cut one-gesture variants',()=>{
  const file=fileURLToPath(new URL('../examples/machined-body-variant.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',file],{
    encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  const out=JSON.parse(run.stdout);
  assert.deepEqual(out.createdVariantBodies,
    ['body.variant.adapted','body.variant.shared']);
  assert.equal(out.atomicBodyAndTwoCuts,true);
  assert.equal(out.negativeSelectionsRefused,21);
  assert.equal(out.undoRedoAndArchive,true);
  assert.equal(out.independentVariantSketchInvalidation,true);
  assert.equal(out.unchangedShimDepthMm,3);
  assert.equal(out.exactAuthority,false);
  assert.equal(out.nativeSTEP,'not_executed');
});
