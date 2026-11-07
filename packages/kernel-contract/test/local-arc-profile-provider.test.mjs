// Actual Node -> Python -> OCP 7.9.3.1 -> STEP -> Node; no fake producer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runExperimentalArcExtrude} from '../src/local-arc-profile-provider.mjs';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const python=process.env.PYTHON || (process.platform==='win32'?'python':'python3');
const nativeReady=spawnSync(python,['-c',"import OCP;assert OCP.__version__=='7.9.3.1'"],{timeout:5000}).status===0;
const fixture=async()=>JSON.parse(await fs.readFile(join(root,'native/examples/rounded-plate-arc-extrude.request.json'),'utf8'));
test('physical rounded plate and bores, retrospective thickness, digest and no-clobber STEP',
  {skip:!nativeReady&&'Pinned experimental OCP 7.9.3.1 unavailable'},async()=>{
    const folder=await fs.mkdtemp(join(tmpdir(),'intuit3d-curved-node-'));
    try{
      const q=await fixture();
      const output=join(folder,'first.step');
      const first=await runExperimentalArcExtrude(q,{pythonExecutable:python,
        readCurrentRevision:()=>q.revision,stepOutput:output,timeoutMs:30000});
      assert.equal(first.kind,'experimental_profile_brep',JSON.stringify(first));
      assert.equal(first.exactAuthority,false);
      assert.equal(first.independentInteroperability,false);
      assert.equal(first.artifact.verification,'same_engine_only');
      assert.ok((await fs.stat(output)).size>1000);
      const original=await fs.readFile(output);
      const stale=await runExperimentalArcExtrude(q,{pythonExecutable:python,
        readCurrentRevision:()=>q.revision+1,stepOutput:join(folder,'stale.step')});
      assert.equal(stale.code,'stale_revision');
      const second=await runExperimentalArcExtrude(q,{pythonExecutable:python,
        readCurrentRevision:()=>q.revision,stepOutput:output,timeoutMs:30000});
      assert.equal(second.code,'requires_reconciliation');
      assert.deepEqual(await fs.readFile(output),original);
      const changed=structuredClone(q);changed.thicknessMm=12;changed.revision=9;
      const rebuilt=await runExperimentalArcExtrude(changed,{pythonExecutable:python,
        readCurrentRevision:()=>9,stepOutput:join(folder,'edited.step'),timeoutMs:30000});
      assert.equal(rebuilt.kind,'experimental_profile_brep',JSON.stringify(rebuilt));
      assert.ok(rebuilt.source.volumeMm3>first.source.volumeMm3);
      assert.notEqual(rebuilt.artifact.sha256,first.artifact.sha256);
      const bad=structuredClone(q);bad.profile.materialAreaMm2=1;
      const rejected=await runExperimentalArcExtrude(bad,{pythonExecutable:python,
        readCurrentRevision:()=>q.revision,stepOutput:join(folder,'rejected.step'),timeoutMs:30000});
      assert.equal(rejected.kind,'unresolved');
      await assert.rejects(fs.stat(join(folder,'rejected.step')),{code:'ENOENT'});
    }finally{await fs.rm(folder,{recursive:true,force:true});}
  });
