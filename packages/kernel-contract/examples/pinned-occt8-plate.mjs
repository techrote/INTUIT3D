#!/usr/bin/env node
// Execute the real, separately provisioned pinned OCCT 8.0.1 C++ worker via
// the public Node contract. This is a local IPC/STEP smoke, not browser or
// independent full CAD-interoperability qualification.
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {runPinnedOcct8Plate} from '../src/local-occt8-provider.mjs';
import {expectedPlateMetrics} from '../src/plate-v1.mjs';

function option(name) {
  const i=process.argv.indexOf(name);
  if(i<0 || !process.argv[i+1] || process.argv[i+1].startsWith('--'))
    throw new Error('Required '+name+' VALUE');
  return process.argv[i+1];
}
const worker=resolve(option('--worker'));
const output=resolve(option('--output-dir'));
const python=process.argv.includes('--python') ? option('--python') :
  (process.env.PYTHON || (process.platform==='win32' ? 'python' : 'python3'));
const crossVersion=process.argv.includes('--cross-version-step-audit');
const plans=[
  {revision:8, thickness:8, firstHoleRadius:6},
  {revision:12,thickness:12, firstHoleRadius:8},
];
const observations=[];
await mkdir(output,{recursive:true});
for(const plan of plans) {
  const plate={width:120,depth:80,thickness:plan.thickness,
    holes:[{x:-30,y:0,radius:plan.firstHoleRadius},{x:30,y:0,radius:6}]};
  const request={
    protocol:'intuit3d/kernel/plate-v1',
    requestId:'fixture.occt8.'+plan.revision,
    featureId:'plate.fixture',revision:plan.revision,units:'mm',
    plate,exportStep:true,
  };
  const result=await runPinnedOcct8Plate(request,{
    workerExecutable:worker,pythonExecutable:python,
    readCurrentRevision:()=>plan.revision,
    stepOutput:join(output,'plate-'+plan.revision+'.step'),
    part21StepAudit:true,crossVersionStepAudit:crossVersion,
    timeoutMs:120000,
  });
  if(result.kind!=='experimental_report'||!result.artifact)
    throw new Error('Native step '+plan.revision+' failed: '+JSON.stringify(result));
  if(result.exactAuthority!==false||result.independentInteroperability!==false)
    throw new Error('Unqualified native result was mislabelled');
  const analytic=expectedPlateMetrics(plate);
  if(Math.abs(result.observed.source.volumeMm3-analytic.volumeMm3)>
     Math.max(1e-7,Math.abs(analytic.volumeMm3)*1e-10))
    throw new Error('Native volume differs from analytic plate');
  observations.push({
    revision:plan.revision,plate,
    expectedVolumeMm3:analytic.volumeMm3,
    observedVolumeMm3:result.observed.source.volumeMm3,
    artifact:result.artifact,stepVerification:result.stepVerification,
    part21Audit:result.part21Audit,exactAuthority:false,
    independentInteroperability:false,
  });
}
if(observations[0].artifact.sha256===observations[1].artifact.sha256)
  throw new Error('Edited model produced identical STEP bytes');
const record={
  kind:'INTUIT3D/pinned-occt8-direct-ipc-smoke-v1',
  qualification:'experimental-native-if-binary-was-actually-provisioned',
  source:'two distinct true C++ worker invocations, pending independent full CAD reader',
  observations,
};
await writeFile(join(output,'manifest.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(record,null,2));
