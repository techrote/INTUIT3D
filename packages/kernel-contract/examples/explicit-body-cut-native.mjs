/** Executed experimental L-bracket STEP: a distinct through-window cut feature. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runExperimentalBodyCut} from '../src/local-body-cut-provider.mjs';
const path=resolve(fileURLToPath(import.meta.url),'../../../../native/examples/l-bracket-separate-cut.request.json');
const q=JSON.parse(await readFile(path,'utf8'));
const out=resolve(process.argv[2]||'/tmp/intuit3d-explicit-body-cut');
await mkdir(out,{recursive:true});
const result=await runExperimentalBodyCut(q,{
  readCurrentRevision:()=>q.revision,stepOutput:join(out,'explicit-l-bracket-window.step')});
if(result.kind!=='experimental_body_cut_brep')throw Error(JSON.stringify(result));
await writeFile(join(out,'native-cut-receipt.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'EXPERIMENTAL_REAL_BOOLEAN_NOT_PRODUCTION',
  cutFeatureId:result.cutFeatureId,targetBodyId:result.targetBodyId,
  materialVolumeMm3:result.source.volumeMm3,stepBytes:result.artifact.bytes,
  stepSha256:result.artifact.sha256},null,2));
