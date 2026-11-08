import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import {makeMachinedFamily,requestFor,runMachinedFamily}
  from '../examples/machined-family-base.mjs';
import {runtime,services} from '../examples/coordinated-pockets.mjs';
import {FAMILY_BASE_FORMAT,FAMILY_BASE_VERSION,
  inspectMachinedFamilyBase,applyMachinedFamilyBase}
  from '../src/machined-family-base.mjs';

const get=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);
test('versioned family API and real two-body four-cut one-frame edit',()=>{
  assert.equal(FAMILY_BASE_FORMAT,'intuit3d.feature-ops.machined-family-base');
  assert.equal(FAMILY_BASE_VERSION,1);
  const demo=runMachinedFamily();
  assert.deepEqual(demo.editedBodies,['body.guard','body.backer']);
  assert.deepEqual(demo.preservedCuts,[
    ['cut.guard.relief','cut.guard.vent'],
    ['cut.backer.relief','cut.backer.vent']]);
  assert.equal(demo.oneUndoFrame,true);
  assert.equal(demo.undoRedoAndArchive,true);
  assert.equal(demo.unchangedShim,true);
  assert.equal(demo.rejectedSelections,5);
  assert.equal(demo.exactAuthority,false);
  assert.equal(demo.nativeSTEP,'not_executed');
});
test('last invalid body refuses without partial authoritative commit',()=>{
  const {history,candidates}=makeMachinedFamily();
  const req=requestFor(history,candidates);
  const previous=model.serializeProject(history.document);
  const bad={...req,edits:[req.edits[0],
    {...req.edits[1],from:{sourceSketchId:'sketch.backer',depthMm:999}}]};
  assert.throws(()=>applyMachinedFamilyBase(history,bad,services),/identity has changed/);
  assert.equal(model.serializeProject(history.document),previous);
  assert.equal(get(history,'extrude.guard').payload.thicknessMm,10);
});
test('implicit first-cut SKETCH edge rebinds atomically with both base edits',()=>{
  const {history,candidates}=makeMachinedFamily();
  const cut=get(history,'cut.guard.relief');
  const inherited=runtime.commit(history,[{
    eventId:'make.legacy.guard.inheritance',type:'feature.edit',
    featureId:cut.id,patch:{dependsOn:['extrude.guard'],
      payload:{...cut.payload,sourceSketchId:'sketch.guard',
        profileCandidateId:candidates['sketch.guard']}}
  }],history.document.revision);
  const req=requestFor(inherited,candidates);
  const inspected=inspectMachinedFamilyBase(inherited,req,services);
  assert.equal(inspected.eventIds.length,3);
  const applied=applyMachinedFamilyBase(inherited,req,services);
  assert.equal(applied.eventIds.length,3);
  assert.deepEqual(get(applied.history,cut.id).dependsOn,
    ['extrude.guard','sketch.guard']);
  assert.equal(applied.history.undoStack.length,inherited.undoStack.length+1);
  const undone=runtime.undo(applied.history,
    applied.eventIds.map((_,i)=>'undo.legacy.family.'+i));
  assert.deepEqual(get(undone,cut.id).dependsOn,['extrude.guard']);
  const reopened=runtime.reopen(runtime.save(applied.history));
  assert.deepEqual(get(reopened,cut.id).dependsOn,
    ['extrude.guard','sketch.guard']);
});
test('public consumer example executes against accepted MODEL/SKETCH/RUNTIME',()=>{
  const file=fileURLToPath(new URL('../examples/machined-family-base.mjs',import.meta.url));
  const proc=spawnSync(process.execPath,['--experimental-strip-types',file],{
    encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(proc.status,0,proc.stderr||proc.stdout||String(proc.error));
  assert.equal(JSON.parse(proc.stdout).retrospectiveGuardDepthMm,16);
});
