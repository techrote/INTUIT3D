/**
 * Executable local semantic face-target lifecycle, NOT a geometry provider.
 * node --experimental-strip-types packages/model/examples/face-recovery.mjs
 */
import {
  newProject, commitEvent, featuresOf, serializeProject, deserializeProject, planProject,
} from '../src/index.ts';
import {startUndoHistory, undoTransaction, redoTransaction,
  serializeUndoHistory, deserializeUndoHistory} from '../src/transactions.ts';
import {TOPOLOGY_REFERENCE_FORMAT} from '../src/topology.ts';
import {
  SEMANTIC_SELECTION_EDIT_FORMAT, SEMANTIC_SELECTION_RECOVERY_FORMAT,
  commitUndoableSemanticSelectionEdit, commitUndoableSemanticSelectionRecovery,
  assessSemanticSelection,
} from '../src/semantic-selection.ts';

const original={featureId:'feature.plate',roleId:'face.top',kind:'face'};
const left={...original,roleId:'face.top.left'};
const right={...original,roleId:'face.top.right'};
let document=newProject('project.plate');
document=commitEvent(document,{eventId:'event.plate',type:'feature.create',feature:{
  id:'feature.plate',kind:'extrude',dependsOn:[],writeTargets:['body.plate'],
  payload:{widthMm:120,heightMm:80,thicknessMm:8},
}});
document=commitEvent(document,{eventId:'event.cut',type:'feature.create',feature:{
  id:'feature.cut',kind:'cut',dependsOn:['feature.plate'],writeTargets:['body.plate'],
  payload:{holeRadiusMm:5},
}});
let history=startUndoHistory(document);
history=commitUndoableSemanticSelectionEdit(history,{
  format:SEMANTIC_SELECTION_EDIT_FORMAT,version:1,eventId:'event.select',
  expectedRevision:history.document.revision,featureId:'feature.cut',
  field:'selectedFace',reference:{format:TOPOLOGY_REFERENCE_FORMAT,version:1,
    projectId:history.document.projectId,atRevision:1,anchor:original},
  admission:'require_ready',
});
const evidence={
  snapshot:{projectId:'project.plate',atRevision:1,observedRoles:[original]},
  steps:[
    {projectId:'project.plate',fromRevision:1,toRevision:2,coverage:'complete',
      mappings:[{from:[original],to:[original],confidence:'observed'}]},
    {projectId:'project.plate',fromRevision:2,toRevision:3,coverage:'complete',
      mappings:[{from:[original],to:[left,right],confidence:'observed'}]},
  ],
};
const ambiguity=assessSemanticSelection(history.document,'feature.cut','selectedFace',evidence);
if (ambiguity.status!=='requires_reconciliation'||ambiguity.resolution?.candidates.length!==2)
  throw Error('expected an explicitly ambiguous split');
history=commitUndoableSemanticSelectionRecovery(history,{
  format:SEMANTIC_SELECTION_RECOVERY_FORMAT,version:1,eventId:'event.user-face-choice',
  expectedRevision:history.document.revision,featureId:'feature.cut',
  field:'selectedFace',...evidence,selected:right,admission:'require_ready',
});
const chosen=featuresOf(history.document).find(f=>f.id==='feature.cut').payload.selectedFace;
if (chosen.anchor.roleId!=='face.top.right') throw Error('authored choice was lost');
history=undoTransaction(history,['event.undo-choice']);
history=redoTransaction(history,['event.redo-choice']);
history=deserializeUndoHistory(serializeUndoHistory(history));
document=deserializeProject(serializeProject(history.document));
document=commitEvent(document,{eventId:'event.thickness',type:'feature.edit',
  featureId:'feature.plate',patch:{payload:{widthMm:120,heightMm:80,thicknessMm:12}}});
const pending=assessSemanticSelection(document,'feature.cut','selectedFace');
if (pending.status!=='pending_evidence') throw Error('missing current evidence must stay pending');
if (planProject(document).features.find(s=>s.feature.id==='feature.cut').status!=='ready')
  throw Error('structurally ready cut disappeared');
console.log(JSON.stringify({
  format:'intuit3d.semantic-face-recovery-demo',version:1,projectId:document.projectId,
  revision:document.revision,thicknessMm:12,cutTargetRoleId:chosen.anchor.roleId,
  splitCandidates:ambiguity.resolution.candidates.map(c=>c.roleId),
  postEditSelectionStatus:pending.status,
  geometryAuthority:'none (model intent only; no exact B-rep/STEP claim)',
}));
