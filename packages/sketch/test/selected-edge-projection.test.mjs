import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,editConstraint,parseSketch,serializeSketch,solveSketch}
  from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {createSelectedEdgeBreakpoints,removeSelectedEdgeBreakpoints}
  from '../selected-edge-breakpoints.mjs';
import {createSelectedEdgeProjection,inspectSelectedEdgeProjection,
  editSelectedEdgeProjection,dragSelectedEdgeProjection,
  removeSelectedEdgeProjection,SELECTED_EDGE_PROJECTION_VERSION}
  from '../selected-edge-projection.mjs';

const select=(doc,edge='L:edge0')=>{
  const c=discoverPlateProfiles(doc).candidates.find(c=>c.lineIds.includes(edge));
  assert.ok(c,'must select a real solved contour');
  return {candidateId:c.id,sourceSignature:serializeSketch(doc)};
};
const makeSource=()=>{
  const sketch=createDimensionedLPlateSketch();
  const r=createSelectedEdgeBreakpoints(sketch,select(sketch),{
    kind:'create-edge-breakpoints',version:1,sourceSignature:serializeSketch(sketch),
    splitId:'datum',edgeId:'L:edge0',offsetsMm:[55,75]});
  assert.equal(r.kind,'accepted',JSON.stringify(r));
  return r;
};
const createCommand=(r,changes={})=>({
  kind:'create-edge-projection',version:1,
  sourceSignature:r.nextSourceSignature,projectionId:'crossDatum',
  sourceSplitId:'datum',targetEdgeId:'L:edge2',...changes
});
const makePair=()=>{
  const src=makeSource();
  const created=createSelectedEdgeProjection(src.sketch,src.selection,createCommand(src));
  assert.equal(created.kind,'accepted',JSON.stringify(created));
  return {src,created};
};
const inspect=created=>inspectSelectedEdgeProjection(created.sketch,
  created.selection,'crossDatum','datum');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' != '+b);

