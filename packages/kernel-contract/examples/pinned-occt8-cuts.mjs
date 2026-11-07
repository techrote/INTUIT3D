// Real pinned OCCT8 C++ ordered blind/through cut demonstration.
// Requires an independently provisioned 8.0.1 C++ binary, not an OCP fallback.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runPinnedOcct8CutChain} from '../src/local-occt8-cut-provider.mjs';
import {expectedOcct8CutMetrics} from '../src/occt8-cut-v1.mjs';

const worker=process.argv[2]||process.env.INTUIT3D_OCCT8_WORKER;
const destination=process.argv[3];
if(!worker || !destination) {
  console.error('Usage: node packages/kernel-contract/examples/pinned-occt8-cuts.mjs /path/to/pinned-worker /fresh/output-directory');
  process.exit(2);
}
await mkdir(destination,{recursive:true});
const results=[];
for(const thickness of [8,12]) {
  const r={protocol:'intuit3d/kernel/plate-cut-chain-v1',
    requestId:'demo.plate-cuts.'+thickness,featureId:'body.mounting-plate',
    revision:thickness,units:'mm',exportStep:true,
    plate:{width:120,depth:80,thickness,
      holes:[{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]},
    cuts:[
      {featureId:'cut.blind-pocket',x:-10,y:20,width:12,depth:10,cutDepthMm:thickness===8?3:5},
      {featureId:'cut.through-window',x:5,y:-20,width:10,depth:8,cutDepthMm:thickness},
    ]};
  const result=await runPinnedOcct8CutChain(r,{
    workerExecutable:resolve(worker),readCurrentRevision:()=>thickness,
    stepOutput:join(resolve(destination),`plate-cuts-${thickness}.step`),timeoutMs:120000,
  });
  if(result.kind!=='experimental_report' || !result.artifact)
    throw Error(`Native C++ qualification failed (${thickness} mm): ${JSON.stringify(result)}`);
  results.push({revision:r.revision,bodyId:r.featureId,cuts:r.cuts.map(c=>c.featureId),
    expected:expectedOcct8CutMetrics(r),measured:result.observed,
    artifact:result.artifact,exactAuthority:false,independentInteroperability:false});
}
if(results[0].artifact.sha256===results[1].artifact.sha256)
  throw Error('retrospective dimension edit did not change physical STEP');
await writeFile(join(resolve(destination),'manifest.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(results,null,2));
