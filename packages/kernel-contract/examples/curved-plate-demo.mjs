#!/usr/bin/env node
// Real experimental OCP B-rep and STEP from SKETCH-compatible analytic arcs.
// Usage: node packages/kernel-contract/examples/curved-plate-demo.mjs /tmp/curved-demo
// Requires Python with pinned OCP 7.9.3.1; not an OCCT8 or external CAD pass.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runExperimentalArcExtrude} from '../src/local-arc-profile-provider.mjs';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const output=process.argv[2];
if(!output)throw new Error('output directory required; use a new empty path');
await mkdir(output,{recursive:true});
const source=JSON.parse(await readFile(join(root,'native/examples/rounded-plate-arc-extrude.request.json'),'utf8'));
const outcomes=[];
for(const [revision,thicknessMm] of [[8,8],[9,12]]){
  const request={...structuredClone(source),revision,thicknessMm,requestId:'curved.plate.'+revision};
  const result=await runExperimentalArcExtrude(request,{
    readCurrentRevision:()=>revision,stepOutput:join(output,'rounded-'+revision+'.step'),
    pythonExecutable:process.env.PYTHON||(process.platform==='win32'?'python':'python3'),
    timeoutMs:60000,
  });
  if(result.kind!=='experimental_profile_brep'||!result.artifact)
    throw Error('Physical curved STEP failed: '+JSON.stringify(result));
  if(result.exactAuthority!==false||result.independentInteroperability!==false)
    throw Error('Unsupported geometry authority promotion');
  outcomes.push({revision,thicknessMm,volumeMm3:result.source.volumeMm3,
    path:result.artifact.path,sha256:result.artifact.sha256,
    backend:result.backend,exactAuthority:false,independentInteroperability:false});
}
if(outcomes[0].sha256===outcomes[1].sha256)
  throw Error('Retrospective dimension edit did not change physical STEP');
await writeFile(join(output,'manifest.json'),JSON.stringify({
  kind:'intuit3d/experimental-arc-profile-native-v1',outcomes},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(outcomes,null,2));
