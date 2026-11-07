/** Experimental isolated OCP Boolean cut of explicit target and separate SKETCH profile.
 * No parallel document authority or claims of OCCT8 C++/external CAD qualification.
 */
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateArcExtrudeRequest} from './local-arc-profile-provider.mjs';
const WORKER=resolve(dirname(fileURLToPath(import.meta.url)),'../../../native/analytic_profile_cut.py');
const FORMAT='intuit3d/kernel/profile-body-cut-v1';
const POCKET_FORMAT='intuit3d/kernel/profile-body-cut-v2';
const CHAIN_FORMAT='intuit3d/kernel/profile-body-cut-chain-v3';
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const MAX_STEP=32*1024*1024,MAX_IPC=128*1024;
const ensure=(ok,reason)=>{if(!ok)throw new TypeError('body-cut provider: '+reason)};
const near=(a,b)=>typeof a==='number'&&Number.isFinite(a)&&
  Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);
const failure=(request,code,reason)=>Object.freeze({kind:'unresolved',code,reason,
  requestId:request.requestId,cutFeatureId:request.cutFeatureId,
  targetBodyId:request.targetBodyId,revision:request.revision,
  ...(request.protocol===CHAIN_FORMAT?{cutFeatureIds:request.cuts.map(c=>c.cutFeatureId)}:{}),
  artifact:null});

/** An ordered, independently authored set of physical cuts on one semantic body.
 * Full analytic mass must be removed by every cut; the native provider rejects
 * overlapping/escaping tools rather than approving a false cumulative volume.
 */
function validateCutChainRequest(q){
  const fields=['protocol','requestId','targetBodyId','revision','units',
    'baseExtrude','cuts','exportStep'];
  ensure(Object.keys(q).sort().join(',')===fields.sort().join(','),
    'invalid cut-chain schema');
  ensure(q.units==='mm'&&ID.test(q.requestId)&&ID.test(q.targetBodyId)&&
    Number.isSafeInteger(q.revision)&&q.revision>=0&&
    typeof q.exportStep==='boolean','invalid cut-chain identity, units or revision');
  validateArcExtrudeRequest(q.baseExtrude);
  ensure(q.baseExtrude.revision===q.revision&&!q.baseExtrude.exportStep,
    'stale or separately exported base extrusion');
  ensure(Array.isArray(q.cuts)&&q.cuts.length>=1&&q.cuts.length<=16,
    'one to sixteen authored cutting features required');
  const ids=new Set([q.requestId,q.baseExtrude.requestId,q.baseExtrude.featureId]);
  for(const [i,cut] of q.cuts.entries()){
    ensure(cut!==null&&typeof cut==='object'&&!Array.isArray(cut)&&
      Object.keys(cut).sort().join(',')==='cutDepthMm,cutFeatureId,cutTool',
      'invalid chain cut '+i);
    validateArcExtrudeRequest(cut.cutTool);
    const names=[cut.cutFeatureId,cut.cutTool.featureId,cut.cutTool.requestId];
    ensure(names.every(id=>typeof id==='string'&&ID.test(id)&&!ids.has(id))&&
      new Set(names).size===3,'aliased or repeated cut feature/request ID');
    for(const id of names)ids.add(id);
    ensure(cut.cutTool.revision===q.revision&&!cut.cutTool.exportStep&&
      near(cut.cutTool.thicknessMm,q.baseExtrude.thicknessMm)&&
      cut.cutTool.profile.holes.length===0,
      'stale, independently exporting or unsupported cut tool');
    ensure(typeof cut.cutDepthMm==='number'&&Number.isFinite(cut.cutDepthMm)&&
      cut.cutDepthMm>=1e-6&&cut.cutDepthMm<=q.baseExtrude.thicknessMm,
      'cut depth out of base thickness');
    ensure(cut.cutTool.profile.materialAreaMm2>1e-6&&
      cut.cutTool.profile.materialAreaMm2<q.baseExtrude.profile.materialAreaMm2,
      'cut area must be smaller than base material');
  }
  return q;
}

