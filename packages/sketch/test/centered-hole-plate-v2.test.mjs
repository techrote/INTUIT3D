import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {rectanglePlateFromProfile} from '../../workflow-runtime/experimental-plate.mjs';
import {
  createOffsetHolePlate,inspectOffsetHolePlate,
  editOffsetHolePlateDimensions,dragOffsetHolePlateHandle
} from '../centered-hole-plate-v2.mjs';

const create=()=>createOffsetHolePlate({
  id:'mount',widthMm:120,heightMm:80,leftInsetMm:35,rightInsetMm:35,
  holeARadiusMm:6,holeBRadiusMm:6,holeAYOffsetMm:5,holeBYOffsetMm:-5
});
const view=doc=>inspectOffsetHolePlate(doc,'mount');
const changes=(doc,values)=>editOffsetHolePlateDimensions(doc,'mount',{
  version:2,expectedSignature:serializeSketch(doc),changes:values
});
const centers=doc=>{
  const pts=new Map(view(doc).solution.geometry.points.map(p=>[p.id,p]));
  return [pts.get('mount:holeA:center'),pts.get('mount:holeB:center')];
};
const ids=doc=>[...doc.points,...doc.lines,...doc.circles,...doc.constraints].map(x=>x.id);

test('independent centerline dimensions genuinely solve through midpoint dependencies',()=>{
  const source=create(),result=view(source);
  assert.equal(result.status,'solved');
  assert.equal(result.solution.degreesOfFreedom,0);
  assert.equal(result.profile.status,'analytic_profile_only');
  assert.equal(result.profileId,'mount:profile');
  assert.deepEqual(centers(source).map(p=>[p.x,p.y]),[[35,45],[85,35]]);
  assert.equal(result.handles.length,10);
  assert.equal(result.handles.find(h=>h.id==='mount:handle:A').kind,'hole_center');
  assert.equal(result.previewOnly,true);
  assert.equal(result.nativeExact,false);
  assert.deepEqual(rectanglePlateFromProfile(result.profile,8).holes,[
    {x:-25,y:5,radius:6},{x:25,y:-5,radius:6}
  ]);
});
test('width, height and offsets replay through actual solver while preserving stable IDs',()=>{
  const before=create(),idList=ids(before);
  const widened=changes(before,{widthMm:150,heightMm:100});
  assert.equal(widened.kind,'accepted');
  assert.equal(widened.status,'solved');
  assert.deepEqual(centers(widened.sketch).map(p=>[p.x,p.y]),[[35,55],[115,45]]);
  const moved=changes(widened.sketch,{holeAYOffsetMm:-9,holeBYOffsetMm:12});
  assert.equal(moved.kind,'accepted');
  assert.deepEqual(centers(moved.sketch).map(p=>[p.x,p.y]),[[35,41],[115,62]]);
  assert.deepEqual(ids(moved.sketch),idList);
  assert.equal(view(moved.sketch).profileId,view(before).profileId);
  const reopened=parseSketch(serializeSketch(moved.sketch));
  assert.deepEqual(view(reopened),view(moved.sketch));
  assert.deepEqual(ids(reopened),idList);
  assert.deepEqual(centers(before).map(p=>[p.x,p.y]),[[35,45],[85,35]]);
  const provider=rectanglePlateFromProfile(view(reopened).profile,8);
  assert.deepEqual(provider,{width:150,depth:100,thickness:8,holes:[
    {x:-40,y:-9,radius:6},{x:40,y:12,radius:6}
  ]});
});
test('hole-center drag is one revision-fenced two-dimension authored edit',()=>{
  const before=create(),stamp=serializeSketch(before);
  const drag=dragOffsetHolePlateHandle(before,'mount',{
    version:2,expectedSignature:stamp,
    handleId:'mount:handle:B',target:{x:101,y:54}
  });
  assert.equal(drag.kind,'accepted');
  assert.equal(drag.status,'solved');
  assert.equal(drag.dimensions.rightInsetMm,19);
  assert.equal(drag.dimensions.holeBYOffsetMm,14);
  assert.deepEqual(centers(drag.sketch).map(p=>[p.x,p.y]),[[35,45],[101,54]]);
  assert.deepEqual(drag.gesture.appliedPoint,{x:101,y:54});
  assert.equal(drag.gesture.deviationMm,0);
  assert.equal(serializeSketch(before),stamp);
  // Replaying the original snapshot is one-step undo of the whole gesture.
  assert.deepEqual(centers(parseSketch(stamp)),[[35,45],[85,35]].map(([x,y],i)=>({
    id:i?'mount:holeB:center':'mount:holeA:center',x,y
  })));
  const wrong=dragOffsetHolePlateHandle(drag.sketch,'mount',{
    version:2,expectedSignature:stamp,
    handleId:'mount:handle:B',target:{x:102,y:53}
  });
  assert.equal(wrong.kind,'refused');
  assert.equal(wrong.reason,'stale or malformed pointer request');
});
test('signed vertical offset drag stays on solver midpoint, not stale seed Y',()=>{
  const source=create();
  const taller=changes(source,{heightMm:100});
  assert.equal(taller.kind,'accepted');
  const drag=dragOffsetHolePlateHandle(taller.sketch,'mount',{
    version:2,expectedSignature:serializeSketch(taller.sketch),
    handleId:'mount:handle:holeAYOffsetMm',target:{x:900,y:62}
  });
  assert.equal(drag.kind,'accepted');
  assert.equal(drag.dimensions.holeAYOffsetMm,12);
  assert.deepEqual(drag.gesture.appliedPoint,{x:35,y:62});
  assert.equal(drag.gesture.deviationMm,865);
});
test('profile-invalid edits retain all authored dimensions and can be repaired',()=>{
  const source=create(),baseline=serializeSketch(source);
  const bad=changes(source,{holeAYOffsetMm:200});
  assert.equal(bad.kind,'accepted');
  assert.equal(bad.status,'profile_rejected');
  assert.equal(bad.profile,null);
  assert.equal(bad.handles.length,0);
  assert.equal(bad.nativeExact,false);
  const repair=changes(bad.sketch,{holeAYOffsetMm:0});
  assert.equal(repair.kind,'accepted');
  assert.equal(repair.status,'solved');
  assert.deepEqual(ids(repair.sketch),ids(source));
  assert.equal(serializeSketch(source),baseline);
});
test('stale, invalid, contradictory and dependency-broken edits are explicit',()=>{
  const source=create(),stamp=serializeSketch(source);
  assert.equal(editOffsetHolePlateDimensions(source,'mount',{
    version:2,expectedSignature:'stale',changes:{widthMm:140}
  }).kind,'refused');
  assert.equal(changes(source,{unknownDimension:22}).kind,'refused');
  assert.equal(changes(source,{holeAYOffsetMm:NaN}).kind,'refused');
  assert.equal(changes(source,{holeARadiusMm:-1}).kind,'refused');
  const malformed=structuredClone(source);
  malformed.constraints.find(c=>c.id==='mount:midpoint').b='mount:p1';
  assert.equal(view(malformed).status,'dependency_broken');
  assert.equal(view(malformed).profile,null);
  const conflict=structuredClone(source);
  conflict.constraints.push({id:'clash',kind:'fixed',point:'mount:mid',x:0,y:30});
  assert.equal(solveSketch(conflict).status,'conflicted');
  assert.equal(view(conflict).status,'conflicted');
  assert.equal(view(conflict).profile,null);
  assert.equal(serializeSketch(source),stamp);
});
test('executable consumer demonstrates 2D drag, dependent rebuild, undo and archive replay',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const script=fileURLToPath(new URL('../examples/offset-hole-plate.mjs',import.meta.url));
  const rows=execFileSync(process.execPath,[script],{encoding:'utf8',timeout:30000})
    .trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.step),[
    'initial','resize','drag_right_hole','reopen','undo']);
  assert.deepEqual(rows[1].holes,[
    {x:-40,y:5,radius:6},{x:40,y:-5,radius:6}
  ]);
  assert.deepEqual(rows[2].holes,[
    {x:-40,y:5,radius:6},{x:27,y:8,radius:6}
  ]);
  assert.equal(rows[3].profileId,'mount:profile');
  assert.equal(rows[3].nativeExact,false);
});
