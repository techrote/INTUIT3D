// Node-only local process adapter for the experimental OCP plate worker.
// This is executable B-rep/STEP research evidence, not production exact authority.
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessPlateResponse, KernelContractError, parsePlateRequest} from './plate-v1.mjs';
import {assessOcct8PlateResponse} from './occt8-v1.mjs';
import {parseOcct8CutRequest, assessOcct8CutResponse} from './occt8-cut-v1.mjs';
import {parseOcct8MixedCutRequest, assessOcct8MixedCutResponse}
  from './occt8-mixed-cut-v2.mjs';
import {parseOcct8LProfileRequest, assessOcct8LProfileResponse}
  from './occt8-l-profile-v3.mjs';

const DEFAULT_SUPERVISOR = fileURLToPath(new URL('../../../native/run_plate.py', import.meta.url));
const DEFAULT_OCCT8_SUPERVISOR = fileURLToPath(new URL('../../../native/occt8_bridge.py', import.meta.url));
const MAX_REPLY_BYTES = 65536;
const MAX_STEP_BYTES = 32 * 1024 * 1024;

function unresolved(request, code, reason) {
  return {kind:'unresolved', code, requestId:request.requestId,
    featureId:request.featureId, revision:request.revision, artifact:null, ...(reason ? {reason} : {})};
}
function revisionOf(readCurrentRevision) {
  const revision = readCurrentRevision();
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new KernelContractError('readCurrentRevision must return a nonnegative safe integer');
  return revision;
}

// Server/desktop Node only. Local trusted files; NOT a hostile-process security sandbox.
// Native supervisor performs real OCP Boolean construction and separate same-engine STEP
// readback. This layer fences semantic revision and alone publishes the export destination.
// Both backends share one revision-fenced publication path. The pinned 8.0.1
// path remains experimental until its actual C++ binary and STEP consumer are qualified.
export async function runExperimentalPlate(requestInput, options = {}) {
  return runLocalPlate(requestInput, {...options, backendKind:'ocp'});
}

export async function runPinnedOcct8Plate(requestInput, {
  workerExecutable, part21StepAudit = true, crossVersionStepAudit = false,
  nativeSupervisor = DEFAULT_OCCT8_SUPERVISOR, ...options
} = {}) {
  if (typeof workerExecutable !== 'string' || !workerExecutable.trim())
    throw new KernelContractError('pinned OCCT 8.0.1 workerExecutable path is required');
  if (typeof part21StepAudit !== 'boolean' || typeof crossVersionStepAudit !== 'boolean')
    throw new KernelContractError('OCCT8 STEP audit options must be boolean');
  return runLocalPlate(requestInput, {...options, nativeSupervisor, backendKind:'occt8',
    workerExecutable:resolve(workerExecutable), part21StepAudit, crossVersionStepAudit});
}

// Explicitly ordered rectangular C++ cuts, with no fallback to OCP or a mesh.
// This shares cancellation, publication and revision fences with the plate API.
export async function runPinnedOcct8CutChain(requestInput, {
  workerExecutable, nativeSupervisor = DEFAULT_OCCT8_SUPERVISOR, ...options
} = {}) {
  if (typeof workerExecutable !== 'string' || !workerExecutable.trim())
    throw new KernelContractError('pinned C++ workerExecutable path is required');
  return runLocalPlate(requestInput, {...options, nativeSupervisor, backendKind:'occt8',
    requestKind:'cut-chain', workerExecutable:resolve(workerExecutable),
    part21StepAudit:false, crossVersionStepAudit:false});
}

// Additive mixed-profile C++ operation: round/rectangular blind and through
// pockets remain experimental until the exact C++ binary and STEP are tested.
export async function runPinnedOcct8MixedCutChain(requestInput, {
  workerExecutable, nativeSupervisor = DEFAULT_OCCT8_SUPERVISOR, ...options
} = {}) {
  if (typeof workerExecutable !== 'string' || !workerExecutable.trim())
    throw new KernelContractError('pinned C++ workerExecutable path is required');
  return runLocalPlate(requestInput, {...options, nativeSupervisor, backendKind:'occt8',
    requestKind:'mixed-cut-chain', workerExecutable:resolve(workerExecutable),
    part21StepAudit:false, crossVersionStepAudit:false});
}

// Versioned solved L-profile native B-rep extrusion with selected body and
// explicitly ordered blind/through cuts. Never silently falls back to preview.
export async function runPinnedOcct8LProfileChain(requestInput, {
  workerExecutable, nativeSupervisor = DEFAULT_OCCT8_SUPERVISOR, ...options
} = {}) {
  if (typeof workerExecutable !== 'string' || !workerExecutable.trim())
    throw new KernelContractError('pinned C++ workerExecutable path is required');
  return runLocalPlate(requestInput, {...options, nativeSupervisor, backendKind:'occt8',
    requestKind:'l-profile-chain', workerExecutable:resolve(workerExecutable),
    part21StepAudit:false, crossVersionStepAudit:false});
}