export function validateBodyCutRequest(request){
  ensure(request!==null&&typeof request==='object'&&!Array.isArray(request),
    'body cut request must be an object');
  if(request.protocol===CHAIN_FORMAT)return validateCutChainRequest(request);
  const pocket=request.protocol===POCKET_FORMAT;
  ensure(pocket||request.protocol===FORMAT,'unknown cut protocol');
  const fields=['protocol','requestId','cutFeatureId','targetBodyId','revision','units',
    'baseExtrude','cutTool','exportStep',...(pocket?['cutDepthMm']:[])];
  ensure(Object.keys(request).sort().join(',')===fields.sort().join(','),
    'unknown request schema');
  ensure(request.units==='mm'&&
    ID.test(request.requestId)&&ID.test(request.cutFeatureId)&&ID.test(request.targetBodyId)&&
    Number.isSafeInteger(request.revision)&&request.revision>=0&&
    typeof request.exportStep==='boolean','invalid identity, units or revision');
  for(const part of [request.baseExtrude,request.cutTool]){
    validateArcExtrudeRequest(part);
    ensure(part.revision===request.revision&&part.units==='mm'&&part.exportStep===false,
      'stale geometry or intermediate STEP export');
  }
  ensure(new Set([request.baseExtrude.featureId,request.cutTool.featureId,
    request.cutFeatureId]).size===3, 'source extrusion, tool and cut must have distinct feature IDs');
  ensure(near(request.baseExtrude.thicknessMm,request.cutTool.thicknessMm),
    'tool must use the base extrusion reference depth');
  if(pocket)ensure(typeof request.cutDepthMm==='number'&&
    Number.isFinite(request.cutDepthMm)&&request.cutDepthMm>=1e-6&&
    request.cutDepthMm<=request.baseExtrude.thicknessMm,
    'pocket depth must be positive and no greater than the base thickness');
  ensure(request.cutTool.profile.holes.length===0, 'profile cut with islands is not supported');
  const base=request.baseExtrude.profile.materialAreaMm2;
  const cut=request.cutTool.profile.materialAreaMm2;
  ensure(Number.isFinite(cut)&&cut>1e-6&&cut<base,
    'cut has nonpositive or oversized area');
  return request;
}

