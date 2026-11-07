/**
 * Versioned model-owned plate/body/face reference inspection and recovery.
 * Deterministic topology reports are TEST FIXTURES, not OCCT observations.
 *
 * Run: node --experimental-strip-types packages/model/examples/selection-inventory.mjs
 */
import {newProject,commitEvent,featuresOf,planProject,serializeProject,
  deserializeProject} from '../src/index.ts';
import {startUndoHistory,undoTransaction,redoTransaction} from '../src/transactions.ts';
import {TOPOLOGY_REFERENCE_FORMAT} from '../src/topology.ts';
import {SEMANTIC_SELECTION_EDIT_FORMAT,SEMANTIC_SELECTION_RECOVERY_FORMAT,
  commitUndoableSemanticSelectionEdit,commitUndoableSemanticSelectionRecovery} from '../src/semantic-selection.ts';
import {SELECTION_EVIDENCE_FORMAT,inspectSelectionInventory} from '../src/selection-inventory.ts';
import {planIncrementalEvaluation} from '../src/incremental.ts';

const projectId='project.plate';
const face={featureId:'feature.extrude',roleId:'face.top',kind:'face'};
const body={featureId:'feature.extrude',roleId:'body.plate',kind:'body'};
const left={...face,roleId:'face.top.left'};
const right={...face,roleId:'face.top.right'};
const source=(anchor)=>({format:TOPOLOGY_REFERENCE_FORMAT,version:1,
  projectId,atRevision:2,anchor});
let doc=newProject(projectId);
for(const [eventId,feature] of [
  ['event.sketch',{id:'feature.sketch',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{widthMm:120,heightMm:80,holeCentersMm:[[-30,0],[30,0]]}}],
  ['event.extrude',{id:'feature.extrude',kind:'extrude',dependsOn:['feature.sketch'],
    writeTargets:['body.plate'],payload:{thicknessMm:8}}],
  ['event.cut',{id:'feature.cut',kind:'cut',dependsOn:['feature.extrude'],
    writeTargets:['body.plate'],payload:{holeRadiusMm:5}}],
  ['event.measure',{id:'feature.measure',kind:'measure',dependsOn:['feature.cut'],
    writeTargets:[],payload:{label:'volume'}}],
]) doc=commitEvent(doc,{eventId,type:'feature.create',feature});

let history=startUndoHistory(doc);
for(const [featureId,field,anchor,eventId] of [
  ['feature.cut','sourceFace',face,'event.select-face'],
  ['feature.measure','sourceBody',body,'event.select-body'],
]){
  history=commitUndoableSemanticSelectionEdit(history,{
    format:SEMANTIC_SELECTION_EDIT_FORMAT,version:1,eventId,featureId,field,
    reference:source(anchor),expectedRevision:history.document.revision,
    admission:'require_ready',
  });
}
const before=history.document;
history=startUndoHistory(commitEvent(before,{
  eventId:'event.thickness',type:'feature.edit',
  featureId:'feature.extrude',patch:{payload:{thicknessMm:12}},
}));
const current=history.document;
const receipt=(featureId,field,anchor,split)=>({
  format:SELECTION_EVIDENCE_FORMAT,version:1,projectId,revision:current.revision,
  featureId,field,provider:'deterministic_fixture',reference:source(anchor),
  snapshot:{projectId,atRevision:2,observedRoles:[anchor]},
  steps:Array.from({length:current.revision-2},(_,i)=>({
    projectId,fromRevision:i+2,toRevision:i+3,coverage:'complete',
    mappings:[{from:[anchor],to:split&&i===current.revision-3?[left,right]:[anchor],
      confidence:'observed'}],
  })),
});
const faceEvidence=receipt('feature.cut','sourceFace',face,true);
const preview=inspectSelectionInventory(current,[
  faceEvidence,receipt('feature.measure','sourceBody',body,false),
]);
if(preview.needsUserRecovery[0]!=='feature.cut.sourceFace' ||
   preview.selections[1].status!=='candidate') throw Error('split recovery was not exposed');
history=commitUndoableSemanticSelectionRecovery(history,{
  format:SEMANTIC_SELECTION_RECOVERY_FORMAT,version:1,eventId:'event.user-choose-right',
  featureId:'feature.cut',field:'sourceFace',expectedRevision:current.revision,
  snapshot:faceEvidence.snapshot,steps:faceEvidence.steps,selected:right,
  admission:'require_ready',
});
history=undoTransaction(history,['event.undo-face']);
history=redoTransaction(history,['event.redo-face']);
const reopened=deserializeProject(serializeProject(history.document));
const chosen=featuresOf(reopened).find(f=>f.id==='feature.cut').payload.sourceFace;
if(chosen.anchor.roleId!=='face.top.right') throw Error('semantic recovery lost after replay');
const unresolved=inspectSelectionInventory(reopened);
if(unresolved.selections.some(s=>s.status!=='pending_evidence'))
  throw Error('invented geometry evidence after reopening');
console.log(JSON.stringify({
  format:'intuit3d.semantic-selection-inventory-demo',version:1,
  revision:reopened.revision,thicknessMm:12,bodyId:'body.plate',
  changedBranch:planIncrementalEvaluation(before,current).readyToEvaluate,
  selectedFaceRoleId:chosen.anchor.roleId,
  repairCandidates:preview.selections[0].recoveryCandidates.map(c=>c.roleId),
  postReopenStatus:unresolved.selections.map(s=>s.status),
  executableOrder:planProject(reopened).executableOrder,
  exactGeometryAuthority:false,provider:'deterministic_fixture_only',
}));
