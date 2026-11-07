/**
 * Node-only, loopback-only gateway between the browser model archive and
 * the real experimental Node/OCP plate workflow. No arbitrary path API.
 * This is NOT a production exact or independently qualified STEP provider.
 */
import {createServer} from 'node:http';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {createExperimentalPlateWorkflow} from './experimental-plate.mjs';

export const LOCAL_PLATE_BRIDGE_FORMAT = 'intuit3d.local-plate-bridge';
export const LOCAL_PLATE_BRIDGE_VERSION = 1;
/** Authenticated, browser-consumable provider identity. This is configuration,
 * NOT a native execution/self-test or a production/exactness certificate. */
export const LOCAL_PLATE_CAPABILITY_FORMAT = 'intuit3d.local-plate-bridge-capability';
export const LOCAL_PLATE_CAPABILITY_VERSION = 1;
const IDENTITIES=Object.freeze({
  ocp:Object.freeze({backend:'OCP-python-prototype',occtVersion:'7.9.3.1',
    stepVerification:'same_engine_step_readback'}),
  occt8:Object.freeze({backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
    stepVerification:'occt8_part21_plate_subset'}),
});
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
const MAX_STEP_BYTES = 8 * 1024 * 1024;
const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

function unresolved(code, reason) {
  return {kind:'unresolved', code, reason, artifact:null,
    exactAuthority:false, independentInteroperability:false};
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function validBody(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 4 &&
    ['archive','cutFeatureId','requestId','exportStep'].every(k=>Object.hasOwn(value,k)) &&
    typeof value.archive === 'string' && value.archive.length > 0 &&
    Buffer.byteLength(value.archive,'utf8') <= MAX_ARCHIVE_BYTES &&
    typeof value.cutFeatureId === 'string' && ID.test(value.cutFeatureId) &&
    typeof value.requestId === 'string' && ID.test(value.requestId) &&
    typeof value.exportStep === 'boolean';
}

/**
 * The host and provider are trusted local Node code. Untrusted HTTP clients can
 * send only a bounded authoritative archive and semantic cut/request IDs.
 * The host chooses all native filesystem paths, never the browser.
 *
 * Browser-side revision changes cannot be observed by a stateless HTTP server.
 * Its companion browser client MUST recheck the authoritative live archive
 * after the request before exposing any result or STEP bytes.
 */
export async function startLocalPlateBridge({
  runtime, model, plateContract, runExperimentalPlate, providerKind='ocp',
  origin = 'http://127.0.0.1:5173', port = 0, timeoutMs = 25000,
} = {}) {
  if (!Object.hasOwn(IDENTITIES,providerKind))
    throw new TypeError('bridge: pinned provider kind must be ocp or occt8');
  if (typeof runtime?.reopen !== 'function' || typeof runtime?.save !== 'function' ||
      typeof runtime?.inspect !== 'function')
    throw new TypeError('bridge: real model-backed runtime required');
  if (typeof origin !== 'string' ||
      !/^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(origin) ||
      !Number.isSafeInteger(port) || port < 0 || port > 65535 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000)
    throw new TypeError('bridge: loopback origin, port and bounded timeout required');

  const workflow=createExperimentalPlateWorkflow({
    runtime,model,plateContract,runExperimentalPlate,providerKind,
  });
  const requiredVerification=providerKind==='occt8'
    ? 'occt8_part21_plate_subset' : 'same_engine_step_readback';
  const token=randomBytes(32).toString('hex');
  let active=null;
  let boundPort=0;
  const server=createServer(async (req,res)=>{
    const safeWrite=(code,obj,allowOrigin=false)=>{
      if (res.destroyed || res.writableEnded) return;
      const headers={'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Vary':'Origin'};
      if (allowOrigin) headers['Access-Control-Allow-Origin']=origin;
      res.writeHead(code,headers);
      res.end(JSON.stringify(obj));
    };
    const sameOrigin=req.headers.origin === origin;
    // Reject DNS rebinding, remote origins and unsupported methods before
    // reading untrusted request bytes. An absent Origin is only for CLI clients
    // presenting the same per-host secret.
    if (req.headers.host !== '127.0.0.1:'+boundPort ||
        (req.headers.origin !== undefined && !sameOrigin)) {
      safeWrite(403,unresolved('forbidden','non-loopback host or origin')); return;
    }
    const capabilityRoute=req.url==='/v1/plate/capabilities';
    if (req.method==='OPTIONS' &&
        (capabilityRoute||req.url==='/v1/plate/evaluate') && sameOrigin) {
      res.writeHead(204,{'Access-Control-Allow-Origin':origin,
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'content-type, x-intuit3d-token',
        'Access-Control-Max-Age':'300','Vary':'Origin',
        'Cache-Control':'no-store'});
      res.end(); return;
    }
    if (capabilityRoute && req.method==='GET') {
      if (req.headers['x-intuit3d-token']!==token) {
        safeWrite(403,unresolved('forbidden','invalid bridge token'),sameOrigin);
        return;
      }
      safeWrite(200,{
        format:LOCAL_PLATE_CAPABILITY_FORMAT,
        version:LOCAL_PLATE_CAPABILITY_VERSION,
        ...IDENTITIES[providerKind],
        exactAuthority:false,
        independentInteroperability:false,
        note:'Configured local provider identity only; native binary availability, execution and STEP accuracy are not proven by this handshake.',
      },sameOrigin);
      return;
    }
    if (req.method!=='POST' || req.url!=='/v1/plate/evaluate') {
      safeWrite(404,unresolved('unknown_route','unsupported route'),sameOrigin); return;
    }
    if (req.headers['x-intuit3d-token']!==token) {
      safeWrite(403,unresolved('forbidden','invalid bridge token'),sameOrigin); return;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')) {
      safeWrite(415,unresolved('invalid_request','JSON content type required'),sameOrigin); return;
    }
    if (active) {
      safeWrite(409,unresolved('busy','another native evaluation is in progress'),sameOrigin); return;
    }
    let raw;
    try {
      const chunks=[]; let total=0;
      for await (const chunk of req) {
        total+=chunk.length;
        if (total>MAX_ARCHIVE_BYTES+8192) {
          safeWrite(413,unresolved('request_too_large','archive request exceeds limit'),sameOrigin);
          return;
        }
        chunks.push(chunk);
      }
      raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!validBody(raw)) throw new TypeError('invalid envelope');
    } catch {
      safeWrite(400,unresolved('invalid_request','invalid bounded evaluation envelope'),sameOrigin);
      return;
    }
    let history, report;
    try {
      history=runtime.reopen(raw.archive);
      report=runtime.inspect(history);
      if (runtime.save(history)!==raw.archive)
        throw new Error('archive not in canonical representation');
    } catch {
      safeWrite(422,unresolved('invalid_archive','model archive cannot be admitted'),sameOrigin);
      return;
    }
    // A second request can finish its body while a first is still parsing.
    // Close that admission race before acquiring the single native slot.
    if (active) {
      safeWrite(409,unresolved('busy','another native evaluation is in progress'),sameOrigin);
      return;
    }
    const abort=new AbortController();
    const onClose=()=>{if (!res.writableEnded) abort.abort();};
    res.once('close',onClose);
    active=abort;
    let folder=null;
    try {
      const archiveSha256=sha256(Buffer.from(raw.archive,'utf8'));
      if (raw.exportStep) folder=await mkdtemp(join(tmpdir(),'intuit3d-bridge-'));
      const output=folder?join(folder,'plate.step'):undefined;
      const result=await workflow.evaluate(history,{
        cutFeatureId:raw.cutFeatureId,requestId:raw.requestId,
        readCurrentHistory:()=>history,exportStep:raw.exportStep,
        ...(output?{stepOutput:output}:{}),timeoutMs,signal:abort.signal,
      });
      if (abort.signal.aborted) return;
      let step=null, publicResult=result;
      if (result.kind==='experimental_plate_evaluated' && raw.exportStep) {
        const info=result.artifact;
        if (!info || info.path!==output || !Number.isSafeInteger(info.bytes) ||
            info.bytes<1 || info.bytes>MAX_STEP_BYTES ||
            !/^[a-f0-9]{64}$/.test(info.sha256||'') ||
            info.verification!==requiredVerification) {
          publicResult=unresolved('invalid_step','invalid native artifact report');
        } else {
          const bytes=await readFile(output);
          if (bytes.length!==info.bytes || sha256(bytes)!==info.sha256) {
            publicResult=unresolved('invalid_step','STEP bytes failed host digest verification');
          } else {
            step={filename:'plate.step',bytes:info.bytes,sha256:info.sha256,
              verification:requiredVerification,base64:bytes.toString('base64')};
          }
        }
      }
      if (publicResult.kind==='experimental_plate_evaluated') {
        publicResult={...publicResult,artifact:publicResult.artifact?{
          bytes:publicResult.artifact.bytes,sha256:publicResult.artifact.sha256,
          verification:publicResult.artifact.verification,
        }:null};
      }
      safeWrite(200,{
        format:LOCAL_PLATE_BRIDGE_FORMAT,version:LOCAL_PLATE_BRIDGE_VERSION,
        source:{projectId:report.projectId,revision:report.revision,archiveSha256},
        result:publicResult,step,
      },sameOrigin);
    } catch {
      safeWrite(500,unresolved('host_failure','local native bridge failed'),sameOrigin);
    } finally {
      active=null;
      res.off('close',onClose);
      if (folder) await rm(folder,{recursive:true,force:true});
    }
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen({host:'127.0.0.1',port},()=>{
      server.off('error',reject); resolve();
    });
  });
  boundPort=server.address().port;
  return Object.freeze({
    url:'http://127.0.0.1:'+boundPort, token,
    async close() {
      active?.abort();
      await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
    },
  });
}

