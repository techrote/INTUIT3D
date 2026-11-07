/** Public contracts: orphaned semantic edge repair + planar analytic admission. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,commitEvent,featuresOf,planProject,serializeProject} from '@intuit3d/model';
import {startUndoHistory,undoTransaction,redoTransaction} from '@intuit3d/model/transactions';
import {createModelArchive,serializeModelArchive,deserializeModelArchive} from '@intuit3d/model/archive';
import {DIMENSION_EDIT_FORMAT,commitUndoableDimensionEdit} from '@intuit3d/model/dimension-edit';
import {DIMENSION_DEPENDENCY_RECONCILE_FORMAT,previewDimensionDependencyReconciliation,commitUndoableDimensionDependencyReconciliation} from '@intuit3d/model/dimension-dependency-reconcile';
import {evaluateDimensionBindingPlan} from '@intuit3d/model/dimension-bindings';
import {plateSketchFixture,editConstraint,solveSketch,buildPlateProfile} from '@intuit3d/sketch';
import {assessAnalyticProfileArea} from '@intuit3d/sketch/analytic-area/v1';

const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const plate=(dependsOn=[])=>({id:'plate',kind:'extrude',dependsOn,writeTargets:['body.plate'],payload:{widthMm:120,depthMm:80,thicknessMm:8}});
const gate=doc=>evaluateDimensionBindingPlan(planProject(doc)).featureGates.find(x=>x.featureId==='plate').status;
const edit=(doc,eventId,binding)=>({format:DIMENSION_EDIT_FORMAT,version:1,eventId,featureId:'plate',field:'widthMm',binding,expectedRevision:doc.revision,admission:'permit_unresolved'});
const repair=(doc,rest={})=>({format:DIMENSION_DEPENDENCY_RECONCILE_FORMAT,version:1,eventId:'repair.edge',featureId:'plate',expectedRevision:doc.revision,release:['p.future'],confirmIndependentIntentReviewed:true,admission:'require_admissible',...rest});
function orphaned(){
  const d=commitEvent(newProject('integration.orphan-contract'),create('create.plate',plate()));
  let h=startUndoHistory(d);
  h=commitUndoableDimensionEdit(h,edit(h.document,'bind.future',{unit:'mm',expression:{op:'ref',featureId:'p.future'}}));
  h=commitUndoableDimensionEdit(h,edit(h.document,'clear.future',null));
  return h;
}
test('repair requires provenance and confirmation, archives and undoes as one semantic transaction',()=>{
  const h=orphaned(),doc=h.document,source=serializeProject(doc);
  assert.equal(gate(doc),'unready');
  assert.deepEqual(featuresOf(doc).find(x=>x.id==='plate').dependsOn,['p.future']);
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,repair(doc,{confirmIndependentIntentReviewed:false})),/unconfirmed/);
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,repair(doc,{expectedRevision:doc.revision-1})),/stale/);
  assert.equal(serializeProject(doc),source);
  const p=previewDimensionDependencyReconciliation(doc,repair(doc));
  assert.deepEqual(p.released,[{dependencyId:'p.future',introducedByEventId:'bind.future'}]);
  assert.equal(p.afterGate.status,'admissible');
  const committed=commitUndoableDimensionDependencyReconciliation(h,repair(doc));
  assert.equal(gate(committed.document),'admissible');
  const saved=serializeModelArchive(createModelArchive(committed));
  const reopened=deserializeModelArchive(saved);
  assert.equal(serializeModelArchive(reopened),saved);
  const undo=undoTransaction(reopened.history,['undo.repair.edge']);
  assert.equal(gate(undo.document),'unready');
  assert.deepEqual(featuresOf(undo.document).find(x=>x.id==='plate').dependsOn,['p.future']);
  const redo=redoTransaction(undo,['redo.repair.edge']);
  assert.equal(gate(redo.document),'admissible');
  assert.deepEqual(featuresOf(redo.document).find(x=>x.id==='plate').dependsOn,[]);
});
test('independently authored initial dependency is never silently deleted',()=>{
  const doc=commitEvent(newProject('integration.manual-dependency'),create('create.plate',plate(['p.future'])));
  assert.throws(()=>previewDimensionDependencyReconciliation(doc,repair(doc)),/no binding-introduction witness/);
  assert.deepEqual(featuresOf(doc).find(x=>x.id==='plate').dependsOn,['p.future']);
});
test('net analytic area is not approval of out-of-bound circular holes after retrospective width change',()=>{
  const doc=plateSketchFixture(),solved=solveSketch(doc);
  assert.equal(solved.status,'solved');
  const profile=buildPlateProfile(doc,solved,doc.lines.map(x=>x.id),doc.circles.map(x=>x.id));
  assert.equal(profile.status,'analytic_profile_only');
  assert.deepEqual(assessAnalyticProfileArea(profile.outer,profile.holes),{version:1,status:'verified',reason:null,areaMm2:profile.areaMm2});
  const narrow=editConstraint(doc,'width',{value:90});
  const narrowSolved=solveSketch(narrow);
  assert.equal(narrowSolved.status,'solved');
  assert.throws(()=>buildPlateProfile(narrow,narrowSolved,narrow.lines.map(x=>x.id),narrow.circles.map(x=>x.id)),/touches|crosses|outside/);
  assert.equal(assessAnalyticProfileArea([{x:-45,y:-40},{x:45,y:-40},{x:45,y:40},{x:-45,y:40}],profile.holes).status,'verified');
});
test('unrepresentable positive area is rejected rather than fabricated',()=>{
  assert.deepEqual(assessAnalyticProfileArea([{x:0,y:0},{x:1e200,y:0},{x:1e200,y:1e200},{x:0,y:1e200}]),{version:1,status:'rejected',reason:'unrepresentable_area',areaMm2:null});
});
