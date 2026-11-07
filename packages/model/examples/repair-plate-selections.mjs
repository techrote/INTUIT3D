/**
 * Run: node --experimental-strip-types packages/model/examples/repair-plate-selections.mjs
 *
 * Real authoritative MODEL journal/undo/archive, deterministic provider HINTS.
 * This deliberately does not claim that preview faces are native OCCT topology.
 */
import {newProject,commitEvent,featuresOf} from '../src/index.ts';
import {startUndoHistory,undoTransaction} from '../src/transactions.ts';
import {createModelArchive,serializeModelArchive,deserializeModelArchive} from '../src/archive.ts';
import {SEMANTIC_SELECTION_EDIT_FORMAT,commitUndoableSemanticSelectionEdit} from '../src/semantic-selection.ts';
import {TOPOLOGY_REFERENCE_FORMAT} from '../src/topology.ts';
import {SELECTION_EVIDENCE_FORMAT,inspectSelectionInventory} from '../src/selection-inventory.ts';
import {SELECTION_REPAIR_FORMAT,commitUndoableSelectionRepairBatch} from '../src/selection-repair.ts';

const projectId='project.selection.demo';
const top={featureId:'feature.extrude',roleId:'face.top',kind:'face'};
const left={...top,roleId:'face.top.left'},right={...top,roleId:'face.top.right'};
const side={featureId:'feature.extrude',roleId:'edge.side',kind:'edge'};
const newSide={...side,roleId:'edge.new'};
let doc=newProject(projectId);
for(const [eventId,feature] of [
  ['event.sketch',{id:'feature.sketch',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{widthMm:120,heightMm:80,holeDiametersMm:[10,10]}}],
  ['event.extrude',{id:'feature.extrude',kind:'extrude',
    dependsOn:['feature.sketch'],writeTargets:['body.plate'],payload:{thicknessMm:8}}],
  ['event.cut',{id:'feature.cut',kind:'cut',
    dependsOn:['feature.extrude'],writeTargets:['body.plate'],payload:{holeCount:2}}],
  ['event.inspector',{id:'feature.measure',kind:'measure',
    dependsOn:['feature.cut'],writeTargets:[],payload:{label:'edge-length'}}],
]){
  doc=commitEvent(doc,{eventId,type:'feature.create',feature});
}
let history=startUndoHistory(doc);
const ref=(anchor)=>({format:TOPOLOGY_REFERENCE_FORMAT,version:1,
  projectId,atRevision:2,anchor});
for(const [featureId,field,anchor,eventId] of [
  ['feature.cut','sourceFace',top,'event.face-reference'],
  ['feature.measure','sourceEdge',side,'event.edge-reference'],
]){
  history=commitUndoableSemanticSelectionEdit(history,{
    format:SEMANTIC_SELECTION_EDIT_FORMAT,version:1,eventId,
    featureId,field,expectedRevision:history.document.revision,
    admission:'require_ready',reference:ref(anchor),
  });
}
doc=commitEvent(history.document,{eventId:'event.edit-thickness',
  type:'feature.edit',featureId:'feature.extrude',patch:{payload:{thicknessMm:12}}});
history=startUndoHistory(doc);

const trace=(anchor,to)=>Array.from({length:doc.revision-2},(_,i)=>{
  const n=i+2;
  return {projectId,fromRevision:n,toRevision:n+1,coverage:'complete',
    mappings:[{from:[anchor],to:n===doc.revision-1?to:[anchor],confidence:'observed'}]};
});
const evidence=[
  {featureId:'feature.cut',field:'sourceFace',anchor:top,to:[left,right]},
  {featureId:'feature.measure',field:'sourceEdge',anchor:side,to:[]},
].map(({featureId,field,anchor,to})=>({
  format:SELECTION_EVIDENCE_FORMAT,version:1,projectId,revision:doc.revision,
  featureId,field,reference:ref(anchor),provider:'deterministic_fixture',
  snapshot:{projectId,atRevision:2,observedRoles:[anchor]},steps:trace(anchor,to),
}));
const before=inspectSelectionInventory(doc,evidence);
history=commitUndoableSelectionRepairBatch(history,{
  format:SELECTION_REPAIR_FORMAT,version:1,expectedRevision:doc.revision,
  admission:'require_ready',
  repairs:[
    {eventId:'event.reanchor-face',featureId:'feature.cut',field:'sourceFace',selected:right},
    {eventId:'event.replace-deleted-edge',featureId:'feature.measure',field:'sourceEdge',
      selected:newSide,replacementObservation:{
        provider:'deterministic_fixture',
        snapshot:{projectId,atRevision:doc.revision,observedRoles:[newSide]},
      }},
  ],
},evidence);
const reopened=deserializeModelArchive(serializeModelArchive(createModelArchive(history)));
const afterReopen=inspectSelectionInventory(reopened.history.document);
const undo=undoTransaction(reopened.history,['event.undo-edge','event.undo-face']);
const feature=(source,id)=>featuresOf(source).find(f=>f.id===id);
const report={
  format:'intuit3d.selection-repair-demo',
  thicknessMm:feature(reopened.history.document,'feature.extrude').payload.thicknessMm,
  stableBodyId:feature(reopened.history.document,'feature.extrude').writeTargets[0],
  repairActions:before.selections.map(x=>x.action),
  selectedFace:feature(reopened.history.document,'feature.cut').payload.sourceFace.anchor.roleId,
  replacementEdge:feature(reopened.history.document,'feature.measure').payload.sourceEdge.anchor.roleId,
  afterReopen:afterReopen.selections[0].status,
  undoRestoredFace:feature(undo.document,'feature.cut').payload.sourceFace.anchor.roleId,
  exactGeometryAuthority:afterReopen.exactGeometryAuthority,
};
console.log(JSON.stringify(report));
