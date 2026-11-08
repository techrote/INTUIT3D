import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createDimensionedLPlateSketch,proposeSelectedPlateProfile}
  from '../selected-profile.mjs';
import {createSelectedEdgeNotch,inspectSelectedEdgeNotch,
  editSelectedEdgeNotch,dragSelectedEdgeNotchHandle,
  SELECTED_EDGE_NOTCH_VERSION} from '../selected-edge-notch.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' != '+b);
const select=doc=>{
  const discovered=discoverPlateProfiles(doc),c=discovered.candidates.find(c=>
    c.lineIds.includes('L:edge0'));
  assert.ok(c,JSON.stringify(discovered));
  return {candidateId:c.id,sourceSignature:serializeSketch(doc)};
};
const command=(doc,overrides={})=>({
  kind:'create-edge-notch',version:1,sourceSignature:serializeSketch(doc),
  notchId:'relief',edgeId:'L:edge0',fromMm:45,toMm:65,depthMm:8,
  ...overrides
});
const make=()=>{
  const doc=createDimensionedLPlateSketch(),selection=select(doc);
  const r=createSelectedEdgeNotch(doc,selection,command(doc));
  assert.equal(r.kind,'accepted',JSON.stringify(r));
  return {doc,selection,r};
};
test('selected L boundary becomes a solved 10-line, notch-trimmed profile; hole membership is conserved',()=>{
  const {doc,r}=make();
  assert.equal(SELECTED_EDGE_NOTCH_VERSION,1);
  assert.equal(serializeSketch(doc),serializeSketch(createDimensionedLPlateSketch()));
  assert.equal(solveSketch(r.sketch).status,'solved');
  assert.equal(solveSketch(r.sketch).degreesOfFreedom,0);
  assert.equal(r.profile.lineIds.length,10);
  assert.deepEqual([...r.profile.holeIds].sort(),['L:holeLower','L:holeUpper']);
  assert.ok(r.profile.lineIds.includes('L:edge0'));
  near(r.profile.profile.areaMm2,5600-50*Math.PI-160);
  assert.equal(r.createdEntityIds.length,8);
  assert.equal(r.changedConstraintIds.length,8);
  assert.equal(r.previewOnly,true);
  assert.equal(r.nativeExact,false);
  assert.equal(r.exactBrepAvailable,false);
  const view=inspectSelectedEdgeNotch(r.sketch,r.selection,'relief');
  assert.equal(view.kind,'selected_edge_notch',JSON.stringify(view));
  near(view.originalLengthMm,120);
  near(view.fromMm,45);near(view.toMm,65);near(view.depthMm,8);
  assert.deepEqual(view.handles.map(h=>h.kind),['from','to','depth']);
  assert.equal(view.originalStartPointId,'L:a');
  assert.equal(view.originalEndPointId,'L:b');
});
test('immutable atomic dimension editing and three semantic pointer handles survive reopen',()=>{
  const {r}=make(),originalIds=r.sketch.lines.map(l=>l.id);
  const cmd={kind:'edit-edge-notch',version:1,
    sourceSignature:r.nextSourceSignature,notchId:'relief',
    fromMm:42,toMm:68,depthMm:10};
  const edited=editSelectedEdgeNotch(r.sketch,r.selection,cmd);
  assert.equal(edited.kind,'accepted',JSON.stringify(edited));
  assert.deepEqual(edited.sketch.lines.map(l=>l.id),originalIds);
  near(edited.profile.profile.areaMm2,5600-50*Math.PI-260);
  const archived=parseSketch(serializeSketch(edited.sketch));
  const view=inspectSelectedEdgeNotch(archived,edited.selection,'relief');
  assert.equal(view.kind,'selected_edge_notch',JSON.stringify(view));
  near(view.depthMm,10);
  const depth=view.handles.find(h=>h.kind==='depth');
  const changed=dragSelectedEdgeNotchHandle(archived,edited.selection,{
    version:1,sourceSignature:edited.nextSourceSignature,
    notchId:'relief',handleId:depth.id,
    target:{x:depth.position.x+3,y:13}});
  assert.equal(changed.kind,'accepted',JSON.stringify(changed));
  near(inspectSelectedEdgeNotch(changed.sketch,changed.selection,'relief').depthMm,13);
  near(changed.gesture.projectionDeviationMm,3);
  assert.equal(solveSketch(changed.sketch).status,'solved');
  const after=dragSelectedEdgeNotchHandle(changed.sketch,changed.selection,{
    version:1,sourceSignature:changed.nextSourceSignature,notchId:'relief',
    handleId:'relief:handle:from',target:{x:40,y:100}});
  assert.equal(after.kind,'accepted',JSON.stringify(after));
  near(inspectSelectedEdgeNotch(after.sketch,after.selection,'relief').fromMm,40);
  near(after.gesture.projectionDeviationMm,100);
});
test('retrospective source dimensions move original edge and retain notch semantic bindings',()=>{
  const {r}=make();
  const extended=editConstraint(r.sketch,'L:length',{value:140});
  const after=inspectSelectedEdgeNotch(extended,select(extended),'relief');
  assert.equal(after.kind,'selected_edge_notch',JSON.stringify(after));
  near(after.originalLengthMm,140);
  near(after.fromMm,45);near(after.toMm,65);near(after.depthMm,8);
  near(after.profile.profile.areaMm2,6200-50*Math.PI-160);
});
test('disjoint second contour is unaffected by trimming selected L; selection is explicit',()=>{
  const d=createDimensionedLPlateSketch();
  const pts=[[300,100],[340,100],[340,130],[300,130]]
    .map(([x,y],i)=>({id:'other:p'+i,x,y}));
  d.points.push(...pts);
  d.lines.push(...pts.map((p,i)=>({id:'other:edge'+i,start:p.id,
    end:pts[(i+1)%4].id})));
  d.constraints.push(...pts.map(p=>({id:'other:fixed:'+p.id,
    kind:'fixed',point:p.id,x:p.x,y:p.y})));
  const doc=createSketch(d),r=createSelectedEdgeNotch(doc,select(doc),command(doc));
  assert.equal(r.kind,'accepted',JSON.stringify(r));
  assert.equal(r.profile.unselectedLineIds.length,4);
  const old=solveSketch(doc).geometry.points.filter(p=>p.id.startsWith('other:'));
  const fresh=solveSketch(r.sketch).geometry.points.filter(p=>p.id.startsWith('other:'));
  assert.deepEqual(fresh,old);
});
test('stale source, noncontour edge, collapsed pocket, semantic collision refuse without edits',()=>{
  const doc=createDimensionedLPlateSketch(),sel=select(doc);
  const before=serializeSketch(doc);
  for(const over of [
    {sourceSignature:'stale'}, {edgeId:'missing'},
    {fromMm:65,toMm:45},{fromMm:0},{depthMm:0},
    {toMm:130},{notchId:'L:edge0'},
    {notchId:'bad space'}
  ]){
    const r=createSelectedEdgeNotch(doc,sel,command(doc,over));
    assert.equal(r.kind,'refused',JSON.stringify(over));
  }
  assert.equal(serializeSketch(doc),before);
  const {r}=make();
  const edit={kind:'edit-edge-notch',version:1,
    sourceSignature:'stale',notchId:'relief',fromMm:42,toMm:68,depthMm:10};
  assert.equal(editSelectedEdgeNotch(r.sketch,r.selection,edit).reason,'stale_source');
  assert.equal(inspectSelectedEdgeNotch(r.sketch,r.selection,'unknown').kind,'refused');
  assert.equal(dragSelectedEdgeNotchHandle(r.sketch,r.selection,{
    version:1,sourceSignature:r.nextSourceSignature,notchId:'relief',
    handleId:'not-a-handle',target:{x:4,y:4}}).reason,'unknown_handle');
});
test('a notch crossing an existing hole is refused; no hole silently disappears',()=>{
  const doc=createDimensionedLPlateSketch(),sel=select(doc);
  const r=createSelectedEdgeNotch(doc,sel,command(doc,{
    fromMm:80,toMm:100,depthMm:20}));
  assert.equal(r.kind,'refused',JSON.stringify(r));
  assert.equal(serializeSketch(doc),serializeSketch(createDimensionedLPlateSketch()));
});
test('underconstrained and conflicted source is never converted to accepted trim',()=>{
  const doc=createDimensionedLPlateSketch();
  const under=createSketch({...doc,
    constraints:doc.constraints.filter(c=>c.id!=='L:length')});
  const conflict=createSketch({...doc,constraints:[...doc.constraints,
    {id:'bad:length',kind:'distanceX',a:'L:a',b:'L:b',value:121}]});
  for(const bad of [under,conflict]){
    const result=createSelectedEdgeNotch(bad,selectOrStale(bad),
      command(bad));
    assert.equal(result.kind,'refused',JSON.stringify(result));
  }
});
function selectOrStale(doc){
  return {candidateId:'cycle:L:edge0|L:edge1|L:edge2|L:edge3|L:edge4|L:edge5',
    sourceSignature:serializeSketch(doc)};
}
