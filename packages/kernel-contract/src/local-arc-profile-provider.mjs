// Experimental OCP line/arc STEP transport. Never production exact.
// Execute Python in a separate process; keep user destination private until
// revision, digest and geometric report pass.
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const SCRIPT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../native/analytic_profile_extrude.py');
const PROTOCOL='intuit3d/kernel/arc-extrude-v1';
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const MAX_RESULT=128*1024,MAX_STEP=32*1024*1024;
export class ArcProviderError extends Error {constructor(message){super(message);this.name='ArcProviderError'}}
const ensure=(v,message)=>{if(!v)throw new ArcProviderError(message)};
const current=fn=>{const n=fn();ensure(Number.isSafeInteger(n)&&n>=0,'invalid revision');return n};
const fail=(q,code,reason)=>({kind:'unresolved',code,reason,requestId:q.requestId,
  featureId:q.featureId,revision:q.revision,artifact:null});
export function validateArcExtrudeRequest(q){
  ensure(q&&typeof q==='object'&&!Array.isArray(q)&&q.protocol===PROTOCOL&&q.units==='mm',
    'unknown arc extrusion request');
  ensure(ID.test(q.requestId)&&ID.test(q.featureId)&&Number.isSafeInteger(q.revision)&&q.revision>=0,
    'invalid request identity');
  ensure(typeof q.exportStep==='boolean'&&typeof q.thicknessMm==='number'&&
    Number.isFinite(q.thicknessMm)&&q.thicknessMm>=1e-6&&q.thicknessMm<=1e6,
    'invalid extrusion thickness');
  const p=q.profile;
  ensure(p&&p.format==='intuit3d.analytic-arc-profile'&&p.version===1&&
    p.status==='analytic_2d_validated_pending_native'&&p.units==='mm'&&
    p.providerSubmissionReady===true&&p.nativeProfileAdmissible===false&&
    p.globalSelfIntersectionChecked===true&&p.holeContainmentChecked===true&&
    p.stepQualified===false&&ID.test(p.id)&&typeof p.sourceSignature==='string'&&p.sourceSignature&&
    Array.isArray(p.boundary)&&p.boundary.length>=4&&p.boundary.length<=256&&
    Array.isArray(p.holes)&&p.holes.length<=64&&
    Number.isFinite(p.materialAreaMm2)&&p.materialAreaMm2>0,
    'unqualified or invalid solved arc profile');
  return q;
}
const close=(a,b)=>typeof a==='number'&&Number.isFinite(a)&&
  Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);
