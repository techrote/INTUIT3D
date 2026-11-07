/**
 * Experimental real OCP obround blind-pocket B-rep/STEP example.
 * Uses authored analytic line/arc profiles; not yet a RUNTIME/SKETCH browser
 * command or pinned OCCT8, and STEP readback is same-engine only.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runExperimentalBodyCut} from '../src/local-body-cut-provider.mjs';
const template=JSON.parse(await readFile(
  new URL('../../../native/examples/l-bracket-separate-cut.request.json',import.meta.url),'utf8'));
const r=6,x0=-36,x1=-16,y=-30;
const area=240+Math.PI*36;
template.protocol='intuit3d/kernel/profile-body-cut-v2';
template.cutTool.profile.boundary=[
  {id:'slot.lower',kind:'line',start:{x:x0,y:y-r},end:{x:x1,y:y-r}},
  {id:'slot.right',kind:'arc',start:{x:x1,y:y-r},end:{x:x1,y:y+r},
   center:{x:x1,y},radiusMm:r,startAngleRad:-Math.PI/2,sweepRad:Math.PI},
  {id:'slot.upper',kind:'line',start:{x:x1,y:y+r},end:{x:x0,y:y+r}},
  {id:'slot.left',kind:'arc',start:{x:x0,y:y+r},end:{x:x0,y:y-r},
   center:{x:x0,y},radiusMm:r,startAngleRad:Math.PI/2,sweepRad:Math.PI}
];
template.cutTool.profile.signedBoundaryAreaMm2=area;
template.cutTool.profile.materialAreaMm2=area;
const directory=resolve(process.argv[2]||'/tmp/intuit3d-obround-pocket-new');
await mkdir(directory,{recursive:true});
const results=[];
for(const depth of [3,8]){
  const request={...template,cutDepthMm:depth,requestId:'pocket.depth'+depth};
  const result=await runExperimentalBodyCut(request,{
    readCurrentRevision:()=>request.revision,stepOutput:join(directory,depth+'mm.step'),
    pythonExecutable:process.env.INTUIT3D_OCP_PYTHON||
      (process.platform==='win32'?'python':'python3')});
  if(result.kind!=='experimental_body_cut_brep')throw Error(JSON.stringify(result));
  const expected=(11800-Math.PI*36)*8-area*depth;
  if(Math.abs(result.source.volumeMm3-expected)>1e-6||
     Math.abs(result.stepReadback.volumeMm3-expected)>1e-6)
    throw Error('wrong physical obround pocket volume');
  results.push({depthMm:depth,kind:result.cutKind,bodyId:result.targetBodyId,
    volumeMm3:result.source.volumeMm3,stepSha256:result.artifact.sha256,
    stepBytes:result.artifact.bytes});
}
if(results[0].stepSha256===results[1].stepSha256)throw Error('identical pocket STEP');
await writeFile(join(directory,'manifest.json'),JSON.stringify({
  evidence:'actual-experimental-OCP-7.9.3.1-BRep-and-same-engine-STEP',
  pinnedOCCT8Cxx:false,independentExternalCad:false,results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kind:'EXPERIMENTAL_OBROUND_POCKET_STEP',results},null,2));
