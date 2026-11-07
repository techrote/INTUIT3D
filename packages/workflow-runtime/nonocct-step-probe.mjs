/**
 * Node-only bridge to an externally built, independently sourced AnvilCAD STEP
 * importer. No geometry solver, STEP parser or exact-authority promotion lives
 * here. The independent executable itself imports the actual output bytes.
 *
 * See conformance/external-cad/anvil_step_probe.rs for the output contract.
 * This adapter cannot authenticate the source used to build that executable;
 * its pinned binary hash and execution transcript must be independently
 * checked by the INTEGRATION/PLATFORM qualification gate.
 */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join} from 'node:path';

const HASH = /^[0-9a-f]{64}$/;
const MAX_STEP_BYTES = 8*1024*1024;
const MAX_OUTPUT_BYTES = 32*1024;
export const NONOCCT_STEP_PROBE_FORMAT = 'intuit3d.nonocct-step-sample';
export const NONOCCT_STEP_PROBE_VERSION = 1;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function reject(reason) { throw new Error('external STEP probe: '+reason); }
function finite(value) {
  const n=Number(value);
  if (!value || !Number.isFinite(n)) reject('invalid numeric receipt');
  return n;
}
function pairs(line) {
  const result=Object.create(null);
  for(const token of line.split(' ').slice(1)) {
    const index=token.indexOf('=');
    if(index<=0) reject('malformed receipt field');
    const k=token.slice(0,index),v=token.slice(index+1);
    if(Object.hasOwn(result,k)) reject('duplicate receipt field');
    result[k]=v;
  }
  return result;
}
function validPlate(plate) {
  if(!plate || ![plate.width,plate.depth,plate.thickness].every(x=>
      typeof x==='number'&&Number.isFinite(x)&&x>0) ||
      !Array.isArray(plate.holes)||plate.holes.length<2||plate.holes.length>32 ||
      plate.holes.some(h=>![h.x,h.y,h.radius].every(Number.isFinite)||h.radius<=0))
    reject('admitted dimensional plate and at least two holes required');
  return plate;
}
const near = (a,b,tolerance)=>Math.abs(a-b)<=tolerance;

/** Validate the *executed non-OCCT importer* transcript against the exact
 * authored plate, not simply a same-engine STEP parser or matching volume.
 * A synthetic transcript only tests this parser; it is not qualification.
 */
export function parseNonOcctPlateTranscript(stdout,plateInput) {
  const plate=validPlate(plateInput);
  if(typeof stdout!=='string'||stdout.length>MAX_OUTPUT_BYTES)
    reject('bounded text transcript required');
  const lines=stdout.trim().split(/\r?\n/);
  const accepts=lines.filter(x=>x.startsWith('ACCEPT '));
  if(accepts.length!==1) reject('one external ACCEPT receipt required');
  const fields=pairs(accepts[0]);
  const keys=['solids','source_unit','imported_exact','tris','open_edges',
    'volume_mm3','expected_mm3','warnings'];
  if(Object.keys(fields).length!==keys.length||keys.some(k=>!Object.hasOwn(fields,k)) ||
      fields.solids!=='1'||!['millimetre','millimeter'].includes(fields.source_unit)||
      fields.imported_exact!=='true'||fields.open_edges!=='0'||fields.warnings!=='0')
    reject('non-OCCT exact imported body, units, topology or warnings rejected');
  const triangles=finite(fields.tris);
  if(!Number.isSafeInteger(triangles)||triangles<8) reject('invalid triangle inventory');
  const volume=finite(fields.volume_mm3),claimed=finite(fields.expected_mm3);
  const expected=(plate.width*plate.depth-
    plate.holes.reduce((sum,h)=>sum+Math.PI*h.radius*h.radius,0))*plate.thickness;
  if(!(expected>0)||!near(claimed,expected,1e-5)||
      !near(volume,expected,expected*0.01)) reject('external sampled physical volume disagrees with authored plate');
  const probes=[...plate.holes.map((h,i)=>['hole.'+i,h.x,h.y,false]),
    ['solid.nw',-plate.width/6,-plate.depth/6,true],
    ['solid.ne',plate.width/6,-plate.depth/6,true],
    ['solid.sw',-plate.width/6,plate.depth/6,true],
    ['solid.se',plate.width/6,plate.depth/6,true],
    ['exterior',plate.width/2+10,0,false]];
  if(!plate.holes.some(h=>Math.abs(h.x)<1e-9&&Math.abs(h.y)<1e-9))
    probes.push(['central.material',0,0,true]);
  const rays=lines.filter(x=>x.startsWith('RAY '));
  if(rays.length!==probes.length) reject('missing or extra independent physical rays');
  const observed=[];
  for(let i=0;i<probes.length;i++) {
    const [name,x,y,material]=probes[i], parts=rays[i].split(/\s+/);
    if(parts.length!==7 || parts[1]!==name) reject('ray identities/order mismatch');
    const [rx,ry,hits,entry,exit]=parts.slice(2).map(finite);
    if(!near(rx,x,1e-6)||!near(ry,y,1e-6) ||
        hits!==(material?2:0) ||
        (material&&(!near(entry,0,0.05)||!near(exit,plate.thickness,0.05))))
      reject('ray geometry does not match authored bore/material location: '+name);
    observed.push({name,xMm:rx,yMm:ry,hits,entryZMm:material?entry:null,
      exitZMm:material?exit:null});
  }
  if(lines.length!==rays.length+1) reject('unexpected unrecognized external probe output');
  return Object.freeze({measuredVolumeMm3:volume,analyticVolumeMm3:expected,
    relativeVolumeError:Math.abs(volume-expected)/expected,triangles,
    sourceUnit:fields.source_unit,importedExactBrep:true,rays:observed});
}

