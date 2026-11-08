import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,serializeSketch} from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {serializeArcSketch,solveArcSketch} from '../arc-constraints.mjs';
import {SELECTED_EDGE_ROUND_SLOT_VERSION,SELECTED_EDGE_ROUND_SLOT_FORMAT,
  createSelectedEdgeRoundSlot,inspectSelectedEdgeRoundSlot,
  editSelectedEdgeRoundSlot,dragSelectedEdgeRoundSlotHandle,
  rebaseSelectedEdgeRoundSlot,serializeSelectedEdgeRoundSlot,
  parseSelectedEdgeRoundSlot} from '../selected-edge-round-slot.mjs';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,String(a)+' != '+String(b));
const selection=doc=>{
  const candidate=discoverPlateProfiles(doc).candidates.find(c=>
    c.lineIds.includes('L:edge0'));
  assert.ok(candidate,'selected L contour must exist');
  return {candidateId:candidate.id,sourceSignature:serializeSketch(doc)};
};
const createCommand=(doc,overrides={})=>({
  kind:'create-selected-edge-round-slot',version:1,
  sourceSignature:serializeSketch(doc),id:'uSlot',edgeId:'L:edge0',
  fromMm:45,toMm:65,straightDepthMm:8,...overrides
});
const make=()=>{
  const doc=createDimensionedLPlateSketch(),sel=selection(doc);
  const result=createSelectedEdgeRoundSlot(doc,sel,createCommand(doc));
  assert.equal(result.kind,'accepted',JSON.stringify(result));
  return {doc,sel,result};
};
const actualIds=arc=>({
  lines:arc.lines.map(l=>l.id),arcs:arc.arcs.map(l=>l.id),
  constraints:arc.constraints.map(c=>c.id),points:arc.points.map(p=>p.id)
});

test('true tangent semicircle trims chosen L contour and retains source constraint truth',()=>{
  const {doc,result:r}=make();
  assert.equal(SELECTED_EDGE_ROUND_SLOT_VERSION,1);
  assert.equal(SELECTED_EDGE_ROUND_SLOT_FORMAT,'intuit3d.selected-edge-round-slot');
  const solved=solveArcSketch(r.arcSketch);
  assert.equal(solved.status,'solved',JSON.stringify(solved.diagnostics));
  assert.equal(solved.degreesOfFreedom,0);
  assert.deepEqual(r.profile.boundary.map(x=>x.kind),
    ['line','line','arc','line','line','line','line','line','line','line']);
  assert.equal(r.profile.boundary.find(x=>x.id==='uSlot:cap').sweepRad<0,true);
  near(r.profile.boundary.find(x=>x.id==='uSlot:cap').radiusMm,10);
  near(r.profile.materialAreaMm2,5440-100*Math.PI);
  assert.deepEqual(r.holeIds,['L:holeLower','L:holeUpper']);
  assert.equal(r.profile.globalSelfIntersectionChecked,true);
  assert.equal(r.profile.providerSubmissionReady,true);
  assert.equal(r.profile.exactBrepAvailable,false);
  assert.equal(r.nativeExact,false);
  assert.deepEqual(r.handles.map(h=>h.kind),['from','to','cap-tip']);
  near(r.handles[2].position.y,18);
  assert.equal(serializeSketch(r.authoring.source),serializeSketch(doc));
  assert.deepEqual(r.authoring.source.constraints,doc.constraints);
  assert.equal(r.arcSketch.lines.find(e=>e.id==='L:edge0').end,'uSlot:p1');
  assert.equal(r.arcSketch.constraints.filter(c=>c.kind==='tangent').length,2);
  assert.equal(r.arcSketch.constraints.filter(c=>c.kind==='arcRadius').length,1);
  assert.equal(r.arcSketch.constraints.filter(c=>c.kind==='radius').length,0);
});

test('atomic dimension edit, cap handle drag and save/reopen preserve semantic IDs',()=>{
  const {result:r}=make();
  const original=serializeSelectedEdgeRoundSlot(r.authoring);
  const edited=editSelectedEdgeRoundSlot(r.authoring,{
    kind:'edit-selected-edge-round-slot',version:1,sourceSignature:original,
    fromMm:40,toMm:68,straightDepthMm:10});
  assert.equal(edited.kind,'accepted',JSON.stringify(edited));
  near(edited.profile.materialAreaMm2,5600-50*Math.PI-
    (28*10+Math.PI*14*14/2));
  assert.deepEqual(actualIds(r.arcSketch),actualIds(edited.arcSketch));
  const reopened=parseSelectedEdgeRoundSlot(
    serializeSelectedEdgeRoundSlot(edited.authoring));
  const inspection=inspectSelectedEdgeRoundSlot(reopened);
  assert.equal(inspection.kind,'selected_edge_round_slot',JSON.stringify(inspection));
  near(inspection.slot.toMm,68);
  assert.deepEqual(inspection.profile.boundary,edited.profile.boundary);
  assert.equal(serializeArcSketch(inspection.arcSketch),
    serializeArcSketch(edited.arcSketch));
  const tip=inspection.handles.find(h=>h.kind==='cap-tip');
  const dragged=dragSelectedEdgeRoundSlotHandle(reopened,{
    version:1,sourceSignature:inspection.authoringSignature,
    handleId:tip.id,target:{x:tip.position.x+3,y:tip.position.y+4}});
  assert.equal(dragged.kind,'accepted',JSON.stringify(dragged));
  near(dragged.slot.straightDepthMm,14);
  near(dragged.gesture.projectionDeviationMm,3);
  assert.deepEqual(actualIds(dragged.arcSketch),actualIds(edited.arcSketch));
  assert.equal(serializeSelectedEdgeRoundSlot(r.authoring),original);
});

