// This test is deliberately gated on the ACTUAL pinned C++ worker binary.
// It must not silently substitute the synthetic transport test or OCP 7.9.3.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runPinnedOcct8Plate} from '../src/local-occt8-provider.mjs';
import {expectedPlateMetrics} from '../src/plate-v1.mjs';

const worker=process.env.INTUIT3D_OCCT8_WORKER;
test('provisioned OCCT 8.0.1 C++: real direct Node IPC, edit, STEP and independent plate-subset readback',
  {skip:!worker && 'Pinned C++ worker not provisioned'},async()=>{
    const dir=await fs.mkdtemp(join(tmpdir(),'intuit3d-real-occt8-'));
    try{
      let preceding=null;
      for(const [revision,thickness,radius] of [[8,8,6],[12,12,8]]) {
        const plate={width:120,depth:80,thickness,
          holes:[{x:-30,y:0,radius},{x:30,y:0,radius:6}]};
        const req={
          protocol:'intuit3d/kernel/plate-v1',requestId:'fixture.cxx.'+revision,
          featureId:'plate.fixture',revision,units:'mm',plate,exportStep:true,
        };
        const path=join(dir,'plate-'+revision+'.step');
        const result=await runPinnedOcct8Plate(req,{
          workerExecutable:worker,readCurrentRevision:()=>revision,
          pythonExecutable:process.env.PYTHON || (process.platform==='win32' ? 'python':'python3'),
          stepOutput:path,part21StepAudit:true,timeoutMs:120000,
        });
        assert.equal(result.kind,'experimental_report',JSON.stringify(result));
        assert.equal(result.backend,'OCCT-cxx-8.0.1');
        assert.equal(result.exactAuthority,false);
        assert.equal(result.independentInteroperability,false);
        assert.equal(result.artifact.verification,'occt8_part21_plate_subset');
        assert.equal(result.part21Audit.sha256,result.artifact.sha256);
        const expected=expectedPlateMetrics(plate);
        assert.ok(Math.abs(result.observed.source.volumeMm3-expected.volumeMm3)<
          Math.max(1e-7,expected.volumeMm3*1e-10));
        assert.ok((await fs.stat(path)).size>256);
        if(preceding) assert.notEqual(result.artifact.sha256,preceding);
        preceding=result.artifact.sha256;
      }
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