/** One process per request; no authoritative journal side effects on failure. */
export async function runExperimentalBodyCut(request,{
  readCurrentRevision,stepOutput,pythonExecutable=process.platform==='win32'?'python':'python3',
  workerScript=WORKER,timeoutMs=30000,signal
}={}){
  const q=validateBodyCutRequest(request);
  ensure(typeof readCurrentRevision==='function','live document revision getter required');
  ensure(Number.isSafeInteger(timeoutMs)&&timeoutMs>=50&&timeoutMs<=120000,
    'timeout must be between 50 and 120000 ms');
  ensure(typeof pythonExecutable==='string'&&pythonExecutable.length>0,'invalid Python executable');
  ensure(q.exportStep?typeof stepOutput==='string'&&stepOutput.length>0:
    stepOutput===undefined,'STEP path must match exportStep');
  const revision=()=>{const v=readCurrentRevision();
    ensure(Number.isSafeInteger(v)&&v>=0,'invalid current revision');return v};
  if(revision()!==q.revision)return failure(q,'stale_revision');
  if(signal?.aborted)return failure(q,'cancelled');
  const privateDir=await fs.mkdtemp(join(tmpdir(),'intuit3d-cut-'));
  const privateStep=join(privateDir,'physical.step');
  let child,watchdog,closed=false,cancelled=false,timedOut=false,overflow=false,stage;
  const terminate=()=>{if(!child?.pid||closed)return;
    try{if(process.platform==='win32')child.kill('SIGKILL');
      else process.kill(-child.pid,'SIGKILL');}catch{ /* process already exited */ }};
  const abort=()=>{cancelled=true;terminate()};
  try{
    const result=await new Promise(done=>{
      let spawnError,bytes=0;const stdout=[];
      try{child=spawn(pythonExecutable,[workerScript,...(q.exportStep?['--step-output',privateStep]:[])],{
        detached:process.platform!=='win32',windowsHide:true,stdio:['pipe','pipe','pipe']});}
      catch(error){done({error,code:-1,output:''});return}
      child.on('error',error=>{spawnError=error});
      child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
      child.stdout.on('data',data=>{bytes+=data.length;
        if(bytes>MAX_IPC){overflow=true;terminate()}else stdout.push(data)});
      child.on('close',code=>{closed=true;
        done({error:spawnError,code,output:Buffer.concat(stdout).toString('utf8')})});
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
      watchdog=setTimeout(()=>{timedOut=true;terminate()},timeoutMs);
      child.stdin.end(JSON.stringify(q));
    });
    if(cancelled||signal?.aborted)return failure(q,'cancelled');
    if(timedOut)return failure(q,'timeout');
    if(result.error)return failure(q,'worker_crash',result.error.code);
    if(overflow||result.code!==0)return failure(q,'requires_reconciliation','physical_worker_failed');
    let report;try{report=JSON.parse(result.output)}
    catch{return failure(q,'requires_reconciliation','malformed_native_report')}
    const chain=q.protocol===CHAIN_FORMAT;
    let expected=q.baseExtrude.profile.materialAreaMm2*q.baseExtrude.thicknessMm;
    if(chain){
      if(report.protocol!==CHAIN_FORMAT||report.status!=='experimental_body_cut_chain_brep'||
        report.requestId!==q.requestId||report.targetBodyId!==q.targetBodyId||
        report.baseFeatureId!==q.baseExtrude.featureId||
        report.revision!==q.revision||report.units!=='mm'||
        report.backend!=='OCP-python-prototype'||report.occtVersion!=='7.9.3.1'||
        report.exactAuthority!==false||report.independentInteroperability!==false||
        !Array.isArray(report.cutResults)||report.cutResults.length!==q.cuts.length)
        return failure(q,'requires_reconciliation','native_chain_identity_mismatch');
      for(let i=0;i<q.cuts.length;i++){
        const cut=q.cuts[i],actual=report.cutResults[i];
        const removed=cut.cutTool.profile.materialAreaMm2*cut.cutDepthMm;
        expected-=removed;
        if(actual?.cutFeatureId!==cut.cutFeatureId||
          actual.cutToolFeatureId!==cut.cutTool.featureId||
          !near(actual.cutDepthMm,cut.cutDepthMm)||
          actual.cutKind!==(cut.cutDepthMm<q.baseExtrude.thicknessMm?'blind_pocket':'through')||
          !near(actual.removedVolumeMm3,removed)||
          !near(actual.postCutVolumeMm3,expected))
          return failure(q,'requires_reconciliation','native_cut_step_mismatch');
      }
    }else{
      const cutDepth=q.protocol===POCKET_FORMAT?q.cutDepthMm:q.baseExtrude.thicknessMm;
      expected-=q.cutTool.profile.materialAreaMm2*cutDepth;
      if(report.protocol!==q.protocol||report.status!=='experimental_body_cut_brep'||
        report.requestId!==q.requestId||report.cutFeatureId!==q.cutFeatureId||
        report.targetBodyId!==q.targetBodyId||report.baseFeatureId!==q.baseExtrude.featureId||
        report.cutToolFeatureId!==q.cutTool.featureId||report.revision!==q.revision||
        report.units!=='mm'||report.backend!=='OCP-python-prototype'||
        report.occtVersion!=='7.9.3.1'||report.exactAuthority!==false||
        report.independentInteroperability!==false||
        (q.protocol===POCKET_FORMAT&&
          (!near(report.cutDepthMm,cutDepth)||
           report.cutKind!==(cutDepth<q.baseExtrude.thicknessMm?
             'blind_pocket':'through'))))
        return failure(q,'requires_reconciliation','native_geometry_or_identity_mismatch');
    }
    if(report.source?.valid!==true||report.source?.solidCount!==1||
      report.source?.shellCount!==1||
      !near(report.source.volumeMm3,expected)||
      !near(report.analyticResultVolumeMm3,expected)||
      !near(report.removedVolumeMm3,
        q.baseExtrude.profile.materialAreaMm2*q.baseExtrude.thicknessMm-expected))
      return failure(q,'requires_reconciliation','native_geometry_or_mass_mismatch');
    if(revision()!==q.revision)return failure(q,'stale_revision');
    if(!q.exportStep){
      if(report.artifact!==null||report.stepReadback!==null)
        return failure(q,'requires_reconciliation','unexpected_step');
      return Object.freeze({kind:chain?'experimental_body_cut_chain_brep':'experimental_body_cut_brep',...report,artifact:null});
    }
    if(report.stepReadback?.solidCount!==1||!near(report.stepReadback?.volumeMm3,expected)||
      report.artifact?.verification!=='OCP-7.9.3.1-same-engine-only'||
      resolve(report.artifact?.path||'')!==resolve(privateStep))
      return failure(q,'requires_reconciliation','unqualified_step_readback');
    const stat=await fs.stat(privateStep);
    if(!stat.isFile()||stat.size<256||stat.size>MAX_STEP)
      return failure(q,'requires_reconciliation','invalid_step_file');
    const bytes=await fs.readFile(privateStep);
    const digest=createHash('sha256').update(bytes).digest('hex');
    if(report.artifact.sha256!==digest||report.artifact.bytes!==bytes.length)
      return failure(q,'requires_reconciliation','step_digest_mismatch');
    const dest=resolve(stepOutput);
    await fs.mkdir(dirname(dest),{recursive:true});
    stage=join(dirname(dest),'.intuit3d-cut-'+randomUUID()+'.stage');
    await fs.writeFile(stage,bytes,{flag:'wx',mode:0o600});
    const handle=await fs.open(stage,'r+');
    try{await handle.sync()}finally{await handle.close()}
    if(signal?.aborted)return failure(q,'cancelled');
    if(revision()!==q.revision)return failure(q,'stale_revision');
    await fs.link(stage,dest);
    if(signal?.aborted||revision()!==q.revision){
      await fs.unlink(dest);
      return failure(q,signal?.aborted?'cancelled':'stale_revision');
    }
    return Object.freeze({kind:chain?'experimental_body_cut_chain_brep':'experimental_body_cut_brep',...report,
      artifact:{path:dest,bytes:bytes.length,sha256:digest,verification:'same_engine_only'}});
  }catch(error){
    return failure(q,'requires_reconciliation','publication_or_spawn_'+
      (error?.code||error?.name||'error'));
  }finally{
    signal?.removeEventListener('abort',abort);
    if(watchdog)clearTimeout(watchdog);
    if(stage)await fs.rm(stage,{force:true});
    await fs.rm(privateDir,{recursive:true,force:true});
  }
}
