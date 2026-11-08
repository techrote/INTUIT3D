import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {editModelDimension,newModelPlateSession,serializeModelSession} from './runtimeSession.ts';

const script=fileURLToPath(new URL('../scripts/probe-private-archive.mjs',import.meta.url));
const run=(pathname:string)=>spawnSync(process.execPath,
  ['--experimental-strip-types',script,pathname],
  {encoding:'utf8',timeout:50000,maxBuffer:1024*1024});

test('private original-file probe executes read, parse, real reopen and inspect in isolated worker',()=>{
  const dir=mkdtempSync(join(tmpdir(),'intuit3d-private-probe-'));
  const privateName=join(dir,'PRIVATE-original-do-not-publish.i3d-model.json');
  try {
    let history=newModelPlateSession('workbench.private.probe');
    for(let i=0;i<11;i++)history=editModelDimension(history,'thickness',11+i);
    writeFileSync(privateName,serializeModelSession(history));
    const result=run(privateName);
    assert.equal(result.status,0,result.stderr);
    for(const stage of ['stat','read','json.parse','runtime.reopen','runtime.inspect','workbench.admission'])
      assert.ok(result.stdout.includes('PROBE_STAGE '+stage),stage);
    assert.match(result.stdout,/PROBE_PASS revision=\d+ undoFrames=\d+ redoFrames=0 bytes=\d+/);
    assert.match(result.stdout,/Windows Firefox selection\/Worker\/confirmation remains untested/);
    assert.ok(!result.stdout.includes(privateName));
    assert.ok(!result.stdout.includes('workbench.private.probe'));
    assert.ok(!result.stdout.includes('sketch.plate'));
    assert.ok(!result.stderr.includes(privateName));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('invalid private JSON refuses at json.parse without printing contents or basename',()=>{
  const dir=mkdtempSync(join(tmpdir(),'intuit3d-private-bad-'));
  const privateName=join(dir,'SENSITIVE-PRIVATE-ARCHIVE.json');
  try {
    writeFileSync(privateName,'{ \"private-secret\":');
    const result=run(privateName);
    assert.equal(result.status,1,result.stdout+result.stderr);
    assert.match(result.stderr,/PROBE_FAILED stage=json.parse type=SyntaxError/);
    assert.ok(!(result.stdout+result.stderr).includes('PRIVATE-ARCHIVE'));
    assert.ok(!(result.stdout+result.stderr).includes('private-secret'));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('oversized private archive is refused before reading content',()=>{
  const dir=mkdtempSync(join(tmpdir(),'intuit3d-private-large-'));
  const privateName=join(dir,'SENSITIVE-TOO-LARGE.json');
  try {
    writeFileSync(privateName,'x'.repeat(4*1024*1024+1));
    const result=run(privateName);
    assert.equal(result.status,1,result.stdout+result.stderr);
    assert.match(result.stderr,/PROBE_FAILED stage=stat type=RangeError/);
    assert.doesNotMatch(result.stdout,/PROBE_STAGE read/);
    assert.ok(!(result.stdout+result.stderr).includes('SENSITIVE-TOO-LARGE'));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
