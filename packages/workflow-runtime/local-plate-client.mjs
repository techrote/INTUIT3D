/**
 * Browser-safe companion for the trusted localhost-only Node experimental OCP
 * bridge. Authoritative model state is re-fenced after every asynchronous step.
 * No browser direct subprocess, kernel import, or exact-authority promotion.
 */
export const LOCAL_PLATE_CLIENT_FORMAT='intuit3d.local-plate-bridge';
export const LOCAL_PLATE_CLIENT_VERSION=1;
const MAX_STEP_BYTES=8*1024*1024;
// Only pinned backend/version/provenance pairs are admitted. The model never
// selects an arbitrary provider; even OCCT8+Part21 is experimental authority.
const PROVIDERS=Object.freeze({
  'OCP-python-prototype':{version:'7.9.3.1',verification:'same_engine_step_readback'},
  'OCCT-cxx-8.0.1':{version:'8.0.1',verification:'occt8_part21_plate_subset'},
});
const hashHex=bytes=>[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
function unresolved(code,reason) {
  return {kind:'unresolved',code,reason,artifact:null,
    exactAuthority:false,independentInteroperability:false};
}
function baseUrl(url) {
  const parsed=new URL(url);
  if (parsed.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) ||
      parsed.username || parsed.password || parsed.search || parsed.hash ||
      (parsed.pathname!=='/' && parsed.pathname!==''))
    throw new TypeError('local plate client requires uncredentialed loopback HTTP base URL');
  return parsed.origin;
}

/** Verify actual bytes before offering a STEP download to the UI. */
export async function decodeVerifiedLocalStep(step) {
  if (!step || step.filename!=='plate.step' ||
      !Object.values(PROVIDERS).some(p=>p.verification===step.verification) ||
      !Number.isSafeInteger(step.bytes) || step.bytes<1 || step.bytes>MAX_STEP_BYTES ||
      !/^[a-f0-9]{64}$/.test(step.sha256||'') ||
      typeof step.base64!=='string' || step.base64.length>4*Math.ceil(MAX_STEP_BYTES/3)+4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(step.base64))
    throw new TypeError('local STEP envelope invalid');
  if (!globalThis.crypto?.subtle?.digest || typeof globalThis.atob!=='function')
    throw new Error('SHA-256 and base64 decoders unavailable');
  const binary=atob(step.base64);
  if (binary.length!==step.bytes) throw new Error('STEP byte length disagrees with host');
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hash=hashHex(digest);
  if (hash!==step.sha256) throw new Error('STEP SHA-256 disagrees with host');
  return {filename:step.filename,bytes,sha256:hash,
    verification:step.verification};
}

/**
 * Use readCurrentHistory (e.g. React state ref), never an old event-handler
 * closure. Caller may save verified STEP bytes only if this result remains
 * current at the moment the UI actually offers the download.
 */
export async function evaluateLocalPlate({
  url,token,runtime,readCurrentHistory,cutFeatureId,requestId,
  exportStep=false,signal,fetchImpl=globalThis.fetch,
}={}) {
  const endpoint=baseUrl(url);
  if (!/^[a-f0-9]{64}$/.test(token||'') ||
      typeof runtime?.save!=='function' || typeof runtime?.inspect!=='function' ||
      typeof readCurrentHistory!=='function' || typeof fetchImpl!=='function')
    throw new TypeError('local plate client requires token, model runtime, history reader and fetch');
  let archive, report;
  try {
    const history=readCurrentHistory();
    archive=runtime.save(history);
    report=runtime.inspect(history);
  } catch {return unresolved('invalid_archive','current model archive is unavailable');}
  const stillCurrent=()=>{
    try {return runtime.save(readCurrentHistory())===archive;}
    catch {return false;}
  };
  if (!stillCurrent()) return unresolved('stale_revision','model edited before HTTP dispatch');
  if (signal?.aborted) return unresolved('cancelled','request cancelled before dispatch');
  let envelope;
  try {
    const response=await fetchImpl(endpoint+'/v1/plate/evaluate',{
      method:'POST',headers:{'content-type':'application/json','x-intuit3d-token':token},
      body:JSON.stringify({archive,cutFeatureId,requestId,exportStep}),signal,
      mode:'cors',credentials:'omit',cache:'no-store',
    });
    envelope=await response.json();
    if (!response.ok) {
      return unresolved(envelope?.code||'host_failure',
        envelope?.reason||'local plate host rejected request');
    }
  } catch(error) {
    return unresolved(signal?.aborted?'cancelled':'host_unreachable',
      signal?.aborted?'request cancelled':'local plate host unavailable');
  }
  if (!stillCurrent()) return unresolved('stale_revision','model edited during native evaluation');
  if (envelope?.format!==LOCAL_PLATE_CLIENT_FORMAT ||
      envelope.version!==LOCAL_PLATE_CLIENT_VERSION ||
      envelope.source?.projectId!==report.projectId ||
      envelope.source?.revision!==report.revision ||
      envelope.result?.exactAuthority!==false ||
      envelope.result?.independentInteroperability!==false ||
      !['unresolved','experimental_plate_evaluated'].includes(envelope.result.kind))
    return unresolved('invalid_host_reply','host reply has no admissible experimental provenance');
  // Bind host evidence to the exact document bytes, not just project/revision.
  if(!/^[a-f0-9]{64}$/.test(envelope.source?.archiveSha256||'')||
      !globalThis.crypto?.subtle?.digest)
    return unresolved('invalid_host_reply','source archive digest absent');
  const sourceHash=hashHex(new Uint8Array(
    await crypto.subtle.digest('SHA-256',new TextEncoder().encode(archive))));
  if(sourceHash!==envelope.source.archiveSha256)
    return unresolved('invalid_host_reply','host evaluated a different archive');
  if(!stillCurrent()) return unresolved('stale_revision','model edited while verifying native source');
  if (envelope.result.kind==='unresolved') return envelope.result;
  if (envelope.result.projectId!==report.projectId ||
      envelope.result.revision!==report.revision ||
      envelope.result.cutFeatureId!==cutFeatureId ||
      envelope.result.requestId!==requestId ||
      (exportStep? !envelope.step : envelope.step!==null))
    return unresolved('invalid_host_reply','host response does not match authored request');
  const provider=PROVIDERS[envelope.result.backend];
  if(!provider||envelope.result.occtVersion!==provider.version||
      (exportStep
        ? envelope.step?.verification!==provider.verification||
          envelope.result.artifact?.verification!==provider.verification
        : envelope.result.artifact!==null))
    return unresolved('invalid_host_reply','native result has mismatched pinned provider provenance');
  let step=null;
  if (exportStep) {
    try {step=await decodeVerifiedLocalStep(envelope.step);}
    catch {return unresolved('invalid_step','STEP payload verification failed');}
    if(provider===PROVIDERS['OCCT-cxx-8.0.1'] &&
       (envelope.result.part21Audit?.kind!=='part21-plate-structural-v1' ||
        envelope.result.part21Audit.sha256!==step.sha256))
      return unresolved('invalid_host_reply','native Part21 audit does not match verified STEP bytes');
    if (!stillCurrent()) return unresolved('stale_revision','model edited while decoding STEP bytes');
  }
  return {kind:'experimental_plate_evaluated',source:envelope.source,
    result:envelope.result,step,exactAuthority:false,
    independentInteroperability:false,
    note:provider===PROVIDERS['OCCT-cxx-8.0.1']
      ? 'Pinned OCCT8 with separate plate-subset Part21 audit; not general STEP interoperability or production exact authority.'
      : 'Experimental Node/OCP only. This is not independent STEP interoperability.'};
}
