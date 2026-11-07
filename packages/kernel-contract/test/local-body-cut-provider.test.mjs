import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runExperimentalBodyCut,validateBodyCutRequest} from '../src/local-body-cut-provider.mjs';
const directory=resolve(fileURLToPath(import.meta.url),'../../../../native/examples');
const fixture=resolve(directory,'l-bracket-separate-cut.request.json');
const worker=resolve(directory,'../analytic_profile_cut.py');
const request=async()=>JSON.parse(await readFile(fixture,'utf8'));

test('native OCP separate L-bracket cut: real STEP, volume and exclusive publication', {
  skip:process.env.INTUIT3D_RUN_PHYSICAL_CUT_TEST!=='1'?
    'requires pinned experimental OCP 7.9.3.1 and explicit opt-in':false
},async t=>{
  const out=await mkdtemp(join(tmpdir(),'intuit3d-bodycut-node-'));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const q=await request();validateBodyCutRequest(q);
  const dest=join(out,'true-cut.step');
  let rev=q.revision;
  const options={readCurrentRevision:()=>rev,stepOutput:dest,workerScript:worker};
  const result=await runExperimentalBodyCut(q,options);
  assert.equal(result.kind,'experimental_body_cut_brep',JSON.stringify(result));
  assert.equal(result.targetBodyId,'body.bracket');
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  const expected=(11800-Math.PI*36-192)*8;
  assert.ok(Math.abs(result.source.volumeMm3-expected)<1e-6);
  assert.ok(Math.abs(result.stepReadback.volumeMm3-expected)<1e-6);
  const actual=await readFile(dest);
  assert.equal(result.artifact.sha256,createHash('sha256').update(actual).digest('hex'));
  assert.ok(actual.length>1024);
  const second=await runExperimentalBodyCut(q,options);
  assert.equal(second.kind,'unresolved');
  assert.equal((await readFile(dest)).length,actual.length);
  rev=8;
  const stale=await runExperimentalBodyCut(q,{...options,stepOutput:join(out,'stale.step')});
  assert.equal(stale.code,'stale_revision');
});

test('rejects revision and identity mismatches before spawn',async()=>{
  const q=await request();q.cutTool.revision++;
  assert.throws(()=>validateBodyCutRequest(q),/stale geometry/);
  const r=await request();r.cutFeatureId=r.baseExtrude.featureId;
  assert.throws(()=>validateBodyCutRequest(r),/distinct feature/);
});