// Explicit, trusted Node-only path to the real KERNEL OCCT 8.0.1 provider.
// The browser never supplies worker paths, native settings or backend identity.
export async function startLocalPinnedOcct8Bridge({
  workerExecutable,runPinnedOcct8Plate,pythonExecutable,
  crossVersionStepAudit=false,...options
}={}) {
  if(typeof workerExecutable!=='string'||!isAbsolute(workerExecutable)||
      typeof runPinnedOcct8Plate!=='function'||
      (pythonExecutable!==undefined&&
        (typeof pythonExecutable!=='string'||!pythonExecutable))||
      typeof crossVersionStepAudit!=='boolean')
    throw new TypeError('pinned OCCT8 bridge needs an absolute worker path and native provider');
  if(Object.hasOwn(options,'runExperimentalPlate')||
      Object.hasOwn(options,'providerKind'))
    throw new TypeError('pinned OCCT8 bridge must not override provider identity');
  return startLocalPlateBridge({
    ...options,providerKind:'occt8',
    runExperimentalPlate:(request,nativeOptions)=>runPinnedOcct8Plate(request,{
      ...nativeOptions,workerExecutable,part21StepAudit:true,
      crossVersionStepAudit,
      ...(pythonExecutable?{pythonExecutable}:{}),
    }),
  });
}
