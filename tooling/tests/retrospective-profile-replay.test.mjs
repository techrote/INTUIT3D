/**
 * INTEGRATION exact-source conformance for admitted INTENT #35 and SKETCH #36.
 * Public-package semantic edit -> late parameter -> archive/undo/replay ->
 * solved analytic profile. A bound scalar is NOT proof of a geometrically
 * admissible sketch, and an analytic profile is NOT a B-rep/STEP export.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newProject, commitEvent, featuresOf, planProject, serializeProject,
} from '@intuit3d/model';
import {
  startUndoHistory, commitUndoableTransaction, undoTransaction, redoTransaction,
} from '@intuit3d/model/transactions';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '@intuit3d/model/archive';
import {
  DIMENSION_EDIT_FORMAT, previewDimensionEdit, commitUndoableDimensionEdit,
} from '@intuit3d/model/dimension-edit';
import { evaluateDimensionBindingPlan } from '@intuit3d/model/dimension-bindings';
import {
  plateSketchFixture, editConstraint, solveSketch, buildPlateProfile, createSketch,
} from '@intuit3d/sketch';
import {
  discoverPlateProfiles, admitDiscoveredPlateProfile,
} from '@intuit3d/sketch/profile-discovery/v1';
import { assessPolygonBoundary } from '@intuit3d/sketch/boundary-guard/v1';

const create = (eventId, feature) => ({ eventId, type:'feature.create', feature });
const plate = () => ({ id:'plate', kind:'extrude', dependsOn:[], writeTargets:['body.plate'],
  payload:{widthMm:120, depthMm:80, thicknessMm:8} });
const parameter = (width) => ({ id:'parameter.width', kind:'parameter', dependsOn:[],
  writeTargets:[], payload:{parameter:{name:'width', unit:'mm',
    expression:{op:'literal', value:width, unit:'mm'}}} });
const source = () => commitEvent(newProject('integration.retrospective-profile'),
  create('create.plate',plate()));
const request = (doc, overrides={}) => ({
  format:DIMENSION_EDIT_FORMAT, version:1, eventId:'bind.width',
  featureId:'plate', field:'widthMm',
  binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.width'}},
  expectedRevision:doc.revision, admission:'permit_unresolved', ...overrides,
});
const derived = (doc) => evaluateDimensionBindingPlan(planProject(doc))
  .featureGates.find(f=>f.featureId==='plate');
const sketchFor = width => editConstraint(plateSketchFixture(),'width',{value:width});

test('future-authored parameter, undoable binding and late insertion replay through archive into solved profile',()=>{
  const initial=source();
  let history=commitUndoableDimensionEdit(startUndoHistory(initial),request(initial));
  assert.equal(derived(history.document).status,'unready');
  assert.equal(derived(history.document).resolvedPayload,null);
  assert.deepEqual(featuresOf(history.document).find(f=>f.id==='plate').dependsOn,['parameter.width']);
  assert.equal(featuresOf(history.document).find(f=>f.id==='plate').payload.widthMm,120);

  history=commitUndoableTransaction(history,[create('create.parameter',parameter(140))]);
  const saved=serializeModelArchive(createModelArchive(history));
  const reopened=deserializeModelArchive(saved);
  assert.equal(serializeModelArchive(reopened),saved);
  const doc=reopened.history.document;
  assert.deepEqual(planProject(doc).authoredOrder,['plate','parameter.width']);
  assert.deepEqual(planProject(doc).executableOrder,['parameter.width','plate']);
  assert.equal(derived(doc).status,'bound');
  assert.equal(derived(doc).resolvedPayload.widthMm,140);

  const sketch=sketchFor(derived(doc).resolvedPayload.widthMm);
  assert.equal(solveSketch(sketch).status,'solved');
  const proposal=discoverPlateProfiles(sketch);
  assert.equal(proposal.status,'ready');
  const profile=admitDiscoveredPlateProfile(sketch,proposal,proposal.candidates[0].id);
  assert.equal(profile.status,'analytic_profile_only');
  assert.equal(profile.holes.length,2);
  assert.equal(assessPolygonBoundary(profile.outer).status,'verified');

  const undone=undoTransaction(reopened.history,['undo.late.parameter']);
  assert.equal(derived(undone.document).status,'unready');
  assert.equal(derived(undone.document).resolvedPayload,null);
  const redone=redoTransaction(undone,['redo.late.parameter']);
  assert.equal(derived(redone.document).resolvedPayload.widthMm,140);
  assert.equal(featuresOf(redone.document).find(f=>f.id==='plate').id,'plate');
});

test('strict dimension-edit admission is atomic and stale optimistic revisions cannot change semantic intent',()=>{
  const initial=source(), before=serializeProject(initial);
  assert.throws(()=>previewDimensionEdit(initial,request(initial,{admission:'require_admissible'})),
    /not admissible/);
  assert.equal(serializeProject(initial),before);
  const withParam=commitEvent(initial,create('create.parameter',parameter(130)));
  const edited=commitUndoableDimensionEdit(startUndoHistory(withParam),
    request(withParam,{admission:'require_admissible'}));
  assert.equal(edited.undoStack.length,1);
  assert.equal(derived(edited.document).resolvedPayload.widthMm,130);
  assert.throws(()=>commitUndoableDimensionEdit(edited,
    request(withParam,{eventId:'bind.stale'})),/stale dimension edit revision/);
  const undone=undoTransaction(edited,['undo.binding']);
  assert.equal(featuresOf(undone.document).find(f=>f.id==='plate').payload.dimensionBindings,undefined);
  assert.deepEqual(featuresOf(undone.document).find(f=>f.id==='plate').dependsOn,[]);
  const redone=redoTransaction(undone,['redo.binding']);
  assert.equal(derived(redone.document).resolvedPayload.widthMm,130);
});

test('numerically bound retroactive width may still invalidate hole containment; keep intent, refuse geometry',()=>{
  const initial=source();
  const withParam=commitEvent(initial,create('create.parameter',parameter(90)));
  const edited=previewDimensionEdit(withParam,
    request(withParam,{admission:'require_admissible'}));
  assert.equal(edited.gate.status,'bound');
  assert.equal(edited.gate.resolvedPayload.widthMm,90);
  assert.equal(featuresOf(edited.document).find(f=>f.id==='plate').payload.widthMm,120);
  const sketch=sketchFor(90);
  const solution=solveSketch(sketch);
  assert.equal(solution.status,'solved');
  assert.throws(()=>buildPlateProfile(sketch,solution,sketch.lines.map(l=>l.id),
    sketch.circles.map(c=>c.id)),/touches|crosses|outside/);
  assert.equal(derived(edited.document).status,'bound'); // scalar != CAD geometry
});

test('exact binary64 guard refuses underflowed self-intersection in a solved authored sketch',()=>{
  const t=1e-170;
  const coords=[[0,t/2],[t,t/2],[t/2,0],[t/2,t],[10,0],[10,10],[0,10]];
  const points=coords.map(([x,y],i)=>({id:'p'+i,x,y}));
  const lines=points.map((p,i)=>({id:'e'+i,start:p.id,end:points[(i+1)%points.length].id}));
  const constraints=points.map(p=>({id:'fix'+p.id,kind:'fixed',point:p.id,x:p.x,y:p.y}));
  const sketch=createSketch({version:1,units:'mm',points,lines,circles:[],constraints});
  const solved=solveSketch(sketch);
  assert.equal(solved.status,'solved');
  assert.equal(assessPolygonBoundary(solved.geometry.points).reason,'nonadjacent_intersection');
  assert.throws(()=>buildPlateProfile(sketch,solved,lines.map(e=>e.id)),
    /boundary guard: nonadjacent_intersection/);
});
