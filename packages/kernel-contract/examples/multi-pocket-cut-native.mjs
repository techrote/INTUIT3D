/**
 * Actual OCP 7.9.3.1 one-body multi-feature cut, not an exact-authority provider.
 * A real obround blind pocket and a separate through window are cut in order.
 * Retrospective extrusion and pocket-depth edits produce different physical
 * STEP bytes, with one original semantic body and unchanged feature identities.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runExperimentalBodyCut,validateBodyCutRequest}
  from '../src/local-body-cut-provider.mjs';

const fixture=JSON.parse(await readFile(new URL(
  '../../../native/examples/l-bracket-separate-cut.request.json',import.meta.url),'utf8'));
const directory=resolve(process.argv[2]||'/tmp/intuit3d-multi-pocket-new');
await mkdir(directory,{recursive:true});
const r=6, x0=-36, x1=-16, y=-30;
const slotArea=240+Math.PI*r*r;
const slot=[
  {id:'slot.lower',kind:'line',start:{x:x0,y:y-r},end:{x:x1,y:y-r}},
  {id:'slot.right',kind:'arc',start:{x:x1,y:y-r},end:{x:x1,y:y+r},
   center:{x:x1,y},radiusMm:r,startAngleRad:-Math.PI/2,sweepRad:Math.PI},
  {id:'slot.upper',kind:'line',start:{x:x1,y:y+r},end:{x:x0,y:y+r}},
  {id:'slot.left',kind:'arc',start:{x:x0,y:y+r},end:{x:x0,y:y-r},
   center:{x:x0,y},radiusMm:r,startAngleRad:Math.PI/2,sweepRad:Math.PI}
];
const rectangle=[[30,-40],[50,-40],[50,-20],[30,-20]];
const windowBoundary=rectangle.map(([x,y],i)=>{
  const [nextX,nextY]=rectangle[(i+1)%rectangle.length];
  return {id:'window.edge'+i,kind:'line',
    start:{x,y},end:{x:nextX,y:nextY}};
});
function requestFor(thicknessMm,pocketMm){
  const baseExtrude=structuredClone(fixture.baseExtrude);
  const slotTool=structuredClone(fixture.cutTool);
  const windowTool=structuredClone(fixture.cutTool);
  for(const tool of [baseExtrude,slotTool,windowTool])tool.thicknessMm=thicknessMm;
  slotTool.requestId='request.slot.tool';
  slotTool.featureId='tool.slot';
  slotTool.profile.id='profile.slot';
  slotTool.profile.sourceSignature='sketch.mounting.slot';
  slotTool.profile.boundary=slot;
  slotTool.profile.materialAreaMm2=slotArea;
  slotTool.profile.signedBoundaryAreaMm2=slotArea;
  windowTool.requestId='request.window.tool';
  windowTool.featureId='tool.window2';
  windowTool.profile.id='profile.window2';
  windowTool.profile.sourceSignature='sketch.cut.window2';
  windowTool.profile.boundary=windowBoundary;
  windowTool.profile.materialAreaMm2=400;
  windowTool.profile.signedBoundaryAreaMm2=400;
  return validateBodyCutRequest({
    protocol:'intuit3d/kernel/profile-body-cut-chain-v3',
    requestId:'request.multi.cut.'+thicknessMm,
    targetBodyId:fixture.targetBodyId,revision:fixture.revision,
    units:'mm',baseExtrude,exportStep:true,
    cuts:[
      {cutFeatureId:'cut.obround',cutTool:slotTool,cutDepthMm:pocketMm},
      {cutFeatureId:'cut.window2',cutTool:windowTool,cutDepthMm:thicknessMm}
    ]
  });
}
const results=[];
for(const [thickness,pocket] of [[8,3],[12,5]]){
  const request=requestFor(thickness,pocket);
  const saved=join(directory,thickness+'mm-request.json');
  await writeFile(saved,JSON.stringify(request,null,2)+'\n',{flag:'wx'});
  // Reopen the authored provider request without re-deriving profiles from mesh.
  const reopened=validateBodyCutRequest(JSON.parse(await readFile(saved,'utf8')));
  const output=join(directory,thickness+'mm.step');
  const result=await runExperimentalBodyCut(reopened,{
    readCurrentRevision:()=>reopened.revision,stepOutput:output,
    pythonExecutable:process.env.INTUIT3D_OCP_PYTHON||
      (process.platform==='win32'?'python':'python3')
  });
  if(result.kind!=='experimental_body_cut_chain_brep')
    throw new Error(JSON.stringify(result));
  const expected=(11800-Math.PI*36)*thickness-slotArea*pocket-400*thickness;
  if(Math.abs(result.source.volumeMm3-expected)>1e-6||
     Math.abs(result.stepReadback.volumeMm3-expected)>1e-6||
     result.cutResults.length!==2)
    throw new Error('wrong physical chain material');
  results.push({thicknessMm:thickness,blindPocketMm:pocket,bodyId:result.targetBodyId,
    cuts:result.cutResults.map(c=>({id:c.cutFeatureId,kind:c.cutKind,
      removedVolumeMm3:c.removedVolumeMm3})),
    volumeMm3:result.source.volumeMm3,
    stepSha256:result.artifact.sha256,stepBytes:result.artifact.bytes});
}
if(results[0].stepSha256===results[1].stepSha256)
  throw new Error('retrospective edit generated identical STEP bytes');
const manifest={evidence:'real-OCP-7.9.3.1-physical-cut-chain-same-engine-STEP',
  pinnedOCCT8Cxx:false,independentExternalCad:false,results};
await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',
  {flag:'wx'});
console.log(JSON.stringify(manifest,null,2));
