/**
 * Cross-lane consumer qualification for accepted INTENT topology and SKETCH
 * drag-projection contracts. Synthetic topology steps are reporter fixtures,
 * never OCCT provenance or independent geometric equivalence evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newProject, commitEvent, planProject, serializeProject, deserializeProject,
} from '../../packages/model/src/index.ts';
import {
  TOPOLOGY_REFERENCE_FORMAT, resolveSemanticTopologyReference,
} from '../../packages/model/src/topology.ts';
import {
  createSketch, plateSketchFixture, editConstraint, solveSketch,
  serializeSketch, parseSketch,
} from '../../packages/sketch/index.mjs';
import { suggestProjectedDrag } from '../../packages/sketch/drag-projection.mjs';

const create=(eventId,id,kind,dependsOn,writeTargets,payload)=>({
  eventId,type:'feature.create',feature:{id,kind,dependsOn,writeTargets,payload},
});
const role=(featureId,roleId)=>({featureId,roleId,kind:'face'});
const projectId='project.consumer.plate';
function plateJournal() {
  let project=newProject(projectId);
  project=commitEvent(project,create('event.cut','feature.cut','cut',
    ['feature.extrude'],['body.plate'],{holeIds:['holeA','holeB']}));
  assert.equal(planProject(project).features[0].status,'pending');
  project=commitEvent(project,create('event.extrude','feature.extrude','extrude',
    ['feature.sketch'],['body.plate'],{thicknessMm:8}));
  project=commitEvent(project,create('event.sketch','feature.sketch','sketch',
    [],['sketch.plate'],{sketch:JSON.parse(serializeSketch(plateSketchFixture()))}));
  return project;
}
function reference(revision,anchor) {
  return {format:TOPOLOGY_REFERENCE_FORMAT,version:1,projectId,atRevision:revision,anchor};
}
function snapshot(revision,anchor) {
  return {projectId,atRevision:revision,observedRoles:[anchor]};
}
function step(fromRevision,from,to,confidence='observed',coverage='complete') {
  return {projectId,fromRevision,toRevision:fromRevision+1,coverage,
    mappings:[{from,to,confidence}]};
}

test('integration: forward-authored cut resolves without changing chronology and replays identically',()=>{
  const original=plateJournal();
  const before=planProject(original);
  assert.deepEqual(before.authoredOrder,['feature.cut','feature.extrude','feature.sketch']);
  assert.deepEqual(before.executableOrder,['feature.sketch','feature.extrude','feature.cut']);
  assert.ok(before.features.every(x=>x.status==='ready'));
  const reopened=deserializeProject(serializeProject(original));
  assert.deepEqual(planProject(reopened),before);
  assert.equal(reopened.revision,3);
});

test('integration: a saved output-role reference retains identity but never invents missing topology evidence',()=>{
  const anchor=role('feature.extrude','role.top');
  const selection=reference(3,anchor);
  let doc=plateJournal();
  doc=commitEvent(doc,create('event.select','feature.selection','reference',
    ['feature.extrude'],[],{selection}));
  const reopened=deserializeProject(serializeProject(doc));
  const stored=planProject(reopened).features.find(x=>x.feature.id==='feature.selection').feature.payload.selection;
  assert.deepEqual(JSON.parse(JSON.stringify(stored)),selection);
  const observed=snapshot(3,anchor);
  const missing=resolveSemanticTopologyReference(stored,observed,[],4);
  assert.equal(missing.status,'pending_evidence');
  assert.deepEqual(missing.diagnostics.map(x=>x.code),['MISSING_STEP']);
  // Supplying an explicit, synthetic provider report permits semantic
  // interpretation only, not an exact B-rep validity or export claim.
  const successor=role('feature.extrude','role.top.afterEdit');
  const resolved=resolveSemanticTopologyReference(stored,observed,[step(3,[anchor],[successor])],4);
  assert.equal(resolved.status,'resolved');
  assert.deepEqual(resolved.candidates,[successor]);
});

test('integration: a split remains unresolved after reopen until an exact-revision manual binding',()=>{
  const anchor=role('feature.extrude','role.top');
  const a=role('feature.cut','role.top.left'), b=role('feature.cut','role.top.right');
  const saved=JSON.parse(JSON.stringify(reference(3,anchor)));
  const observed=snapshot(3,anchor);
  const reports=[step(3,[anchor],[a,b])];
  const pending=resolveSemanticTopologyReference(saved,observed,reports,4);
  assert.equal(pending.status,'requires_reconciliation');
  assert.deepEqual(pending.candidates,[a,b]);
  assert.ok(pending.diagnostics.some(x=>x.code==='SPLIT'));
  const binding={format:'intuit3d.semantic-topology-binding',version:1,projectId,
    atRevision:4,source:anchor,target:b};
  const bound=resolveSemanticTopologyReference(saved,observed,reports,4,binding);
  assert.equal(bound.status,'resolved_manual');
  assert.deepEqual(bound.candidates,[a,b]); // Manual choice is not falsely called provider truth.
  const stale=resolveSemanticTopologyReference(saved,observed,reports,4,{...binding,atRevision:3});
  assert.equal(stale.status,'requires_reconciliation');
  assert.ok(stale.diagnostics.some(x=>x.code==='INVALID_BINDING'));
});

test('integration: preview drag is constrained, transient and cannot change the authoritative journal',()=>{
  const sketch=plateSketchFixture();
  const before=serializeSketch(sketch);
  const original=plateJournal();
  const input=solveSketch(sketch).geometry.points.find(p=>p.id==='p1');
  const preview=suggestProjectedDrag(sketch,'p1',{x:input.x+37,y:input.y+11});
  assert.equal(preview.previewOnly,true);
  assert.equal(preview.status,'blocked');
  assert.deepEqual(preview.blockedAxes,['x','y']);
  assert.equal(preview.resolvedTarget.x,input.x);
  assert.equal(preview.resolvedTarget.y,input.y);
  assert.equal(serializeSketch(sketch),before);
  assert.equal(serializeProject(original),serializeProject(deserializeProject(serializeProject(original))));
  assert.deepEqual(preview,suggestProjectedDrag(parseSketch(before),'p1',{x:input.x+37,y:input.y+11}));
});

test('integration: explicit retrospective dimension edit persists; preview-only motion does not',()=>{
  const original=plateJournal();
  const first=plateSketchFixture();
  const width=editConstraint(first,'width',{value:140});
  const edited=commitEvent(original,{eventId:'event.width',type:'feature.edit',
    featureId:'feature.sketch',patch:{payload:{sketch:JSON.parse(serializeSketch(width))}}});
  const reopened=deserializeProject(serializeProject(edited));
  assert.equal(reopened.revision,4);
  const state=planProject(reopened).features.find(x=>x.feature.id==='feature.sketch');
  const recovered=parseSketch(JSON.stringify(state.feature.payload.sketch));
  const result=solveSketch(recovered);
  assert.equal(result.status,'solved');
  const p1=result.geometry.points.find(p=>p.id==='p1');
  assert.equal(p1.x,140);
  assert.deepEqual(planProject(reopened).executableOrder,['feature.sketch','feature.extrude','feature.cut']);
  assert.equal(solveSketch(first).geometry.points.find(p=>p.id==='p1').x,120);
});

test('integration: conflicting source is never turned into acceptable preview geometry',()=>{
  const sketch=createSketch({version:1,units:'mm',
    points:[{id:'a',x:0,y:0}],lines:[],circles:[],
    constraints:[{id:'fix0',kind:'fixed',point:'a',x:0,y:0},
      {id:'fix1',kind:'fixed',point:'a',x:1,y:0}]});
  const response=suggestProjectedDrag(sketch,'a',{x:5,y:9});
  assert.equal(response.status,'conflicted');
  assert.equal(response.geometry,null);
  assert.deepEqual(response.blockedAxes,['x','y']);
});