test('retrospective edited main dimensions recompile arc geometry without losing bindings',()=>{
  const {result:r}=make();
  const resized=editConstraint(r.authoring.source,'L:length',{value:140});
  const result=rebaseSelectedEdgeRoundSlot(r.authoring,resized,selection(resized),{
    kind:'rebase-selected-edge-round-slot',version:1,
    sourceSignature:r.authoringSignature});
  assert.equal(result.kind,'accepted',JSON.stringify(result));
  near(result.originalLengthMm,140);
  near(result.slot.fromMm,45);
  near(result.profile.materialAreaMm2,6200-100*Math.PI-160);
  assert.deepEqual(result.holeIds,r.holeIds);
  assert.deepEqual(actualIds(result.arcSketch),actualIds(r.arcSketch));
  assert.equal(solveArcSketch(result.arcSketch).degreesOfFreedom,0);
});

test('selected contour isolation includes a second disjoint authored loop',()=>{
  const doc=createDimensionedLPlateSketch();
  const second=[[300,100],[340,100],[340,130],[300,130]];
  for(let i=0;i<4;i++){
    const [x,y]=second[i],id='other:p'+i;
    doc.points.push({id,x,y});
    doc.constraints.push({id:'other:fix'+i,kind:'fixed',point:id,x,y});
    doc.lines.push({id:'other:edge'+i,start:id,end:'other:p'+((i+1)%4)});
  }
  const source=createSketch(doc),r=createSelectedEdgeRoundSlot(
    source,selection(source),createCommand(source));
  assert.equal(r.kind,'accepted',JSON.stringify(r));
  const pts=new Map(solveArcSketch(r.arcSketch).geometry.points.map(p=>[p.id,p]));
  for(const p of source.points.filter(p=>p.id.startsWith('other:'))){
    near(pts.get(p.id).x,p.x);near(pts.get(p.id).y,p.y);
  }
  assert.equal(r.profile.boundary.length,10);
  assert.deepEqual(r.holeIds,['L:holeLower','L:holeUpper']);
});

test('stale/invalid geometries and circle collision refuse immutably',()=>{
  const doc=createDimensionedLPlateSketch(),sel=selection(doc);
  const stamp=serializeSketch(doc);
  for(const bad of [
    {sourceSignature:'stale'},{edgeId:'not-an-edge'},
    {fromMm:0},{fromMm:65,toMm:45},{straightDepthMm:0},
    {toMm:121},{id:'L:edge0'},{id:'bad slot'},
    {fromMm:80,toMm:100,straightDepthMm:10},
    {fromMm:2,toMm:38,straightDepthMm:90}
  ]){
    const r=createSelectedEdgeRoundSlot(doc,sel,createCommand(doc,bad));
    assert.equal(r.kind,'refused',JSON.stringify({bad,result:r}));
  }
  assert.equal(serializeSketch(doc),stamp);
  const {result:r}=make();
  const ar=serializeSelectedEdgeRoundSlot(r.authoring);
  for(const bad of [
    {fromMm:80,toMm:100,straightDepthMm:10},
    {fromMm:65,toMm:45,straightDepthMm:8},
    {fromMm:45,toMm:65,straightDepthMm:8}
  ]){
    const outcome=editSelectedEdgeRoundSlot(r.authoring,{
      kind:'edit-selected-edge-round-slot',version:1,
      sourceSignature:ar,...bad});
    assert.equal(outcome.kind,'refused');
  }
  assert.equal(editSelectedEdgeRoundSlot(r.authoring,{
    kind:'edit-selected-edge-round-slot',version:1,
    sourceSignature:'obsolete',fromMm:45,toMm:65,
    straightDepthMm:12}).reason,'stale_source');
  assert.equal(dragSelectedEdgeRoundSlotHandle(r.authoring,{
    version:1,sourceSignature:ar,handleId:'unknown',
    target:{x:55,y:20}}).reason,'unknown_handle');
  assert.equal(serializeSelectedEdgeRoundSlot(r.authoring),ar);
});

test('source uncertainty and unsupported midpoint never become new solved profiles',()=>{
  const doc=createDimensionedLPlateSketch();
  const under=createSketch({...doc,constraints:doc.constraints.filter(
    c=>c.id!=='L:length')});
  const conflict=createSketch({...doc,constraints:[
    ...doc.constraints,
    {id:'bad:length',kind:'distanceX',a:'L:a',b:'L:b',value:121}
  ]});
  for(const source of [under,conflict]){
    const result=createSelectedEdgeRoundSlot(source,
      {candidateId:'cycle:L:edge0|L:edge1|L:edge2|L:edge3|L:edge4|L:edge5',
        sourceSignature:serializeSketch(source)},
      createCommand(source));
    assert.equal(result.kind,'refused');
  }
  const midpoint=createSketch({...doc,constraints:[...doc.constraints,{
    id:'user:midpoint',kind:'midpoint',
    point:'L:d',a:'L:a',b:'L:c'
  }]});
  assert.equal(createSelectedEdgeRoundSlot(midpoint,selection(midpoint),
    createCommand(midpoint)).kind,'refused');
});

test('source-independent authoring metadata cannot be added or silently accepted',()=>{
  const {result:r}=make();
  const fake={...r.authoring,arcSketch:r.arcSketch};
  const report=inspectSelectedEdgeRoundSlot(fake);
  assert.equal(report.kind,'refused');
  assert.equal(report.reason,'invalid_authoring');
  assert.deepEqual(inspectSelectedEdgeRoundSlot(r.authoring).profile,
    r.profile);
});
test('documented public consumer example executes',async()=>{
  await import('../examples/selected-edge-round-slot.mjs');
});