test('parallel edge projection creates genuine reference-bound subedges in one fully solved profile',()=>{
  const {src,created}=makePair();
  assert.equal(SELECTED_EDGE_PROJECTION_VERSION,1);
  const solved=solveSketch(created.sketch);
  assert.equal(solved.status,'solved');
  assert.equal(solved.degreesOfFreedom,0);
  assert.equal(created.profile.lineIds.length,10);
  assert.deepEqual([...created.profile.holeIds].sort(),['L:holeLower','L:holeUpper']);
  near(created.profile.profile.areaMm2,src.profile.profile.areaMm2);
  assert.deepEqual(created.sketch.lines.slice(-2).map(l=>l.id),
    ['crossDatum:segment1','crossDatum:segment2']);
  assert.ok(created.sketch.lines.find(l=>l.id==='L:edge2'));
  const view=inspect(created);
  assert.equal(view.kind,'selected_edge_projection',JSON.stringify(view));
  assert.deepEqual(view.associations.map(a=>a.sourceIndex),[2,1]);
  assert.deepEqual(view.targetOffsetsMm,[45,65]);
  assert.deepEqual(view.handles.map(h=>h.id),
    ['crossDatum:handle2','crossDatum:handle1']);
  assert.deepEqual(created.sketch.constraints.filter(c=>c.id.startsWith('crossDatum:align'))
    .map(c=>[c.kind,c.value]),[['distanceX',0],['distanceX',0]]);
});
test('drag on projected edge updates driving dimension, projected partner and original user constraints',()=>{
  const {created}=makePair();
  const lines=created.sketch.lines.map(x=>x.id);
  const edited=dragSelectedEdgeProjection(created.sketch,created.selection,{
    version:1,sourceSignature:created.nextSourceSignature,
    projectionId:'crossDatum',sourceSplitId:'datum',
    handleId:'crossDatum:handle1',target:{x:59,y:80}});
  assert.equal(edited.kind,'accepted',JSON.stringify(edited));
  assert.deepEqual(edited.sketch.lines.map(x=>x.id),lines);
  const v=inspect(edited);
  assert.equal(v.kind,'selected_edge_projection');
  assert.deepEqual(v.sourceOffsetsMm,[59,75]);
  near(v.handles.find(h=>h.id==='crossDatum:handle1').position.x,59);
  near(edited.gesture.projectionDeviationMm,50);
  assert.equal(solveSketch(edited.sketch).degreesOfFreedom,0);
  const d=edited.sketch.constraints.find(c=>c.id==='datum:offset1');
  near(d.value,59);
  assert.equal(d.a,'L:a');
});
test('atomically edit both offsets, preserve IDs and reconstruct from archive',()=>{
  const {created}=makePair(),signature=serializeSketch(created.sketch);
  const changed=editSelectedEdgeProjection(created.sketch,created.selection,{
    kind:'edit-edge-projection',version:1,sourceSignature:signature,
    projectionId:'crossDatum',sourceSplitId:'datum',sourceOffsetsMm:[58,78]});
  assert.equal(changed.kind,'accepted',JSON.stringify(changed));
  assert.deepEqual(changed.changedConstraintIds.sort(),['datum:offset1','datum:offset2']);
  const reopened=parseSketch(serializeSketch(changed.sketch));
  const v=inspectSelectedEdgeProjection(reopened,changed.selection,'crossDatum','datum');
  assert.equal(v.kind,'selected_edge_projection',JSON.stringify(v));
  assert.deepEqual(v.sourceOffsetsMm,[58,78]);
  assert.deepEqual(v.associations.map(a=>a.targetPointId),
    ['crossDatum:point1','crossDatum:point2']);
  near(v.profile.profile.areaMm2,created.profile.profile.areaMm2);
});
test('retrospective length change keeps both projected endpoints associative and solved',()=>{
  const {created}=makePair();
  const longer=editConstraint(created.sketch,'L:length',{value:150});
  const v=inspectSelectedEdgeProjection(longer,select(longer),
    'crossDatum','datum');
  assert.equal(v.kind,'selected_edge_projection',JSON.stringify(v));
  assert.deepEqual(v.sourceOffsetsMm,[55,75]);
  assert.deepEqual(v.targetOffsetsMm,[75,95]);
  assert.equal(solveSketch(longer).degreesOfFreedom,0);
});
test('remove projection restores previous authored sketch bit-for-bit, leaves driving datums',()=>{
  const {src,created}=makePair();
  const result=removeSelectedEdgeProjection(created.sketch,created.selection,{
    kind:'remove-edge-projection',version:1,
    sourceSignature:created.nextSourceSignature,
    projectionId:'crossDatum',sourceSplitId:'datum'});
  assert.equal(result.kind,'accepted',JSON.stringify(result));
  assert.equal(result.profile.lineIds.length,8);
  assert.equal(serializeSketch(result.sketch),serializeSketch(src.sketch));
  const canRemoveSource=removeSelectedEdgeBreakpoints(result.sketch,result.selection,{
    kind:'remove-edge-breakpoints',version:1,
    sourceSignature:result.nextSourceSignature,splitId:'datum'});
  assert.equal(canRemoveSource.kind,'accepted',JSON.stringify(canRemoveSource));
});
test('source datum deletion refuses while association exists instead of severing references',()=>{
  const {created}=makePair();
  const removal=removeSelectedEdgeBreakpoints(created.sketch,created.selection,{
    kind:'remove-edge-breakpoints',version:1,
    sourceSignature:created.nextSourceSignature,splitId:'datum'});
  assert.equal(removal.kind,'refused');
  assert.equal(removal.reason,'dependent_constraint_blocks_removal');
});
test('invalid geometry, stale stamps, duplicate ids and wrong selection refuse without mutation',()=>{
  const src=makeSource(),stamp=serializeSketch(src.sketch);
  for(const bad of [
    {sourceSignature:'stale'},
    {targetEdgeId:'not-an-edge'},
    {targetEdgeId:'L:edge1'},
    {targetEdgeId:'L:edge0'},
    {targetEdgeId:'datum:segment1'},
    {projectionId:'datum'},
    {projectionId:'bad space'},
    {sourceSplitId:'missing'}
  ]){
    const r=createSelectedEdgeProjection(src.sketch,src.selection,
      createCommand(src,bad));
    assert.equal(r.kind,'refused',JSON.stringify({bad,r}));
    assert.equal(serializeSketch(src.sketch),stamp);
  }
  const wrong={candidateId:'missing',sourceSignature:stamp};
  assert.equal(createSelectedEdgeProjection(src.sketch,wrong,
    createCommand(src)).kind,'refused');
});
test('projection outside selected target edge rejects instead of clamping to border',()=>{
  const base=createDimensionedLPlateSketch();
  const split=createSelectedEdgeBreakpoints(base,select(base),{
    kind:'create-edge-breakpoints',version:1,sourceSignature:serializeSketch(base),
    splitId:'datum',edgeId:'L:edge0',offsetsMm:[15,25]});
  assert.equal(split.kind,'accepted',JSON.stringify(split));
  const r=createSelectedEdgeProjection(split.sketch,split.selection,
    createCommand(split));
  assert.equal(r.kind,'refused');
  assert.equal(r.reason,'projection_outside_target_or_collapsed');
});
test('atomic edit rejects crossing, expired revision, target escape and non-finite pointer',()=>{
  const {created}=makePair(),stamp=serializeSketch(created.sketch);
  const edit=(offsets,signature=stamp)=>editSelectedEdgeProjection(
    created.sketch,created.selection,{
      kind:'edit-edge-projection',version:1,sourceSignature:signature,
      projectionId:'crossDatum',sourceSplitId:'datum',sourceOffsetsMm:offsets});
  assert.equal(edit([59,70],'old').reason,'stale_source');
  assert.equal(edit([75,55]).reason,'invalid_source_offsets');
  assert.equal(edit([59,59]).reason,'invalid_source_offsets');
  assert.equal(edit([30,70]).reason,'projection_outside_target_or_collapsed');
  assert.equal(edit([55,75]).reason,'no_change');
  const drag=(handleId,target)=>dragSelectedEdgeProjection(
    created.sketch,created.selection,{
      version:1,sourceSignature:stamp,projectionId:'crossDatum',
      sourceSplitId:'datum',handleId,target});
  assert.equal(drag('bad',{x:60,y:40}).reason,'unknown_handle');
  assert.equal(drag('crossDatum:handle1',{x:NaN,y:40}).reason,
    'invalid_pointer_gesture');
  assert.equal(serializeSketch(created.sketch),stamp);
});
test('conflicted and underconstrained source cannot be promoted to associative projection',()=>{
  const {src}=makePair();
  const under=createSketch({...src.sketch,
    constraints:src.sketch.constraints.filter(c=>c.id!=='L:length')});
  const conflicting=createSketch({...src.sketch,
    constraints:[...src.sketch.constraints,
      {id:'conflict:length',kind:'distanceX',a:'L:a',b:'L:b',value:150}]});
  for(const doc of [under,conflicting]){
    const r=createSelectedEdgeProjection(doc,selectDummy(doc),{
      ...createCommand(src),sourceSignature:serializeSketch(doc)});
    assert.equal(r.kind,'refused',JSON.stringify(r));
  }
});
const selectDummy=doc=>({candidateId:'none',sourceSignature:serializeSketch(doc)});
test('external geometric references block removal of projected points',()=>{
  const {created}=makePair();
  const doc=createSketch({...created.sketch,constraints:[
    ...created.sketch.constraints,
    {id:'external:extraX',kind:'distanceX',a:'L:b',
      b:'crossDatum:point1',value:-45}
  ]});
  const result=removeSelectedEdgeProjection(doc,select(doc),{
    kind:'remove-edge-projection',version:1,
    sourceSignature:serializeSketch(doc),
    projectionId:'crossDatum',sourceSplitId:'datum'});
  assert.equal(result.kind,'refused',JSON.stringify(result));
  assert.equal(result.reason,'dependent_constraint_blocks_removal');
});
test('published executable projection and source-aware gesture example works',async()=>{
  await import('../examples/selected-edge-projection.mjs');
});
