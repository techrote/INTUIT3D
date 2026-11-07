// Source-matched pinned OCCT8 L-profile extrusion + blind/through cuts.
// Exact STEP authority requires further external CAD and application admission.
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runPinnedOcct8LProfileChain}
  from '../src/local-occt8-l-profile-provider.mjs';
import {expectedOcct8LProfileMetrics}
  from '../src/occt8-l-profile-v3.mjs';
const worker=process.argv[2]||process.env.INTUIT3D_OCCT8_WORKER;
const out=process.argv[3];
if(!worker||!out){
  console.error('Usage: node packages/kernel-contract/examples/pinned-occt8-l-profile.mjs /pinned/worker /fresh/output');
  process.exit(2);
}
await mkdir(out,{recursive:true});
const records=[];
for(const thickness of [8,12]) {
  const q={protocol:'intuit3d/kernel/l-profile-cut-chain-v3',
    requestId:'lbracket.'+thickness,featureId:'body.lbracket',revision:thickness,
    units:'mm',exportStep:true,
    profile:{profileId:'sketch.lbracket',width:120,depth:80,thickness,
      legWidth:30,footHeight:20},
    cuts:[
      {featureId:'pocket.blind',kind:'circle',x:-45,y:10,
        radius:5,cutDepthMm:thickness===8?3:5},
      {featureId:'window.through',kind:'rectangle',x:15,y:-30,
        width:10,depth:8,cutDepthMm:thickness},
    ]};
  const outcome=await runPinnedOcct8LProfileChain(q,{
    workerExecutable:resolve(worker),readCurrentRevision:()=>thickness,
    stepOutput:join(resolve(out),'l-profile-'+thickness+'.step'),
    timeoutMs:120000,
  });
  if(outcome.kind!=='experimental_report'||!outcome.artifact)
    throw Error('Pinned L-profile native failure: '+JSON.stringify(outcome));
  records.push({revision:thickness,bodyId:q.featureId,
    profileId:q.profile.profileId,cutFeatureIds:q.cuts.map(c=>c.featureId),
    expected:expectedOcct8LProfileMetrics(q),
    observed:outcome.observed,artifact:outcome.artifact,
    exactAuthority:false,independentInteroperability:false});
}
if(records[0].artifact.sha256===records[1].artifact.sha256)
  throw Error('Retrospective thickness edit did not alter STEP bytes');
await writeFile(join(resolve(out),'manifest.json'),
  JSON.stringify(records,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(records,null,2));
