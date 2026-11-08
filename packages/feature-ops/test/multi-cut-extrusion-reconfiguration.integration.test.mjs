import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import {makeMachinedGuard,requestFor,runMultiCutExtrusionReconfigure}
  from '../examples/multi-cut-extrusion-reconfiguration.mjs';
import {runtime,services} from '../examples/coordinated-pockets.mjs';
import {reconfigureProfileExtrusion}
  from '../src/extrusion-reconfiguration.mjs';

const get=(history,id)=>model.featuresOf(history.document).find(x=>x.id===id);
const status=(history,id)=>runtime.inspect(history).features.find(x=>x.featureId===id)?.status;

test('real multiple ordered guard cuts survive an independently selected base re-source and depth edit',()=>{
  const demo=runMultiCutExtrusionReconfigure();
  assert.equal(demo.oneUndoFrame,true);
  assert.equal(demo.exactAuthority,false);
  assert.equal(demo.independentSTEP,'not_executed');
  assert.deepEqual(demo.preservedCutIds,['cut.guard.relief','cut.guard.vent']);
  assert.equal(demo.cutStatuses[1].status,'blocked_dependency');
});
test('legacy first-cut implicit source dependency is rebound without touching downstream independent cut',()=>{
  const {history,candidates}=makeMachinedGuard();
  const first=get(history,'cut.guard.relief');
  const inherited=runtime.commit(history,[{
    eventId:'edit.legacy.first.cut',type:'feature.edit',featureId:first.id,
    patch:{
      dependsOn:['extrude.guard'],
      payload:{...first.payload,sourceSketchId:'sketch.guard',
        profileCandidateId:candidates['sketch.guard']}
    }
  }],history.document.revision);
  assert.deepEqual(get(inherited,first.id).dependsOn,['extrude.guard']);
  const next=reconfigureProfileExtrusion(inherited,requestFor(inherited,candidates),services);
  assert.equal(next.history.document.revision,inherited.document.revision+2);
  assert.equal(next.history.undoStack.length,inherited.undoStack.length+1);
  assert.deepEqual(next.reboundCutIds,['cut.guard.relief']);
  assert.deepEqual(next.cutDependencyChanges[0].nextDependencies,
    ['extrude.guard','sketch.guard']);
  assert.deepEqual(get(next.history,'cut.guard.vent').dependsOn,
    ['cut.guard.relief','sketch.guard.vent']);
  assert.equal(status(next.history,'cut.guard.relief'),'pending_exact_provider');
  assert.equal(status(next.history,'cut.guard.vent'),'blocked_dependency');
  const undone=runtime.undo(next.history,['undo.base','undo.rebind']);
  assert.deepEqual(get(undone,first.id).dependsOn,['extrude.guard']);
  const redone=runtime.redo(undone,['redo.base','redo.rebind']);
  const reopened=runtime.reopen(runtime.save(redone));
  assert.deepEqual(get(reopened,first.id).dependsOn,
    ['extrude.guard','sketch.guard']);
  assert.equal(get(reopened,'extrude.guard').payload.thicknessMm,14);
});
test('stale, ambiguous, foreign and missing-INTENT chain inputs refuse without mutating source history',()=>{
  const {history,candidates}=makeMachinedGuard();
  const snapshot=model.serializeProject(history.document);
  const req=requestFor(history,candidates);
  assert.throws(()=>reconfigureProfileExtrusion(history,req,
    {...services,cutChain:undefined}),/inspection required/);
  const stale={...req,expectedRevision:req.expectedRevision-1};
  assert.throws(()=>reconfigureProfileExtrusion(history,stale,services),/stale/);
  const badTarget={...req,outputBodyId:'body.backer'};
  assert.throws(()=>reconfigureProfileExtrusion(history,badTarget,services),/identity/);
  const rogue=runtime.commit(history,[{
    eventId:'fork.guard.cut',type:'feature.edit',featureId:'cut.guard.vent',
    patch:{dependsOn:['extrude.guard','sketch.guard.vent']}
  }],history.document.revision);
  assert.throws(()=>reconfigureProfileExtrusion(rogue,requestFor(rogue,candidates),
    services),/noncommuting body writers/);
  assert.equal(model.serializeProject(history.document),snapshot);
});
test('standalone public package consumer executes with real model/runtime',()=>{
  const script=fileURLToPath(new URL('../examples/multi-cut-extrusion-reconfiguration.mjs',
    import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',script],{
    encoding:'utf8',timeout:25000,maxBuffer:1024*1024
  });
  assert.equal(run.status,0,run.stderr||String(run.error));
  assert.equal(JSON.parse(run.stdout).updatedExtrusionDepthMm,14);
});
