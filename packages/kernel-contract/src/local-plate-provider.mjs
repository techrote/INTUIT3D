// Node-only local process adapter for the experimental OCP plate worker.
// This is executable B-rep/STEP research evidence, not production exact authority.
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessPlateResponse, KernelContractError, parsePlateRequest} from './plate-v1.mjs';

const DEFAULT_SUPERVISOR = fileURLToPath(new URL('../../../native/run_plate.py', import.meta.url));
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
export async function runExperimentalPlate(requestInput, {
  readCurrentRevision,
  pythonExecutable = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
  nativeSupervisor = DEFAULT_SUPERVISOR,
  stepOutput,
  timeoutMs = 25000,
  signal,
} = {}) {
  const request = parsePlateRequest(requestInput);
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
    const args = [nativeSupervisor, '--timeout-seconds', String(timeoutMs / 1000)];
    if (request.exportStep) args.push('--step-output', privateStep);
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
      assessment = assessPlateResponse(request, raw, {
        currentRevision:revisionOf(readCurrentRevision),
      });
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
      const handle = await fs.open(stage, 'r');
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
        verification:'same_engine_step_readback',
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