/** Requires a *provided* absolute external importer executable and expected
 * binary digest. Never substitutes a local OCCT parser or synthetic success.
 * Returns evidence, but never grants runtime exact or product-wide interchange.
 */
export async function runNonOcctPlateProbe({probeExecutable,expectedProbeSha256,
  step,plate,source,timeoutMs=90000}={}) {
  validPlate(plate);
  if(typeof probeExecutable!=='string'||!isAbsolute(probeExecutable)||
      !HASH.test(expectedProbeSha256||'')||!step||
      !(step.bytes instanceof Uint8Array)||step.bytes.length<1||
      step.bytes.length>MAX_STEP_BYTES||!HASH.test(step.sha256||'')||
      step.verification!=='occt8_part21_plate_subset'||
      !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>180000)
    reject('absolute non-OCCT executable, binary SHA, admitted STEP and timeout required');
  const bytes=Buffer.from(step.bytes);
  if(sha256(bytes)!==step.sha256) reject('STEP changed after authoritative download');
  if(typeof source?.projectId!=='string'||!Number.isSafeInteger(source?.revision)||
      !HASH.test(source?.archiveSha256||'')) reject('source archive identity required');
  const binaryStat=await stat(probeExecutable);
  if(!binaryStat.isFile()||sha256(await readFile(probeExecutable))!==expectedProbeSha256)
    reject('external executable binary digest differs from pinned receipt');
  const folder=await mkdtemp(join(tmpdir(),'intuit3d-independent-step-'));
  try {
    const path=join(folder,'authored-plate.step');
    await writeFile(path,bytes,{flag:'wx',mode:0o600});
    const args=[path,String(plate.width),String(plate.depth),String(plate.thickness),
      plate.holes.map(h=>[h.x,h.y,h.radius].join(',')).join(';')];
    const transcript=await new Promise((resolve,rejectPromise)=>{
      const child=spawn(probeExecutable,args,{shell:false,windowsHide:true,
        stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='',size=0,done=false;
      const timeout=setTimeout(()=>child.kill('SIGKILL'),timeoutMs);
      const collect=(kind,chunk)=>{
        size+=chunk.length;
        if(size>MAX_OUTPUT_BYTES){child.kill('SIGKILL');return;}
        if(kind==='stdout')stdout+=chunk.toString('utf8');
        else stderr+=chunk.toString('utf8');
      };
      child.stdout.on('data',chunk=>collect('stdout',chunk));
      child.stderr.on('data',chunk=>collect('stderr',chunk));
      child.once('error',error=>{
        if(done)return;done=true;clearTimeout(timeout);rejectPromise(error);
      });
      child.once('close',(code,signal)=>{
        if(done)return;done=true;clearTimeout(timeout);
        if(code!==0||signal||size>MAX_OUTPUT_BYTES||stderr.trim())
          rejectPromise(new Error('non-OCCT importer execution rejected (exit '+code+')'));
        else resolve(stdout);
      });
    });
    const sample=parseNonOcctPlateTranscript(transcript,plate);
    return Object.freeze({format:NONOCCT_STEP_PROBE_FORMAT,
      version:NONOCCT_STEP_PROBE_VERSION,kind:'executed_nonocct_plate_sample',
      source:{...source},stepSha256:step.sha256,probeSha256:expectedProbeSha256,
      transcriptSha256:sha256(Buffer.from(transcript,'utf8')),rawTranscript:transcript,sample,
      exactAuthority:false,independentInteroperability:false,
      note:'External probe execution is source/sample evidence, not general STEP or product exact authority. Independent build provenance must be verified separately.'});
  } finally { await rm(folder,{recursive:true,force:true}); }
}

/**
 * Trusted Node-host API: check the STEP that the live authoritative session
 * would let WORKBENCH download NOW. Older evaluation replies are not authority.
 * External binary/source provenance remains the Integration qualification gate.
 */
export async function verifyCurrentLivePlateStep({
  session,evaluation,probeExecutable,expectedProbeSha256,timeoutMs,
}={}) {
  if(typeof session?.refresh!=='function'||typeof session?.save!=='function'||
      typeof session?.currentStep!=='function') reject('live session required');
  const source=evaluation?.source;
  const plate=evaluation?.result?.intendedPlate;
  if(evaluation?.kind!=='experimental_plate_evaluated'||
      evaluation.exactAuthority!==false||
      evaluation.independentInteroperability!==false||
      evaluation.result?.backend!=='OCCT-cxx-8.0.1'||
      evaluation.result?.occtVersion!=='8.0.1'||
      evaluation.result?.part21Audit?.kind!=='part21-plate-structural-v1'||
      evaluation.result.part21Audit.sha256!==evaluation.step?.sha256||
      evaluation.step?.verification!=='occt8_part21_plate_subset'||
      typeof source?.projectId!=='string'||
      !Number.isSafeInteger(source?.revision)||
      !HASH.test(source?.archiveSha256||''))
    reject('pinned source and artifact-bound Part21 receipt required');
  validPlate(plate);

  const readCurrent=()=>{
    // These are synchronous session methods: no asynchronous interleaving
    // occurs between identity, archive and downloaded receipt acquisition.
    const state=session.refresh(),archive=session.save(),step=session.currentStep();
    if(state?.projectId!==source.projectId||
        state?.revision!==source.revision||
        sha256(Buffer.from(archive,'utf8'))!==source.archiveSha256||
        !step||step.sha256!==evaluation.step.sha256||
        step.verification!=='occt8_part21_plate_subset'||
        !(step.bytes instanceof Uint8Array)||
        sha256(step.bytes)!==step.sha256)
      reject('stale live CAD revision or STEP receipt');
    return step;
  };
  const step=readCurrent();
  const evidence=await runNonOcctPlateProbe({
    probeExecutable,expectedProbeSha256,timeoutMs,
    source,plate,step,
  });
  // A user can edit/undo/reopen while a genuine external importer is running.
  // Never attach the old import result to the newly current CAD document.
  const stillCurrent=readCurrent();
  if(stillCurrent.sha256!==step.sha256||
      sha256(stillCurrent.bytes)!==sha256(step.bytes))
    reject('STEP changed while external importer was executing');
  return Object.freeze({
    ...evidence,kind:'executed_current_live_plate_nonocct_sample',
    note:'External CAD sample of the current revision-fenced STEP. Not generalized STEP qualification or production exact authority; independent importer build provenance still requires external attestation.',
  });
}
