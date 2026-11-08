/** Type-only browser consumer of the real public RUNTIME/INTENT package boundary. */
import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime} from '../index.mjs';
import {createLivePlateSession,type LivePlateSessionState,type LiveCadBatch} from '../live-plate-session.mjs';
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
    deadlineMs:30000,requiredBackend:'OCCT-cxx-8.0.1',
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

/** Browser consumer can stage multiple typed operations with one source fence
 * and one durable write; each inner command has no per-operation revision. */
const profileLayoutView=session.inspectSelectedProfileHoleLayout({
  projectId:state.projectId,expectedRevision:state.revision,
  sketchFeatureId:'sketch.plate',
});
if(profileLayoutView.kind==='ready') {
  const analyticOnly:false=profileLayoutView.exactAuthority;
  void analyticOnly;
}
const atomicProfileLayout=session.applyCommand({
  kind:'sketch.holes.selected-profile-layout',
  projectId:state.projectId,expectedRevision:state.revision,
  request:{sketchFeatureId:'sketch.plate',eventId:'type.session.profile.layout',
    selection:{candidateId:'cycle:example',sourceSignature:'snapshot'},
    command:{kind:'set-hole-layout',sourceSignature:'snapshot',
      edits:[{holeId:'holeA',xMm:20,yMm:20,radiusMm:4}]}}
});
void atomicProfileLayout;
const edgeCommand=session.applyCommand({
  kind:'sketch.holes.selected-edge',projectId:state.projectId,
  expectedRevision:state.revision,request:{
    sketchFeatureId:'sketch.plate',eventId:'type.session.edge',
    selection:{candidateId:'contour',sourceSignature:'snapshot'},
    command:{kind:'set-edge-holes',sourceSignature:'snapshot',
      edits:[{holeId:'new-hole',edgeId:'edge0',alongMm:10,insetMm:5,radiusMm:2}]},
  },
});
void edgeCommand;
const profileHoleCommand=session.applyCommand({
  kind:'sketch.holes.selected-profile',projectId:state.projectId,
  expectedRevision:state.revision,request:{
    sketchFeatureId:'sketch.plate',eventId:'type.session.profile.hole',
    selection:{candidateId:'contour',sourceSignature:'snapshot'},
    command:{kind:'add-hole',sourceSignature:'snapshot',
      holeId:'mount:profile',anchorPointId:'corner-a',xMm:60,yMm:20,radiusMm:3},
  },
});
void profileHoleCommand;
const grouped:LiveCadBatch={
  kind:'commands.batch',projectId:state.projectId,
  expectedRevision:state.revision,commands:[
    {kind:'model.events',events:[{eventId:'type.batch.thickness',
      type:'feature.edit',featureId:'plate',
      patch:{payload:{sourceSketchId:'sketch.plate',thicknessMm:12}}}]},
    {kind:'sketch.holes',request:{
      sketchFeatureId:'sketch.plate',eventId:'type.batch.hole',
      operations:[{kind:'add',id:'typeHole',x:60,y:20,radius:4}],
    }},
  ],
};
const batchCommitted=session.applyCommands(grouped);
if(batchCommitted.kind==='committed') {
  const report:number=batchCommitted.report.revision;
  void report;
}
const submitBatch=session.applyCommandsAndEvaluate(grouped,{
  url:'http://127.0.0.1:3000',token:'0'.repeat(64),
  requiredBackend:'OCCT-cxx-8.0.1',exportStep:true,
});
void submitBatch;

const selectedProfileControls=session.inspectSelectedProfileHoles({
  projectId:state.projectId,expectedRevision:state.revision,
  sketchFeatureId:'sketch.plate'
});
if(selectedProfileControls.kind==='ready') {
  const noPhysical:false=selectedProfileControls.exactAuthority;
  const selected:string=selectedProfileControls.inspection.selection.candidateId;
  const source:string=selectedProfileControls.inspection.selection.sourceSignature;
  const anchor:string|undefined=selectedProfileControls.inspection.anchors[0]?.pointId;
  void [noPhysical,selected,source,anchor];
}else{
  const stale:boolean=selectedProfileControls.notCommitted;
  void stale;
}


/** A typed WORKBENCH can inspect the current edge-control geometry without
 * duplicating SKETCH state or treating the analytic result as exact. */
const selectedEdgeControls=session.inspectSelectedEdgeHoles({
  projectId:state.projectId,expectedRevision:state.revision,
  sketchFeatureId:'sketch.plate',
});
if(selectedEdgeControls.kind==='ready'){
  const analytic:false=selectedEdgeControls.exactAuthority;
  const signature:string=selectedEdgeControls.inspection.sourceSignature;
  const candidate:string=selectedEdgeControls.inspection.selection.candidateId;
  const editable:boolean|undefined=selectedEdgeControls.inspection.edges[0]?.editable;
  const along:number|undefined=selectedEdgeControls.inspection.holes[0]?.edgeBinding?.alongMm;
  void [analytic,signature,candidate,editable,along];
}else{
  const rejected:true=selectedEdgeControls.notCommitted;
  void rejected;
}
