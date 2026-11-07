/** Genuine OCP 7.9.3.1 plate-with-two-bores and side-edge notch.
 * The cutting rectangle deliberately extends outside the plate; the physical
 * removed mass is the analytic INTERSECTION, not the entire tool footprint.
 * Changing an earlier plate width changes the genuine STEP mass and geometry.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runExperimentalBodyCut,validateBodyCutRequest}
  from '../src/local-body-cut-provider.mjs';

const fixture=JSON.parse(await readFile(new URL(
  '../../../native/examples/l-bracket-separate-cut.request.json',import.meta.url),'utf8'));
const directory=resolve(process.argv[2]||'/tmp/intuit3d-notch-fresh');
await mkdir(directory,{recursive:true});
function rect(x0,y0,x1,y1,label){
  const xy=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
  return xy.map(([x,y],i)=>({id:label+'.'+i,kind:'line',
    start:{x,y},end:{x:xy[(i+1)%4][0],y:xy[(i+1)%4][1]}}));
}
function requestFor(width,depth){
  const q=structuredClone(fixture);
  q.protocol='intuit3d/kernel/profile-body-notch-v4';
  q.requestId='notch.'+width+'.'+depth;
  q.cutFeatureId='cut.side.notch';
  q.targetBodyId='body.plate';
  q.cutDepthMm=depth;
  const p=q.baseExtrude.profile;
  p.id='profile.plate';
  p.sourceSignature='authored.plate.width.'+width;
  p.boundary=rect(-width/2,-40,width/2,40,'plate');
  p.holes=[
    {id:'bore.left',centerId:'center.left',x:-30,y:0,radiusMm:6},
    {id:'bore.right',centerId:'center.right',x:30,y:0,radiusMm:6}
  ];
  p.signedBoundaryAreaMm2=width*80;
  p.materialAreaMm2=width*80-2*Math.PI*36;
  const tool=q.cutTool.profile;
  tool.id='profile.notch';
  tool.sourceSignature='authored.notch.tool';
  tool.boundary=rect(50,-10,70,10,'notch');
  tool.holes=[];
  tool.signedBoundaryAreaMm2=400;
  tool.materialAreaMm2=400;
  return validateBodyCutRequest(q);
}
const results=[];
for(const [width,depth] of [[120,8],[130,8],[120,3]]){
  const request=requestFor(width,depth);
  const label=width+'mm-'+depth+'mm';
  const json=join(directory,label+'.request.json');
  await writeFile(json,JSON.stringify(request,null,2)+'\n',{flag:'wx'});
  const reopened=validateBodyCutRequest(JSON.parse(await readFile(json,'utf8')));
  const output=join(directory,label+'.step');
  const result=await runExperimentalBodyCut(reopened,{
    readCurrentRevision:()=>reopened.revision,
    stepOutput:output,
    pythonExecutable:process.env.INTUIT3D_OCP_PYTHON||
      (process.platform==='win32'?'python':'python3')
  });
  if(result.kind!=='experimental_body_cut_brep')
    throw new Error(JSON.stringify(result));
  const footprint=(width/2-50)*20;
  const expected=(width*80-2*Math.PI*36)*8-footprint*depth;
  if(Math.abs(result.source.volumeMm3-expected)>1e-6||
     Math.abs(result.stepReadback.volumeMm3-expected)>1e-6||
     Math.abs(result.footprintIntersectionAreaMm2-footprint)>1e-7)
    throw new Error('incorrect physical notch intersection mass');
  results.push({label,plateWidthMm:width,pocketDepthMm:depth,
    footprintIntersectionMm2:footprint,bodyId:result.targetBodyId,
    volumeMm3:result.source.volumeMm3,
    stepSha256:result.artifact.sha256,stepBytes:result.artifact.bytes});
}
if(new Set(results.map(r=>r.stepSha256)).size!==3||
   new Set(results.map(r=>r.bodyId)).size!==1)
  throw new Error('retrospective edit or pocket depth did not change physical STEP');
const manifest={execution:'real-OCP-7.9.3.1-experimental-perimeter-notch',
  qualifiedOCCT8Cxx:false,independentCadInterop:false,results};
await writeFile(join(directory,'manifest.json'),
  JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(manifest,null,2));