export async function runExperimentalArcExtrude(request,{
  readCurrentRevision,stepOutput,pythonExecutable=process.platform==='win32'?'python':'python3',
  workerScript=SCRIPT,timeoutMs=30000,signal
}={}){
  const q=validateArcExtrudeRequest(request);
  ensure(typeof readCurrentRevision==='function','revision getter required');
  ensure(Number.isSafeInteger(timeoutMs)&&timeoutMs>=50&&timeoutMs<=120000,'invalid timeout');
  ensure(typeof pythonExecutable==='string'&&pythonExecutable.length>0,'invalid python executable');
  if(q.exportStep)ensure(typeof stepOutput==='string'&&stepOutput.length>0,'STEP output path required');
  else ensure(stepOutput===undefined,'STEP output without export request');
  if(current(readCurrentRevision)!==q.revision)return fail(q,'stale_revision');
  if(signal?.aborted)return fail(q,'cancelled');
  const folder=await fs.mkdtemp(join(tmpdir(),'intuit3d-arc-'));
  const privateStep=join(folder,'native.step');
  const args=[workerScript,...(q.exportStep?['--step-output',privateStep]:[])];
  let child,watchdog,abort=false,timeout=false,overflow=false,closed=false;
  const kill=()=>{if(closed||!child?.pid)return;
    try {if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}
    catch { /* already exited */ }};
  const onAbort=()=>{abort=true;kill()};
  let stage;
  try {
    const result=await new Promise(done=>{
      let spawnError=null,bytes=0;const chunks=[];
      try {child=spawn(pythonExecutable,args,{detached:process.platform!=='win32',
        stdio:['pipe','pipe','pipe'],windowsHide:true});}
      catch(error){done({error,code:-1,output:''});return}
      child.on('error',error=>{spawnError=error});
      child.stdin.on('error',()=>{});
      child.stderr.on('data',()=>{});
      child.stdout.on('data',chunk=>{bytes+=chunk.length;
        if(bytes>MAX_RESULT){overflow=true;kill()}else chunks.push(chunk)});
      child.on('close',code=>{closed=true;done({error:spawnError,code,output:Buffer.concat(chunks).toString('utf8')})});
      signal?.addEventListener('abort',onAbort,{once:true});
      if(signal?.aborted)onAbort();
      watchdog=setTimeout(()=>{timeout=true;kill()},timeoutMs);
      child.stdin.end(JSON.stringify(q));
    });
    if(abort||signal?.aborted)return fail(q,'cancelled');
    if(timeout)return fail(q,'timeout');
    if(result.error)return fail(q,'worker_crash',result.error.code);
    if(overflow||result.code!==0)return fail(q,'requires_reconciliation','native_worker_failed');
    let report;try{report=JSON.parse(result.output)}catch{return fail(q,'requires_reconciliation','malformed_ipc')}
    const p=q.profile;
    if(report.protocol!==PROTOCOL||report.status!=='experimental_brep'||
      report.requestId!==q.requestId||report.featureId!==q.featureId||
      report.revision!==q.revision||report.profileId!==p.id||
      report.sourceSignature!==p.sourceSignature||report.units!=='mm'||
      report.backend!=='OCP-python-prototype'||report.occtVersion!=='7.9.3.1'||
      report.exactAuthority!==false||report.independentInteroperability!==false||
      report.source?.valid!==true||report.source?.solidCount!==1||
      report.source?.shellCount!==1||
      !close(report.source.volumeMm3,p.materialAreaMm2*q.thicknessMm))
      return fail(q,'requires_reconciliation','untrusted_or_incorrect_native_result');
    if(current(readCurrentRevision)!==q.revision)return fail(q,'stale_revision');
    if(!q.exportStep){
      if(report.artifact!==null||report.stepReadback!==null)
        return fail(q,'requires_reconciliation','unexpected_step');
      return {kind:'experimental_profile_brep',...report,artifact:null};
    }
    if(report.stepReadback?.solidCount!==1||
      !close(report.stepReadback?.volumeMm3,p.materialAreaMm2*q.thicknessMm)||
      report.artifact?.verification!=='OCP-7.9.3.1-same-engine-only'||
      resolve(report.artifact?.path||'')!==resolve(privateStep))
      return fail(q,'requires_reconciliation','step_provenance_mismatch');
    const stat=await fs.stat(privateStep);
    if(!stat.isFile()||stat.size<256||stat.size>MAX_STEP)
      return fail(q,'requires_reconciliation','invalid_step_bytes');
    const raw=await fs.readFile(privateStep),sha256=createHash('sha256').update(raw).digest('hex');
    if(report.artifact.sha256!==sha256||report.artifact.bytes!==raw.length)
      return fail(q,'requires_reconciliation','step_digest_mismatch');
    const dest=resolve(stepOutput);
    await fs.mkdir(dirname(dest),{recursive:true});
    stage=join(dirname(dest),'.intuit3d-arc-'+randomUUID()+'.tmp');
    await fs.writeFile(stage,raw,{flag:'wx',mode:0o600});
    const handle=await fs.open(stage,'r+');
    try{await handle.sync()}finally{await handle.close()}
    if(signal?.aborted)return fail(q,'cancelled');
    if(current(readCurrentRevision)!==q.revision)return fail(q,'stale_revision');
    await fs.link(stage,dest); // exclusive, never overwrite
    if(signal?.aborted||current(readCurrentRevision)!==q.revision){
      await fs.unlink(dest);return fail(q,signal?.aborted?'cancelled':'stale_revision')}
    return {kind:'experimental_profile_brep',...report,
      artifact:{path:dest,bytes:raw.length,sha256,verification:'same_engine_only'}};
  } catch(error) {
    return fail(q,'requires_reconciliation','publication_or_spawn_'+(error?.code||error?.name||'error'));
  } finally {
    signal?.removeEventListener('abort',onAbort);
    if(watchdog)clearTimeout(watchdog);
    if(stage)await fs.rm(stage,{force:true});
    await fs.rm(folder,{recursive:true,force:true});
  }
}
