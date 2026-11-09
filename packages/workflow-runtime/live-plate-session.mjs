/**
 * Browser-safe live CAD session for the accepted INTENT journal + local native
 * bridge. The caller's read/write pair remains the ONE authoritative history;
 * this coordinator stores no second document, sketch, solver or B-rep.
 *
 * Native artifacts are usable only while their EXACT serialized archive remains
 * current. Cancelling and superseding also fences non-cooperative old providers.
 */
import {evaluateLocalPlate} from './local-plate-client.mjs';
import {ProjectFormatError, ProjectRevisionError, serializeProject} from '@intuit3d/model';
import {inspectFeatureRemoval as inspectModelRemoval, commitUndoableFeatureRemoval} from '@intuit3d/model/feature-lifecycle';
import {inspectFeatureRecoveryClosure as inspectModelRecovery, commitUndoableFeatureRecoveryClosure} from '@intuit3d/model/feature-recovery-closure';
import {rebaseParameterSheetEdit} from '@intuit3d/model/parameter-sheet-rebase';
import {resolveParameterSheetConflict} from '@intuit3d/model/parameter-sheet-resolution';
import {commitUndoableParameterFormulaTableEdit} from '@intuit3d/model/parameter-formula-table';

export const LIVE_PLATE_SESSION_FORMAT='intuit3d.live-plate-session';
export const LIVE_PLATE_SESSION_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const lifecycleRefused=(code,reason)=>({
  kind:'refused',code,reason,notCommitted:true,exactAuthority:false,
});
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
  let lastOutcomeCode=null,lastOutcomeReason=null,lastOutcomeProducedStep=false;
  // A bounded diagnostic for the current journal, not another native result
  // cache. It is invalidated alongside receipts on every authoritative edit.
  function recordOutcome(result) {
    lastOutcomeKind=result.kind;
    lastOutcomeProducedStep=result.kind==='experimental_plate_evaluated' && !!result.step;
    lastOutcomeCode=result.kind==='unresolved' && typeof result.code==='string'
      ? result.code : result.kind==='unresolved'?'requires_reconciliation':null;
    lastOutcomeReason=result.kind==='unresolved' && typeof result.reason==='string'
      ? result.reason : result.kind==='unresolved'?'native provider refused evaluation':null;
  }
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
    lastOutcomeCode=null;
    lastOutcomeReason=null;
    lastOutcomeProducedStep=false;
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
    // Do NOT revoke a verified still-current receipt before a synchronous
    // durable writer has accepted the new authoritative history. Storage
    // quota/disk failures can reject the edit without touching the journal.
    // This call must remain synchronous: synchronize() is the commit fence.
    publishHistory(next);
    // No await occurs between publication and the archive check. The changed
    // archive immediately aborts all older native jobs and revokes old STEP.
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
    // The successor profile is not independently selectable from a stale
    // preview. Return only the versioned contour receipt from the committed
    // SKETCH result, copied before the authoritative archive publication.
    const contourReceipt=outcome?.kind==='committed' &&
      typeof outcome.nextSketchSignature==='string' &&
      outcome.selection && outcome.exactAuthority===false
      ? Object.freeze({format:'intuit3d.runtime.contour-receipt',version:1,
          projectId:after.report.projectId,revision:after.report.revision,
          contourId:outcome.contourId,selection:structuredClone(outcome.selection),
          nextSketchSignature:outcome.nextSketchSignature,exactAuthority:false})
      : null;
    return {kind:'candidate',before,after,next,invalidation,contourReceipt};
  }
  function publishCandidate(candidate) {
    publish(candidate.next,candidate.after.archive);
    return {kind:'committed',history:candidate.next,report:candidate.after.report,
      invalidation:candidate.invalidation,...(candidate.contourReceipt?{contourReceipt:candidate.contourReceipt}:{})};
  }
  // Execute a command against an INTENT history candidate, never against a
  // cached preview or native B-rep. Also used by atomic multi-command staging.
  function executeCommand(history,command) {
      if(!command || typeof command!=='object' ||
          typeof command.projectId!=='string' || !command.projectId ||
          !Number.isSafeInteger(command.expectedRevision) ||
          command.expectedRevision<0 ||
          ![
            'model.events','model.undo','model.redo',
            'model.feature.remove','model.feature.recover-closure','dimensions.batch',
            'sketch.constraints','sketch.contour/v1','sketch.holes','sketch.holes.rectangular',
            'sketch.holes.circular','sketch.holes.transform',
            'sketch.holes.resize','sketch.holes.selected-edge',
             'sketch.holes.selected-profile','sketch.holes.selected-profile-layout',
          ].includes(command.kind))
        throw new TypeError('live plate session: unsupported or unversioned CAD command');
      const commandRefused=(source)=>({
        kind:'refused',code:'stale_command',notCommitted:true,
        reason:'command project/revision differs from authoritative CAD history',
        sourceProjectId:source.document.projectId,
        sourceRevision:source.document.revision,
      });
        // This guard runs inside the same synchronous edit/commit boundary.
        // A changed storage value is also refused by publishHistory.
        if(history.document.projectId!==command.projectId ||
            history.document.revision!==command.expectedRevision)
          return commandRefused(history);
        const revision=command.expectedRevision;
        if(command.kind==='model.events') {
          if(!Array.isArray(command.events)||command.events.length<1||command.events.length>64)
            throw new TypeError('live plate session: model.events requires 1–64 events');
          return runtime.commit(history,command.events,revision);
        }
        if(command.kind==='model.undo'||command.kind==='model.redo') {
          if(!Array.isArray(command.eventIds)||command.eventIds.length<1||
              command.eventIds.length>64||
              command.eventIds.some(id=>typeof id!=='string'||!ID.test(id)))
            throw new TypeError('live plate session: undo/redo requires 1–64 event IDs');
          return command.kind==='model.undo'
            ? runtime.undo(history,command.eventIds,revision)
            : runtime.redo(history,command.eventIds,revision);
        }
        if(!command.request||typeof command.request!=='object'||
            Array.isArray(command.request)||
            Object.hasOwn(command.request,'expectedRevision'))
          throw new TypeError('live plate session: command request must omit expectedRevision');
        const request={...command.request,expectedRevision:revision};
        switch(command.kind) {
          case 'model.feature.remove': {
            const {sourceDocumentFence,confirmedCascadeIds,...modelRequest}=request;
            if(typeof sourceDocumentFence!=='string' ||
                sourceDocumentFence!==serializeProject(history.document))
              return lifecycleRefused('stale_source',
                'feature removal was inspected against a different authoritative journal');
            try {
              // A project fence alone does not bind user consent to the actual
              // selected feature. A swapped feature ID could otherwise retire
              // a different (potentially larger) descendant closure.
              if(modelRequest.mode==='cascade_descendants') {
                const impact=inspectModelRemoval(history.document,modelRequest.featureId);
                if(!Array.isArray(confirmedCascadeIds) ||
                    confirmedCascadeIds.length!==impact.cascadeIds.length ||
                    confirmedCascadeIds.some((id,index)=>id!==impact.cascadeIds[index]))
                  return lifecycleRefused('unreviewed_impact',
                    'cascade target/descendants differ from the inspected removal impact');
              } else if(confirmedCascadeIds!==undefined) {
                return lifecycleRefused('unreviewed_impact',
                  'cascade target approval is only valid for cascade mode');
              }
              return commitUndoableFeatureRemoval(history,{
                ...modelRequest,expectedProjectId:command.projectId,
                expectedRevision:revision,
              });
            } catch(error) {
              if(error instanceof ProjectFormatError || error instanceof ProjectRevisionError)
                return lifecycleRefused('feature_removal_refused',error.message);
              throw error;
            }
          }
          case 'model.feature.recover-closure': {
            const {confirmedRequiredFeatureIds,...modelRequest}=request;
            if(typeof modelRequest.expectedDocumentFence!=='string' ||
                modelRequest.expectedDocumentFence!==serializeProject(history.document))
              return lifecycleRefused('stale_source',
                'feature recovery was inspected against a different authoritative journal');
            try {
              // Explicit ancestor acknowledgement must describe the *same*
              // selected tombstones and ordered closure that WORKBENCH showed.
              // MODEL still revalidates readiness, dependencies and event IDs.
              const inspection=inspectModelRecovery(history.document,{
                format:'intuit3d.feature-recovery-closure',version:1,
                expectedProjectId:command.projectId,expectedRevision:revision,
                expectedDocumentFence:modelRequest.expectedDocumentFence,
                selectedFeatureIds:modelRequest.selectedFeatureIds,
              });
              if(!Array.isArray(confirmedRequiredFeatureIds) ||
                  confirmedRequiredFeatureIds.length!==inspection.requiredFeatureIds.length ||
                  confirmedRequiredFeatureIds.some((id,index)=>id!==inspection.requiredFeatureIds[index]))
                return lifecycleRefused('unreviewed_impact',
                  'recovery selection/ancestors differ from the inspected restoration closure');
              return commitUndoableFeatureRecoveryClosure(history,{
                ...modelRequest,expectedProjectId:command.projectId,
                expectedRevision:revision,
              });
            } catch(error) {
              if(error instanceof ProjectFormatError || error instanceof ProjectRevisionError)
                return lifecycleRefused('feature_recovery_refused',error.message);
              throw error;
            }
          }
          case 'dimensions.batch': return runtime.editDimensions(history,request);
          case 'sketch.constraints': return runtime.editSketchConstraints(history,request);
          case 'sketch.contour/v1': return runtime.commitClosedContour(history,{...request,expectedProjectId:command.projectId});
          case 'sketch.holes': return runtime.editPlateHoles(history,request);
          case 'sketch.holes.rectangular': return runtime.patternPlateHoles(history,request);
          case 'sketch.holes.circular': return runtime.patternCircularHoles(history,request);
          case 'sketch.holes.transform': return runtime.transformPlateHoles(history,request);
          case 'sketch.holes.resize': return runtime.resizePlateHoleLayout(history,request);
          case 'sketch.holes.selected-edge': return runtime.editSelectedEdgeHoles(history,request);
           case 'sketch.holes.selected-profile': return runtime.editSelectedProfileHole(history,request);
          case 'sketch.holes.selected-profile-layout': return runtime.editSelectedProfileHoleLayout(history,request);
          default: throw new TypeError('live plate session: unsupported CAD command');
        }
  }

  const session = {
    /** Call after external model changes; refuses to retain stale native bytes. */
    refresh() {
      const state=synchronize();
      const inFlight=controller!==null,hasVerifiedStep=!!latest?.step;
      // Orthogonal provenance: a previous verified STEP can still match this
      // exact archive while the latest native attempt is pending or failed.
      // Neither state promotes experimental geometry to exact CAD authority.
      const sourceRefusals=['unsupported_feature','unsupported_profile',
        'source_unavailable','provider_mismatch','invalid_archive',
        'stale_revision'];
      const providerState=inFlight?'pending'
        :lastOutcomeKind==='unresolved'
          ? (lastOutcomeCode==='cancelled'?'cancelled'
            :sourceRefusals.includes(lastOutcomeCode)?'blocked':'provider_failed')
          :lastOutcomeKind==='experimental_plate_evaluated'?'evaluated':'idle';
      const stepAvailability=!hasVerifiedStep?'unavailable'
        :(inFlight||lastOutcomeKind==='unresolved'||
          (lastOutcomeKind==='experimental_plate_evaluated'&&!lastOutcomeProducedStep)
          ?'last_good':'current');
      return {format:LIVE_PLATE_SESSION_FORMAT,version:LIVE_PLATE_SESSION_VERSION,
        projectId:state.report.projectId,revision:state.report.revision,
        inFlight,hasVerifiedStep,providerState,stepAvailability,
        hasActivePreview:activePreview!==null && editPreviews.has(activePreview),
        lastResultKind:lastOutcomeKind,
        lastResultCode:lastOutcomeCode,lastResultReason:lastOutcomeReason,
        exactAuthority:false};
    },
    /**
     * Inspect removal impact against the one durable INTENT document. The
     * returned exact document fence MUST accompany a subsequently confirmed
     * model.feature.remove command, including after concurrent same-revision
     * journal divergence. No model mutation or native request occurs here.
     */
    inspectFeatureRemoval({projectId,expectedRevision,featureId}={}) {
      if(typeof projectId!=='string'||!projectId||
          !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
          typeof featureId!=='string'||!ID.test(featureId))
        throw new TypeError('live plate session: removal inspection requires project/revision and feature ID');
      const current=synchronize();
      if(projectId!==current.report.projectId||
          expectedRevision!==current.report.revision)
        return lifecycleRefused('stale_command','removal inspection is not for current project/revision');
      try {
        const impact=inspectModelRemoval(current.history.document,featureId);
        return {kind:'ready',projectId,sourceRevision:expectedRevision,
          sourceDocumentFence:serializeProject(current.history.document),
          impact,exactAuthority:false};
      } catch(error) {
        if(error instanceof ProjectFormatError || error instanceof ProjectRevisionError)
          return lifecycleRefused('feature_removal_refused',error.message);
        throw error;
      }
    },
    /**
     * Inspect the transitive set of tombstoned ancestors needed to recover a
     * selected feature. The source fence and semantic IDs come from MODEL,
     * not timeline indices, preview geometry, or a second document.
     */
    inspectFeatureRecovery({projectId,expectedRevision,selectedFeatureIds}={}) {
      if(typeof projectId!=='string'||!projectId||
          !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
          !Array.isArray(selectedFeatureIds))
        throw new TypeError('live plate session: recovery inspection requires project/revision and tombstone IDs');
      const current=synchronize();
      if(projectId!==current.report.projectId||
          expectedRevision!==current.report.revision)
        return lifecycleRefused('stale_command','recovery inspection is not for current project/revision');
      const sourceDocumentFence=serializeProject(current.history.document);
      try {
        const inspection=inspectModelRecovery(current.history.document,{
          format:'intuit3d.feature-recovery-closure',version:1,
          expectedProjectId:projectId,expectedRevision,
          expectedDocumentFence:sourceDocumentFence,selectedFeatureIds,
        });
        return {kind:'ready',projectId,sourceRevision:expectedRevision,
          sourceDocumentFence,inspection,exactAuthority:false};
      } catch(error) {
        if(error instanceof ProjectFormatError || error instanceof ProjectRevisionError)
          return lifecycleRefused('feature_recovery_refused',error.message);
        throw error;
      }
    },
    /** Current source-fenced edge-local controls, with no second journal. */
    inspectSelectedEdgeHoles(request) {
      const state=synchronize();
      if(typeof runtime.inspectSelectedEdgeHoles!=='function')
        throw new TypeError('live plate session: selected-edge inspection requires runtime provider');
      return runtime.inspectSelectedEdgeHoles(state.history,request);
    },
    /** Current source-fenced selected-profile inspector; never a second journal. */
    inspectSelectedProfileHoles(request) {
      const state=synchronize();
      if(typeof runtime.inspectSelectedProfileHoles!=='function')
        throw new TypeError('live plate session: selected-profile inspection requires runtime provider');
      return runtime.inspectSelectedProfileHoles(state.history,request);
    },
    /** Inspect simultaneous hole positions/radii from the actual saved sketch. */
    inspectSelectedProfileHoleLayout(request) {
      const state=synchronize();
      if(typeof runtime.inspectSelectedProfileHoleLayout!=='function')
        throw new TypeError('live plate session: profile hole layout inspection requires runtime provider');
      return runtime.inspectSelectedProfileHoleLayout(state.history,request);
    },
    /** Delegate a genuine INTENT command; commit only if revision/project fences hold. */
    applyEdit(edit) {
      const candidate=prepareEdit(edit);
      return candidate.kind==='refused'?candidate:publishCandidate(candidate);
    },
    /**
     * Versioned declarative edit for WORKBENCH. The existing INTENT history
     * and SKETCH solver are the only authorities; this is not a parallel model.
     * Each command is project/revision-fenced before invoking the real runtime.
     * A stale/rejected command sends no native request and leaves STEP intact.
     */
    applyCommand(command) {
      return session.applyEdit(history=>executeCommand(history,command));
    },
    /**
     * Apply 1–16 typed authoring commands to the same canonical INTENT journal
     * as ONE durable archive publication. Each intermediate result is a real
     * model/SKETCH transaction; no intermediate revision or native job escapes.
     * Any refused intermediate operation abandons ALL staged edits. Journal
     * undo semantics remain those of the individual INTENT transactions.
     */
    applyCommands(batch) {
      if(!batch || typeof batch!=='object' || batch.kind!=='commands.batch' ||
          typeof batch.projectId!=='string' || !batch.projectId ||
          !Number.isSafeInteger(batch.expectedRevision) || batch.expectedRevision<0 ||
          !Array.isArray(batch.commands) || batch.commands.length<1 ||
          batch.commands.length>16)
        throw new TypeError('live plate session: commands.batch requires a project/revision fence and 1–16 operations');
      return session.applyEdit(history=>{
        if(history.document.projectId!==batch.projectId ||
            history.document.revision!==batch.expectedRevision)
          return {kind:'refused',code:'stale_command',notCommitted:true,
            reason:'batch project/revision differs from authoritative CAD history',
            sourceProjectId:history.document.projectId,
            sourceRevision:history.document.revision};
        let working=history;
        for(let index=0;index<batch.commands.length;index++) {
          const operation=batch.commands[index];
          if(!operation || typeof operation!=='object' ||
              Array.isArray(operation) ||
              Object.hasOwn(operation,'projectId') ||
              Object.hasOwn(operation,'expectedRevision') ||
              Object.hasOwn(operation,'commands'))
            throw new TypeError('live plate session: batch operation must omit outer fences and nested batches');
          const outcome=executeCommand(working,{
            ...operation,projectId:batch.projectId,
            expectedRevision:working.document.revision,
          });
          if(outcome?.kind==='refused')
            return {...outcome,kind:'refused',notCommitted:true,commandIndex:index};
          const next=outcome?.kind==='committed'?outcome.history:outcome;
          if(!next?.document ||
              next.document.projectId!==batch.projectId ||
              !Number.isSafeInteger(next.document.revision) ||
              next.document.revision<=working.document.revision)
            throw new Error('live plate session: batch command did not advance authoritative model revision');
          // Deliberately run the real model/solver service per intermediate
          // history, rather than admitting a syntactically valid shadow model.
          const report=runtime.inspect(next);
          if(report.projectId!==batch.projectId ||
              report.revision!==next.document.revision)
            throw new Error('live plate session: batch intermediate report mismatch');
          working=next;
        }
        return working;
      });
    },
    /** One durable batch publication, followed by at most one native request. */
    async applyCommandsAndEvaluate(batch,options={}) {
      const edit=session.applyCommands(batch);
      if(edit.kind==='refused') return {kind:'refused',edit,evaluation:null};
      return {kind:'submitted',edit,evaluation:await session.evaluate(options)};
    },
    /** Commit a typed command then request physical evaluation of its revision. */
    async applyCommandAndEvaluate(command,options={}) {
      const edit=session.applyCommand(command);
      if(edit.kind==='refused') return {kind:'refused',edit,evaluation:null};
      const evaluation=await session.evaluate(options);
      return {kind:'submitted',edit,evaluation};
    },
    /**
     * Inspect an unsaved parameter-sheet draft against the CURRENT canonical
     * INTENT journal. The base is a saved authoritative archive, not a mutable
     * browser-side guess of the model revision. A conflicting draft is never
     * silently committed or silently discarded.
     */
    inspectParameterDraft({baseArchive,draft,resolution}={}) {
      if(typeof baseArchive!=='string')
        throw new TypeError('live plate session: parameter draft requires its original model archive');
      const current=synchronize();
      const base=runtime.reopen(baseArchive);
      if(runtime.save(base)!==baseArchive)
        throw new TypeError('live plate session: parameter draft base must be a canonical archive');
      return resolution
        ? resolveParameterSheetConflict(base.document,current.history.document,draft,resolution)
        : rebaseParameterSheetEdit(base.document,current.history.document,
            draft,current.report.revision);
    },
    /**
     * Accept a conflict-free draft, or a user-reviewed EXACT set of conflict
     * acknowledgements, as one undoable parameter-table transaction. The
     * accepted INTENT contract verifies journal ancestry, formula bindings,
     * event-ID collisions and scalar admission. This method rechecks all of
     * those inside the synchronous commit fence, then publishes ONE archive.
     * A refusal retains the caller's draft and any still-current STEP receipt.
     */
    applyParameterDraft({baseArchive,draft,resolution}={}) {
      if(typeof baseArchive!=='string')
        throw new TypeError('live plate session: parameter draft requires its original model archive');
      let review=null;
      const edit=session.applyEdit(history=>{
        const base=runtime.reopen(baseArchive);
        if(runtime.save(base)!==baseArchive)
          throw new TypeError('live plate session: parameter draft base must be a canonical archive');
        // An approval of an older conflict report cannot be carried to a
        // different document, even if the proposed formula text is unchanged.
        if(resolution &&
            (resolution.expectedProjectId!==history.document.projectId ||
             resolution.expectedCurrentRevision!==history.document.revision))
          return {kind:'refused',code:'stale_parameter_resolution',notCommitted:true,
            reason:'parameter conflict approval is not for the current authoritative revision',
            sourceRevision:history.document.revision};
        review=resolution
          ? resolveParameterSheetConflict(base.document,history.document,draft,resolution)
          : rebaseParameterSheetEdit(base.document,history.document,
              draft,history.document.revision);
        if(review.status!=='ready')
          return {kind:'refused',code:'parameter_sheet_conflict',notCommitted:true,
            reason:'draft requires explicit per-conflict review before publication',
            review,conflicts:review.conflicts};
        const request=review.resolvedRequest??review.rebasedRequest;
        if(!request)
          throw new Error('live plate session: ready parameter draft has no accepted request');
        return commitUndoableParameterFormulaTableEdit(history,request);
      });
      return edit.kind==='committed'?{...edit,parameterReview:review}:edit;
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
    /**
     * Single-click source-bound native STEP receipt. No second journal or
     * provider: the existing verified client result supplies the provenance.
     */
    currentStepReceipt({requiredBackend}={}) {
      if(requiredBackend!==undefined &&
          !['OCCT-cxx-8.0.1','OCP-python-prototype'].includes(requiredBackend))
        throw new TypeError('live plate session: unsupported receipt backend');
      const step=session.currentStep();
      if(!step) return null;
      const source=latest?.source, producer=latest?.result;
      const current=synchronize();
      // The source may change between currentStep() and this second journal
      // read (for example through another writer). Matching project/revision
      // alone does not establish the identity of the STEP-producing archive.
      // synchronize() discards the old receipt when that exact archive changes.
      if(latestArchive!==current.archive||!source||!producer||
          source.projectId!==current.report.projectId||
          source.revision!==current.report.revision||
          !/^[a-f0-9]{64}$/.test(source.archiveSha256||'')||
          !/^[a-f0-9]{64}$/.test(step.sha256||'')||
          !ID.test(producer.requestId||'')||
          producer.cutFeatureId!==cutFeatureId||
          (requiredBackend!==undefined&&producer.backend!==requiredBackend)||
          !((producer.backend==='OCCT-cxx-8.0.1'&&
             producer.occtVersion==='8.0.1'&&
             step.verification==='occt8_part21_plate_subset')||
            (producer.backend==='OCP-python-prototype'&&
             producer.occtVersion==='7.9.3.1'&&
             step.verification==='same_engine_step_readback'))||
          producer.artifact?.sha256!==step.sha256||
          producer.artifact?.verification!==step.verification)
        return null;
      return Object.freeze({
        format:'intuit3d.source-bound-step-receipt',version:1,
        source:Object.freeze({
          projectId:source.projectId,revision:source.revision,
          archiveSha256:source.archiveSha256,
        }),
        producer:Object.freeze({
          requestId:producer.requestId,cutFeatureId:cutFeatureId,
          backend:producer.backend,occtVersion:producer.occtVersion,
        }),
        step,exactAuthority:false,independentInteroperability:false,
      });
    },
    /**
     * Capture the exact canonical archive, pinned native provenance and verified
     * STEP bytes for an external CAD witness in ONE synchronous browser action.
     * Never sample the archive in an unrelated React render or after an await.
     * The receipt JSON deliberately excludes STEP bytes: independent STEP tools
     * consume those as the separate, unchanged binary payload. This captures
     * custody only; a real click, C++ source build and non-OCCT import still
     * require independent evidence.
     */
    captureCurrentStepEvidence({requiredBackend='OCCT-cxx-8.0.1'}={}) {
      const current=synchronize();
      const receipt=session.currentStepReceipt({requiredBackend});
      if(!receipt) return null;
      // Even a caller-supplied, non-deterministic history reader may not mix
      // this receipt with a different same-revision archive.
      const after=synchronize();
      if(after.archive!==current.archive||
          receipt.source.projectId!==current.report.projectId||
          receipt.source.revision!==current.report.revision)
        return null;
      const {filename,sha256,verification,bytes}=receipt.step;
      const metadata=Object.freeze({
        format:receipt.format,version:receipt.version,
        source:receipt.source,producer:receipt.producer,
        step:Object.freeze({filename,sha256,verification}),
        exactAuthority:false,independentInteroperability:false,
      });
      return Object.freeze({
        format:'intuit3d.current-step-evidence-capture',version:1,
        archive:current.archive,receipt:metadata,
        stepBytes:Uint8Array.from(bytes),
        exactAuthority:false,independentInteroperability:false,
      });
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
            result.exactAuthority!==false||result.independentInteroperability!==false) {
          const failure=refuse('invalid_provider_result','native response is not a qualified experimental contract');
          recordOutcome(failure);
          return failure;
        }
        if(result.kind==='experimental_plate_evaluated' &&
            (result.source?.projectId!==before.report.projectId||
             result.source.revision!==before.report.revision||
             result.result?.requestId!==id||result.result?.cutFeatureId!==cutFeatureId||
             (exportStep&&!result.step)||(!exportStep&&result.step))) {
          const failure=refuse('invalid_provider_result','native result does not match current authored request');
          recordOutcome(failure);
          return failure;
        }
        // A failed same-revision refresh must not erase verified current bytes.
        recordOutcome(result);
        if(result.kind==='experimental_plate_evaluated' && result.step ||
           !latest || latestArchive!==before.archive) {
          // The public evaluation result belongs to the caller. Never cache
          // its mutable Uint8Array for later downloads: a consumer may reuse,
          // transfer or overwrite those bytes after the promise resolves.
          latest=result.step?{
            ...result,
            source:{...result.source},
            result:structuredClone(result.result),
            step:{...result.step,bytes:Uint8Array.from(result.step.bytes)},
          }:result;
          latestArchive=before.archive;
        }
        return result;
      };
      try {
        const settled=await Promise.race([run(),lifecycle]);
        if(settled==='timeout') {
          const timeout=refuse('timeout','native evaluation exceeded '+deadlineMs+' ms deadline');
          if(serial===operation&&synchronize().archive===before.archive)
            recordOutcome(timeout);
          return timeout;
        }
        if(settled==='aborted') {
          if(serial!==operation||synchronize().archive!==before.archive)
            return refuse('stale_revision','a newer edit or request superseded native evaluation');
          const cancelled=refuse('cancelled','native evaluation cancelled');
          recordOutcome(cancelled);
          return cancelled;
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
