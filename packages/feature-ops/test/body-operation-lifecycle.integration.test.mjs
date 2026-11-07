import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BODY_OPERATION_LIFECYCLE_FORMAT,inspectSelectedBodyRemoval,
  removeSelectedBodyOperation,restoreSelectedBodyOperations}
  from '../src/body-operation-lifecycle.mjs';
test('versioned contract fails closed before invoking untrusted services',()=>{
  const history={document:{projectId:'test.lifecycle',revision:2}};
  let touched=0;
  const services={model:{featuresOf(){touched++;return []}},
    runtime:{inspect(){touched++},diff(){touched++}},
    lifecycle:{inspectFeatureRemoval(){touched++},previewFeatureRemoval(){touched++},
      previewFeatureRestoration(){touched++},
      commitUndoableFeatureRemoval(){touched++},
      commitUndoableFeatureRestoration(){touched++}}};
  const base={format:BODY_OPERATION_LIFECYCLE_FORMAT,version:1,
    expectedProjectId:'test.lifecycle',expectedRevision:2,
    units:'mm',frame:'local_xy',targetBodyId:'body.a',featureId:'cut.a'};
  for(const bad of [
    {...base,expectedRevision:1},
    {...base,expectedProjectId:'other.project'},
    {...base,units:'in'},
    {...base,targetBodyId:'body.a',featureId:'body.a'},
    {...base,frame:'world_xyz'},
    {...base,extra:true}
  ])assert.throws(()=>inspectSelectedBodyRemoval(history,bad,services));
  assert.equal(touched,0);
  assert.throws(()=>removeSelectedBodyOperation(history,{
    ...base,expectedDependents:['bad id'],mode:'keep_dependents_pending',
    confirmCascade:false,eventIds:['event.a']},services));
  assert.equal(touched,0);
  assert.throws(()=>restoreSelectedBodyOperations(history,{
    format:BODY_OPERATION_LIFECYCLE_FORMAT,version:1,
    expectedProjectId:'test.lifecycle',expectedRevision:2,
    units:'mm',frame:'local_xy',targetBodyId:'body.a',
    featureIds:['cut.a','cut.a'],eventIds:['event.a','event.b'],
    admission:'require_ready'},services));
  assert.equal(touched,0);
});
test('real actuator-rail source, ordered cuts, removal, restore, undo/reopen, depth rebuild',()=>{
  const path=fileURLToPath(new URL('../examples/actuator-rail-lifecycle.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',path],{
    encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
  const result=JSON.parse(run.stdout);
  assert.equal(result.kind,'real_SKETCH_INTENT_RUNTIME_consumer');
  assert.deepEqual(result.temporarySuppression,['cut.channel']);
  assert.deepEqual(result.restoration,['cut.channel']);
  assert.deepEqual(result.confirmedCascade,['cut.gauge','cut.port','cut.channel']);
  assert.equal(result.railDepthMm,14);
  assert.equal(result.unchangedCoverDepthMm,5);
  assert.equal(result.undoRedoArchive,'passed');
  assert.equal(result.exactAuthority,false);
  assert.equal(result.nativeBrep,'not_executed');
  assert.equal(result.step,'not_executed');
});