async function runLocalPlate(requestInput, {
  readCurrentRevision,
  pythonExecutable = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
  nativeSupervisor = DEFAULT_SUPERVISOR,
  stepOutput,
  timeoutMs = 25000,
  signal,
  backendKind = 'ocp',
  requestKind = 'plate',
  workerExecutable,
  part21StepAudit = true,
  crossVersionStepAudit = false,
} = {}) {
  const request = requestKind === 'cut-chain' ?
    parseOcct8CutRequest(requestInput) :
    requestKind === 'mixed-cut-chain' ?
      parseOcct8MixedCutRequest(requestInput) :
    requestKind === 'l-profile-chain' ?
      parseOcct8LProfileRequest(requestInput) : parsePlateRequest(requestInput);
  if (typeof readCurrentRevision !== 'function')
    throw new KernelContractError('readCurrentRevision callback is mandatory');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000)
    throw new KernelContractError('timeoutMs must be an integer in [100, 600000]');
  if (typeof pythonExecutable !== 'string' || !pythonExecutable ||
      typeof nativeSupervisor !== 'string' || !nativeSupervisor)
    throw new KernelContractError('local Python executable and supervisor path are required');
  if (request.exportStep ? (typeof stepOutput !== 'string' || !stepOutput.trim()) : stepOutput !== undefined)
    throw new KernelContractError('stepOutput is mandatory for STEP export and forbidden otherwise');
  if (revisionOf(readCurrentRevision) !== request.revision)
    return unresolved(request, 'stale_revision');
  if (signal?.aborted) return unresolved(request, 'cancelled');

  // Never pass the eventual user destination to Python: abort/stale results cannot
  // leak a native file into that path before the JS caller admits the response.
  const folder = await fs.mkdtemp(join(tmpdir(), 'intuit3d-local-plate-'));
  const privateStep = join(folder, 'plate.step');
  let child;
  let killTimer;
  let watchdog;
  let aborted = false;
  let timedOut = false;
  let oversized = false;
  let closed = false;
  const stop = () => {
    if (!child || closed || child.pid === undefined) return;
    try {
      if (process.platform === 'win32') child.kill('SIGINT');
      else process.kill(-child.pid, 'SIGINT');
    } catch { /* Already exited. */ }
    // SIGINT lets Python unwind the worker's subprocess-supervision finally.
    // Escalation prevents an indefinitely hung parent, but Windows tree
    // cleanup is not qualified as a full native containment guarantee.
    killTimer ??= setTimeout(() => {
      if (closed) return;
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* Already exited. */ }
    }, 2500);
    killTimer.unref();
  };
  const onAbort = () => { aborted = true; stop(); };
  try {
    const args = backendKind === 'occt8'
      ? [nativeSupervisor, '--worker', workerExecutable, '--timeout', String(timeoutMs / 1000)]
      : [nativeSupervisor, '--timeout-seconds', String(timeoutMs / 1000)];
    if (request.exportStep) {
      args.push('--step-output', privateStep);
      if (backendKind === 'occt8' && part21StepAudit)
        args.push('--part21-step-audit');
      if (backendKind === 'occt8' && crossVersionStepAudit)
        args.push('--cross-version-step-audit');
    }
    const result = await new Promise((finish) => {
      let stdoutBytes = 0;
      const chunks = [];
      let spawnError = null;
      try {
        child = spawn(pythonExecutable, args, {
          detached: process.platform !== 'win32',
          stdio: ['pipe','pipe','pipe'], windowsHide:true,
        });
      } catch (error) {
        finish({spawnError:error, code:null, output:''});
        return;
      }
      child.on('error', error => { spawnError = error; });
      child.stdin.on('error', () => { /* Early exit will be rejected at close. */ });
      child.stdout.on('data', chunk => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_REPLY_BYTES) { oversized = true; stop(); }
        else chunks.push(chunk);
      });
      child.stderr.on('data', () => { /* discard; no unbounded log buffering */ });
      child.on('close', code => {
        closed = true;
        finish({code, spawnError, output:Buffer.concat(chunks).toString('utf8')});
      });
      signal?.addEventListener('abort', onAbort, {once:true});
      if (signal?.aborted) onAbort();
      watchdog = setTimeout(() => { timedOut = true; stop(); }, timeoutMs + 3000);
      try { child.stdin.end(JSON.stringify(request)); }
      catch { stop(); }
    });
    if (aborted || signal?.aborted) return unresolved(request, 'cancelled');
    if (timedOut) return unresolved(request, 'timeout');
    if (result.spawnError) return unresolved(request, 'worker_crash');
    if (oversized) return unresolved(request, 'requires_reconciliation');
    let raw;
    try { raw = JSON.parse(result.output); }
    catch { return unresolved(request, 'requires_reconciliation'); }
    if (raw?.status === 'validated_exact' && result.code !== 0)
      return unresolved(request, 'worker_crash');
    if (raw?.status !== 'validated_exact' && result.code === 0)
      return unresolved(request, 'requires_reconciliation');
    let assessment;
    try {
      assessment = (requestKind === 'cut-chain' ? assessOcct8CutResponse :
        requestKind === 'mixed-cut-chain' ? assessOcct8MixedCutResponse :
        requestKind === 'l-profile-chain' ? assessOcct8LProfileResponse :
        backendKind === 'occt8' ? assessOcct8PlateResponse : assessPlateResponse)(
        request, raw, {currentRevision:revisionOf(readCurrentRevision)});
      if (backendKind === 'occt8' && assessment.kind === 'experimental_report' &&
          request.exportStep &&
          (raw.stepVerification !== (crossVersionStepAudit
            ? 'occt-7.9.3.1-separate-process' : 'occt-8.0.1-same-engine') ||
           (part21StepAudit && raw.part21Audit?.kind !== 'part21-plate-structural-v1')))
        throw new KernelContractError('requested OCCT8 STEP verification evidence absent');
    } catch { return unresolved(request, 'requires_reconciliation'); }
    if (assessment.kind !== 'experimental_report')
      return {...assessment, artifact:null};
    const observed = {source:structuredClone(raw.source),
      stepReadback:raw.stepReadback === null ? null : structuredClone(raw.stepReadback)};
    if (!request.exportStep) return {...assessment, observed, artifact:null};
    if (resolve(raw.stepPath || '') !== resolve(privateStep))
      return unresolved(request, 'requires_reconciliation', 'native_step_path_mismatch');

    // Copy authenticated same-engine artifact into same-filesystem staging,
    // then exclusively hard-link it into its requested final destination.
    // Existing user exports are never overwritten or partially published.
    let stage;
    let publishOperation = 'begin';
    const destination = resolve(stepOutput);
    try {
      publishOperation = 'inspect-private-step';
      const stat = await fs.stat(privateStep);
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_STEP_BYTES)
        return unresolved(request, 'requires_reconciliation', 'missing_or_oversized_step');
      publishOperation = 'read-private-step';
      const bytes = await fs.readFile(privateStep);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      // The C++ bridge reports the digest of its independently checked staged
      // bytes. Refuse a substituted transport artifact before any publication.
      if (backendKind === 'occt8' && raw.stepSha256 !== sha256)
        return unresolved(request, 'requires_reconciliation', 'native_step_digest_mismatch');
      publishOperation = 'mkdir-output-parent';
      await fs.mkdir(dirname(destination), {recursive:true});
      stage = join(dirname(destination), `.intuit3d-${randomUUID()}.tmp`);
      publishOperation = 'write-stage';
      await fs.writeFile(stage, bytes, {flag:'wx',mode:0o600});
      publishOperation = 'read-stage';
      const staged = await fs.readFile(stage);
      if (createHash('sha256').update(staged).digest('hex') !== sha256)
        return unresolved(request, 'requires_reconciliation');
      publishOperation = 'sync-stage';
      // Windows FlushFileBuffers requires a writable handle; 'r' fsync => EPERM.
      const handle = await fs.open(stage, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      if (signal?.aborted) return unresolved(request, 'cancelled');
      if (revisionOf(readCurrentRevision) !== request.revision)
        return unresolved(request, 'stale_revision');
      publishOperation = 'link-stage';
      await fs.link(stage, destination);
      if (signal?.aborted || revisionOf(readCurrentRevision) !== request.revision) {
        publishOperation = 'rollback-stale-export';
        await fs.unlink(destination);
        return unresolved(request, signal?.aborted ? 'cancelled' : 'stale_revision');
      }
      return {...assessment, observed, artifact:{
        path:destination, bytes:bytes.length, sha256,
        verification:backendKind === 'occt8' ?
          (part21StepAudit ? 'occt8_part21_plate_subset' : 'occt8_same_engine_step_readback') :
          'same_engine_step_readback',
      }};
    } catch (error) {
      return unresolved(request, 'requires_reconciliation', 'publication_' + publishOperation + '_' + (error?.code || error?.name || 'unknown'));
    } finally {
      if (stage) await fs.rm(stage, {force:true});
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (watchdog) clearTimeout(watchdog);
    if (killTimer) clearTimeout(killTimer);
    await fs.rm(folder, {recursive:true,force:true});
  }
}
