// Actual pinned 8.0.1 C++ circular blind pocket + rectangular through-cut.
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runPinnedOcct8MixedCutChain} from '../src/local-occt8-mixed-cut-provider.mjs';
import {expectedOcct8MixedCutMetrics} from '../src/occt8-mixed-cut-v2.mjs';
const worker=process.argv[2]||process.env.INTUIT3D_OCCT8_WORKER;
const destination=process.argv[3];
if(!worker||!destination){
  console.error('Usage: node packages/kernel-contract/examples/pinned-occt8-mixed-cuts.mjs /pinned/worker /fresh/output');
  process.exit(2);
}
await mkdir(destination,{recursive:true});
const results=[];
for(const thickness of [8,12]) {
  const q={protocol:'intuit3d/kernel/plate-mixed-cut-chain-v2',
    requestId:'demo.mixed.'+thickness,featureId:'body.mounting-plate',revision:thickness,
    units:'mm',exportStep:true,
    plate:{width:120,depth:80,thickness,
      holes:[{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]},
    cuts:[
      {featureId:'cut.circular-pocket',kind:'circle',x:-10,y:20,
        radius:5,cutDepthMm:thickness===8?3:5},
      {featureId:'cut.rectangular-window',kind:'rectangle',
        x:5,y:-20,width:10,depth:8,cutDepthMm:thickness},
    ]};
  const result=await runPinnedOcct8MixedCutChain(q,{
    workerExecutable:resolve(worker),readCurrentRevision:()=>thickness,
    stepOutput:join(resolve(destination),'mixed-'+thickness+'.step'),
    timeoutMs:120000,
  });
  if(result.kind!=='experimental_report'||!result.artifact)
    throw Error('Pinned native mixed-cut failed: '+JSON.stringify(result));
  results.push({revision:thickness,bodyId:q.featureId,
    cutFeatureIds:q.cuts.map(c=>c.featureId),
    expected:expectedOcct8MixedCutMetrics(q),observed:result.observed,
    artifact:result.artifact,exactAuthority:false,independentInteroperability:false});
}
if(results[0].artifact.sha256===results[1].artifact.sha256)
  throw Error('retrospective edit did not change physical STEP bytes');
await writeFile(join(resolve(destination),'manifest.json'),
  JSON.stringify(results,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(results,null,2));
