import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const pinnedHost=join(root,'tooling','local-pinned-host.mjs');
const devLocal=join(root,'tooling','dev-local.mjs');
const invoke=(script,args=[],extra={})=>spawnSync(process.execPath,[script,...args],{
  cwd:root,encoding:'utf8',timeout:15000,env:{
    ...process.env,INTUIT3D_OCCT8_WORKER:'',INTUIT3D_OCCT8_WORKER_SHA256:'',...extra
  }
});

test('pinned direct host refuses missing verified worker without opening OCP fallback',()=>{
  const run=invoke(pinnedHost);
  assert.equal(run.status,2,run.stderr);
  assert.match(run.stderr,/LOCAL_PINNED_NATIVE_HOST_FAILED/);
  assert.doesNotMatch(run.stdout,/LOCAL_PROVIDER_URL=|LOCAL_PAIRING_TOKEN=/);
});

test('pinned direct host refuses arbitrary binary even with supplied digest',()=>{
  const run=invoke(pinnedHost,[],{
    INTUIT3D_OCCT8_WORKER:process.execPath,
    INTUIT3D_OCCT8_WORKER_SHA256:'0'.repeat(64)
  });
  assert.equal(run.status,2,run.stderr);
  assert.match(run.stderr,process.platform==='linux'
    ? /pinned worker SHA-256 mismatch|pinned worker path must be canonical/
    : /requires Linux/);
  assert.doesNotMatch(run.stdout,/LOCAL_PROVIDER_URL=/);
});

test('pinned local launch cannot silently substitute experimental OCP',()=>{
  const run=invoke(devLocal,['--pinned','--smoke']);
  assert.notEqual(run.status,0,run.stdout+'\\n'+run.stderr);
  assert.match(run.stderr,/LOCAL_CAD_START_FAILED/);
  assert.doesNotMatch(run.stdout,/LOCAL_CAD_SMOKE_PASS|LOCAL_PAIRING_TOKEN=/);
});

test('local command parser rejects duplicated or unsupported backend flags',()=>{
  const dup=invoke(devLocal,['--pinned','--pinned']);
  const unknown=invoke(devLocal,['--ocp8']);
  assert.equal(dup.status,2);
  assert.equal(unknown.status,2);
});
