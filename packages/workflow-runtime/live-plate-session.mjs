/**
 * Browser-safe live CAD session for the accepted INTENT journal + local native
 * bridge. The caller's read/write pair remains the ONE authoritative history;
 * this coordinator stores no second document, sketch, solver or B-rep.
 *
 * Native artifacts are usable only while their EXACT serialized archive remains
 * current. Cancelling and superseding also fences non-cooperative old providers.
 */
import {evaluateLocalPlate} from './local-plate-client.mjs';

export const LIVE_PLATE_SESSION_FORMAT='intuit3d.live-plate-session';
export const LIVE_PLATE_SESSION_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const refuse=(code,reason)=>({kind:'unresolved',code,reason,artifact:null,
  exactAuthority:false,independentInteroperability:false});

export function createLivePlateSession({
  runtime,readCurrentHistory,publishHistory,cutFeatureId='cut',
  evaluateImpl=evaluateLocalPlate,busyRetries=3,
}={}) {
  if (typeof runtime?.save!=='function'||typeof runtime?.reopen!=='function'||
      typeof runtime?.inspect!=='function'||typeof runtime?.diff!=='function'||
      typeof readCurrentHistory!=='function'||typeof publishHistory!=='function'||
      typeof evaluateImpl!=='function'||!ID.test(cutFeatureId)||
      !Number.isSafeInteger(busyRetries)||busyRetries<0||busyRetries>5)
    throw new TypeError('live plate session requires a real runtime, synchronous authoritative history reader/writer, cut ID and bounded native adapter');

  function snapshot(history=readCurrentHistory()) {
    const archive=runtime.save(history);
    const report=runtime.inspect(history);
    if (report.projectId!==history?.document?.projectId||
        report.revision!==history?.document?.revision||
        !Number.isSafeInteger(report.revision)||report.revision<0)
      throw new Error('live plate session: authoritative report/history fence mismatch');
    return {history,archive,report};
  }
  let observed=snapshot().archive;
  let serial=0,controller=null,latest=null,latestArchive=null,lastOutcomeKind=null;
  // Previews are ephemeral proposals, never a second durable model or native receipt.
  const editPreviews=new WeakMap();
  let activePreview=null;
  // Only the latest sampled pointer pose can become an authoritative edit.
  function retirePreview() {
    if(activePreview) editPreviews.delete(activePreview);
    activePreview=null;
  }
  function discard({preserveCurrentStep=false}={}) {
    // A fresh native attempt or explicit cancellation does not revoke a
    // *previously verified*, still-current STEP. An actual model edit/reopen
    // always calls discard() without this option and invalidates the receipt.
    const retain=preserveCurrentStep &&
      latest?.kind==='experimental_plate_evaluated' && !!latest.step &&
      latestArchive===observed;
    serial++;
    controller?.abort();
    controller=null;
    if(!retain) {
      latest=null;
      latestArchive=null;
    }
    lastOutcomeKind=null;
  }
  function synchronize() {
    const current=snapshot();
    if (current.archive!==observed) {
      observed=current.archive;
      discard();
    }
    return current;
  }
  function publish(next,expectedArchive) {
    retirePreview();
    discard();
    publishHistory(next);
    const actual=synchronize();
    if (actual.archive!==expectedArchive)
      throw new Error('live plate session: publishHistory must update readCurrentHistory synchronously');
    return actual;
  }

  /** Compute candidate through accepted INTENT/SKETCH without publishing or evaluating native. */
  function prepareEdit(edit) {
    if(typeof edit!=='function') throw new TypeError('live plate session: edit callback required');
    const before=synchronize();
    const outcome=edit(before.history);
    if(outcome && typeof outcome.then==='function')
      throw new TypeError('live plate session: edits must be synchronous INTENT transactions');
    if(outcome?.kind==='refused') return outcome;
    const next=outcome?.kind==='committed'?outcome.history:outcome;
    const after=snapshot(next);
    if(after.report.projectId!==before.report.projectId||
        after.report.revision<=before.report.revision)
      throw new Error('live plate session: edit must advance the same authoritative project revision');
    if(snapshot().archive!==before.archive)
      throw new Error('live plate session: concurrent authoritative edit, retry from current revision');
    const invalidation=runtime.diff(before.history,next);
    if(invalidation.projectId!==before.report.projectId||
        invalidation.previousRevision!==before.report.revision||
        invalidation.revision!==after.report.revision||
        invalidation.exactReuseAllowed!==false)
      throw new Error('live plate session: invalid model dependency fence');
    return {kind:'candidate',before,after,next,invalidation};
  }
  function publishCandidate(candidate) {
    publish(candidate.next,candidate.after.archive);
    return {kind:'committed',history:candidate.next,report:candidate.after.report,
      invalidation:candidate.invalidation};
  }
  const session = {
    /** Call after external model changes; refuses to retain stale native bytes. */
    refresh() {
      const state=synchronize();
      return {format:LIVE_PLATE_SESSION_FORMAT,version:LIVE_PLATE_SESSION_VERSION,
        projectId:state.report.projectId,revision:state.report.revision,
        inFlight:controller!==null,hasVerifiedStep:!!latest?.step,
        hasActivePreview:activePreview!==null && editPreviews.has(activePreview),
        lastResultKind:lastOutcomeKind,exactAuthority:false};
    },
    /** Delegate a genuine INTENT command; commit only if revision/project fences hold. */
    applyEdit(edit) {
      const candidate=prepareEdit(edit);
      return candidate.kind==='refused'?candidate:publishCandidate(candidate);
    },
    /**
     * Solver-backed drag/edit preview without changing the authoritative
     * history, native job, previous STEP receipt, or undo stack.
     * The opaque proposal can be committed once, only if its exact source
     * archive is still current; it cannot be forged from a browser object.
     */
    previewEdit(edit) {
      // A refused latest pointer position also revokes a previously valid pose.
      retirePreview();
      const candidate=prepareEdit(edit);
      if(candidate.kind==='refused') return candidate;
      const proposal=Object.freeze({
        kind:'preview',projectId:candidate.before.report.projectId,
        sourceRevision:candidate.before.report.revision,
        candidateRevision:candidate.after.report.revision,
        report:structuredClone(candidate.after.report),
        invalidation:structuredClone(candidate.invalidation),
        exactAuthority:false,nativeEvaluation:null,
      });
      editPreviews.set(proposal,{
        sourceArchive:candidate.before.archive,
        candidateArchive:candidate.after.archive,
        next:candidate.next,
      });
      activePreview=proposal;
      return proposal;
    },
    /** Pointercancel/Escape: discard only this current active proposal. */
    cancelPreview(proposal) {
      if(!proposal || proposal!==activePreview || !editPreviews.has(proposal))
        return {kind:'refused',code:'invalid_preview',
          reason:'preview is unknown, superseded or already consumed',
          notCommitted:true};
      retirePreview();
      return {kind:'discarded',notCommitted:true,exactAuthority:false};
    },
    /**
     * Promote a solver-backed preview with a strict archive identity fence.
     * Never rely on mutable display objects as authority; the proposed
     * candidate history is held only in this session's private WeakMap.
     */
    commitPreview(proposal) {
      const stored=proposal&&typeof proposal==='object'?editPreviews.get(proposal):null;
      if(!stored || proposal!==activePreview) return {kind:'refused',
        code:'invalid_preview',
        reason:'preview is unknown, superseded, cancelled or already committed',
        notCommitted:true};
      const before=synchronize();
      if(before.archive!==stored.sourceArchive) {
        retirePreview();
        return {kind:'refused',code:'stale_preview',
          reason:'authoritative project changed since preview',notCommitted:true};
      }
      const after=snapshot(stored.next);
      if(after.archive!==stored.candidateArchive)
        throw new Error('live plate session: preview candidate archive changed');
      const invalidation=runtime.diff(before.history,stored.next);
      if(after.report.projectId!==before.report.projectId||
          after.report.revision<=before.report.revision||
          invalidation.projectId!==before.report.projectId||
          invalidation.previousRevision!==before.report.revision||
          invalidation.revision!==after.report.revision||
          invalidation.exactReuseAllowed!==false)
        throw new Error('live plate session: preview model dependency fence mismatch');
      // Prevent double-submit. An invalid or stale proposal never dispatches native.
      retirePreview();
      return publishCandidate({next:stored.next,after,invalidation});
    },
    /** Publish a live model-backed preview, then rebuild exactly that revision. */
    async commitPreviewAndEvaluate(proposal,options={}) {
      const edit=session.commitPreview(proposal);
      if(edit.kind==='refused') return {kind:'refused',edit,evaluation:null};
      const evaluation=await session.evaluate(options);
      return {kind:'submitted',edit,evaluation};
    },
    /** Explicit opt-in required to replace a different authoritative archive. */
    reopen(serialized,{confirmReplacement=false}={}) {
      if(typeof serialized!=='string') throw new TypeError('live plate session: archive string required');
      const before=synchronize();
      const after=snapshot(runtime.reopen(serialized));
      if(after.archive!==serialized)
        throw new Error('live plate session: noncanonical archive refused');
      if(after.archive!==before.archive&&!confirmReplacement)
        return {kind:'refused',reason:'replacing the current project requires confirmation',notCommitted:true};
      if(after.archive!==before.archive) publish(after.history,after.archive);
      return {kind:'opened',history:after.history,report:after.report,
        exactReuseAllowed:false};
    },
    save() {return synchronize().archive;},
    cancel() {synchronize();retirePreview();discard({preserveCurrentStep:true});},
    /** A download button must obtain bytes through this synchronously, at use time. */
    currentStep() {
      const current=synchronize();
      if(!latest || latestArchive!==current.archive || latest.kind!=='experimental_plate_evaluated')
        return null;
      // Return independent bytes per download. A transferred/detached or
      // accidentally edited UI buffer cannot corrupt the retained receipt.
      return latest.step?{
        ...latest.step,bytes:Uint8Array.from(latest.step.bytes),
      }:null;
    },
    /** Latest request wins, even if a cancelled provider ignores AbortSignal. */
    async evaluate({url,token,requestId,exportStep=true,signal,fetchImpl,
      deadlineMs=30000,requiredBackend}={}) {
      // A hung HTTP fetch or non-cooperative native adapter must not leave
      // WORKBENCH awaiting a promise indefinitely. The deadline covers busy
      // retries and their backoff, not just one provider attempt.
      if(!Number.isSafeInteger(deadlineMs)||deadlineMs<25||deadlineMs>120000)
        throw new RangeError('live plate session: deadlineMs must be an integer from 25 to 120000');
      const before=synchronize();
      discard({preserveCurrentStep:true});
      const operation=serial;
      const abort=new AbortController();
      controller=abort;
      const id=requestId??('session.'+operation);
      if(!ID.test(id)) {discard({preserveCurrentStep:true});throw new TypeError('live plate session: invalid request identity');}
      const onAbort=()=>abort.abort();
      if(signal?.aborted) abort.abort();
      signal?.addEventListener('abort',onAbort,{once:true});
      let timer,stopListener;
      // This settles independently of evaluateImpl/fetch honouring AbortSignal.
      // Late responses remain fenced by the worker's serial/archive/abort guards.
      const lifecycle=new Promise(resolve=>{
        stopListener=()=>resolve('aborted');
        abort.signal.addEventListener('abort',stopListener,{once:true});
        timer=setTimeout(()=>{resolve('timeout');abort.abort();},deadlineMs);
        if(abort.signal.aborted) resolve('aborted');
      });
      const run=async()=>{
        let result;
        for(let attempt=0;attempt<=busyRetries;attempt++) {
          if(abort.signal.aborted) return refuse('cancelled','native evaluation cancelled');
          if(synchronize().archive!==before.archive||serial!==operation)
            return refuse('stale_revision','a newer edit or request superseded native evaluation');
          try {
            result=await evaluateImpl({url,token,runtime,readCurrentHistory,
              cutFeatureId,requestId:id,exportStep,signal:abort.signal,
              ...(requiredBackend?{requiredBackend}:{}),
              ...(fetchImpl?{fetchImpl}:{}),});
          } catch(error) {
            result=refuse('provider_failure',error instanceof Error?error.message:'native adapter failed');
          }
          if(result?.kind!=='unresolved'||result.code!=='busy'||attempt===busyRetries)
            break;
          await new Promise(resolve=>setTimeout(resolve,50*(2**attempt)));
        }
        if(synchronize().archive!==before.archive||serial!==operation)
          return refuse('stale_revision','a newer edit or request superseded native evaluation');
        if(abort.signal.aborted) return refuse('cancelled','native evaluation cancelled');
        if(!result||!['unresolved','experimental_plate_evaluated'].includes(result.kind)||
            result.exactAuthority!==false||result.independentInteroperability!==false)
          return refuse('invalid_provider_result','native response is not a qualified experimental contract');
        if(result.kind==='experimental_plate_evaluated' &&
            (result.source?.projectId!==before.report.projectId||
             result.source.revision!==before.report.revision||
             result.result?.requestId!==id||result.result?.cutFeatureId!==cutFeatureId||
             (exportStep&&!result.step)||(!exportStep&&result.step)))
          return refuse('invalid_provider_result','native result does not match current authored request');
        // A failed same-revision refresh must not erase verified current bytes.
        lastOutcomeKind=result.kind;
        if(result.kind==='experimental_plate_evaluated' && result.step ||
           !latest || latestArchive!==before.archive) {
          // The public evaluation result belongs to the caller. Never cache
          // its mutable Uint8Array for later downloads: a consumer may reuse,
          // transfer or overwrite those bytes after the promise resolves.
          latest=result.step?{
            ...result,step:{...result.step,bytes:Uint8Array.from(result.step.bytes)},
          }:result;
          latestArchive=before.archive;
        }
        return result;
      };
      try {
        const settled=await Promise.race([run(),lifecycle]);
        if(settled==='timeout') {
          if(serial===operation&&synchronize().archive===before.archive)
            lastOutcomeKind='unresolved';
          return refuse('timeout','native evaluation exceeded '+deadlineMs+' ms deadline');
        }
        if(settled==='aborted') {
          if(serial!==operation||synchronize().archive!==before.archive)
            return refuse('stale_revision','a newer edit or request superseded native evaluation');
          lastOutcomeKind='unresolved';
          return refuse('cancelled','native evaluation cancelled');
        }
        return settled;
      } finally {
        clearTimeout(timer);
        abort.signal.removeEventListener('abort',stopListener);
        signal?.removeEventListener('abort',onAbort);
        if(controller===abort) controller=null;
      }
    },
    /**
     * One browser command: commit an authoritative revision then request its
     * experimental native evaluation. A refused SKETCH/INTENT edit sends no
     * native request and retains the last still-current STEP receipt.
     *
     * A committed edit always invalidates the previous receipt before
     * evaluation. The nested evaluation result (including stale_revision or
     * provider_failure) is authoritative about provider progress; returning
     * kind:'submitted' never asserts that a solid or STEP has been verified.
     * A competing newer edit is handled by evaluate()'s revision/serial fence.
     */
    async applyEditAndEvaluate(edit,options={}) {
      const outcome=session.applyEdit(edit);
      if(outcome.kind==='refused')
        return {kind:'refused',edit:outcome,evaluation:null};
      const evaluation=await session.evaluate(options);
      return {kind:'submitted',edit:outcome,evaluation};
    },
    /**
     * Reopen a saved project and request a fresh native STEP in ONE consumer
     * command. Replacing a different authoritative archive requires explicit
     * confirmation; refusal never dispatches a provider or changes the model.
     * STEP remains experimental, even after successful same-engine readback.
     */
    async reopenAndEvaluate(serialized,{confirmReplacement=false,...options}={}) {
      const reopened=session.reopen(serialized,{confirmReplacement});
      if(reopened.kind==='refused')
        return {kind:'refused',reopen:reopened,evaluation:null};
      const evaluation=await session.evaluate(options);
      return {kind:'submitted',reopen:reopened,evaluation};
    },
  };
  return Object.freeze(session);
}
