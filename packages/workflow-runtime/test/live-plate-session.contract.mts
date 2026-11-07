/** Type-only browser consumer of the real public RUNTIME/INTENT package boundary. */
import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime} from '../index.mjs';
import {createLivePlateSession,type LivePlateSessionState} from '../live-plate-session.mjs';
import type {VerifiedLocalStep,LocalPlateClientResult} from '../local-plate-client.mjs';

declare const runtime:WorkflowRuntime;
declare let current:UndoHistory;
const session=createLivePlateSession({runtime,readCurrentHistory:()=>current,
  publishHistory:history=>{current=history;},cutFeatureId:'cut'});

const state:LivePlateSessionState=session.refresh();
const currentRevision:number=state.revision;
const authority:false=state.exactAuthority;
const activeGesture:boolean=state.hasActivePreview;
const archive:string=session.save();
const restored=session.reopen(archive);
if(restored.kind==='opened') {
  const exactReuseAllowed:false=restored.exactReuseAllowed;
  void exactReuseAllowed;
}
const edit=session.applyEdit(h=>runtime.editPlateHoles(h,{
  sketchFeatureId:'sketch.plate',eventId:'session.contract.add.hole',
  expectedRevision:h.document.revision,admission:'require_admissible',
  operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}],
}));
if(edit.kind==='committed') {
  const invalidated:readonly string[]=edit.invalidation.invalidatedFeatureIds;
  const next:UndoHistory=edit.history;
  void [invalidated,next];
}
async function editAndDownloadInOneCommand() {
  const outcome=await session.applyEditAndEvaluate(h=>runtime.editPlateHoles(h,{
    sketchFeatureId:'sketch.plate',eventId:'session.contract.one.call',
    expectedRevision:h.document.revision,admission:'require_admissible',
    operations:[{kind:'add',id:'holeD',x:75,y:20,radius:4}],
  }),{url:'http://127.0.0.1:3000',token:'0'.repeat(64),exportStep:true});
  if(outcome.kind==='refused'){
    const noEvaluation:null=outcome.evaluation;
    const noCommit:undefined|boolean=outcome.edit.notCommitted;
    void [noEvaluation,noCommit];
  }else{
    const committed:UndoHistory=outcome.edit.history;
    const status:LocalPlateClientResult=outcome.evaluation;
    // The native outcome can still be unresolved: never assume exact STEP.
    void [committed,status];
  }
  return outcome;
}
async function browserDownload() {
  const result:LocalPlateClientResult=await session.evaluate({
    url:'http://127.0.0.1:3000',token:'0'.repeat(64),exportStep:true,
    deadlineMs:30000,
  });
  const step:VerifiedLocalStep|null=session.currentStep();
  if(result.kind==='experimental_plate_evaluated'&&step) {
    const bytes:Uint8Array=step.bytes;
    const verified:string=step.sha256;
    void [bytes,verified];
  }
  session.cancel();
  return result;
}
void [currentRevision,authority,activeGesture,browserDownload,editAndDownloadInOneCommand];

async function solverPreviewThenNative() {
  // WORKBENCH pointer move: solve/validate now; do not publish the document,
  // make an undo entry or ask the local native worker until pointer release.
  const proposal=session.previewEdit(h=>runtime.editPlateHoles(h,{
    sketchFeatureId:'sketch.plate',eventId:'session.contract.preview',
    expectedRevision:h.document.revision,admission:'require_admissible',
    operations:[{kind:'add',id:'previewHole',x:60,y:20,radius:4}],
  }));
  if(proposal.kind==='refused') return proposal;
  const noExact:false=proposal.exactAuthority;
  const noNative:null=proposal.nativeEvaluation;
  const sourceRevision:number=proposal.sourceRevision;
  const report=proposal.report;
  // Pointer release: a token is valid only for this session and this source archive.
  const committed=await session.commitPreviewAndEvaluate(proposal,{
    url:'http://127.0.0.1:3000',token:'0'.repeat(64),exportStep:true,
  });
  if(committed.kind==='submitted'){
    const result:LocalPlateClientResult=committed.evaluation;
    void result;
  }
  const cancelled=session.cancelPreview(proposal);
  if(cancelled.kind==='discarded') {
    const uncommitted:true=cancelled.notCommitted;
    void uncommitted;
  }
  void [noExact,noNative,sourceRevision,report];
  return committed;
}
void solverPreviewThenNative;
