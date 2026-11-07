import test from 'node:test';
import assert from 'node:assert/strict';
import {solveSketch,parseSketch,serializeSketch} from '../index.mjs';
import {createCenteredHolePlate,inspectCenteredHolePlate,
  editCenteredHolePlateDimension,dragCenteredHolePlateHandle} from '../centered-hole-plate.mjs';

const initial=()=>createCenteredHolePlate({
  id:'mounting',widthMm:120,heightMm:80,leftInsetMm:35,rightInsetMm:35,
  holeARadiusMm:6,holeBRadiusMm:6
});
const view=doc=>inspectCenteredHolePlate(doc,'mounting');
const edit=(doc,dimension,valueMm)=>editCenteredHolePlateDimension(doc,'mounting',{
  version:1,expectedSignature:serializeSketch(doc),dimension,valueMm
});
const ids=doc=>({
  points:doc.points.map(p=>p.id),lines:doc.lines.map(l=>l.id),
  circles:doc.circles.map(c=>c.id),constraints:doc.constraints.map(c=>c.id)
});
const points=doc=>new Map(view(doc).solution.geometry.points.map(p=>[p.id,p]));

test('true midpoint-constrained two-hole plate is solved and profile-admitted',()=>{
  const doc=initial(),v=view(doc),p=points(doc);
  assert.equal(v.status,'solved');
  assert.equal(v.solution.degreesOfFreedom,0);
  assert.equal(v.profile.status,'analytic_profile_only');
  assert.equal(v.profileId,'mounting:profile');
  assert.equal(v.profile.holes.length,2);
  assert.equal(v.previewOnly,true);
  assert.equal(v.nativeExact,false);
  assert.deepEqual([
    p.get('mounting:holeA:center').x,p.get('mounting:holeA:center').y,
    p.get('mounting:holeB:center').x,p.get('mounting:holeB:center').y,
    p.get('mounting:mid').y],[35,40,85,40,40]);
  assert.ok(Math.abs(v.profile.areaMm2-(9600-72*Math.PI))<1e-8);
  assert.deepEqual(v.handles.map(h=>h.dimension),[
    'widthMm','heightMm','leftInsetMm','rightInsetMm',
    'holeARadiusMm','holeBRadiusMm']);
});
test('retrospective width/height changes physically relocate the dependent hole centres',()=>{
  const source=initial(),originalIds=ids(source);
  const width=edit(source,'widthMm',150);
  assert.equal(width.kind,'accepted');
  assert.equal(width.status,'solved');
  let p=points(width.sketch);
  assert.deepEqual([p.get('mounting:holeA:center').x,p.get('mounting:holeB:center').x],[35,115]);
  const height=edit(width.sketch,'heightMm',100);
  assert.equal(height.kind,'accepted');
  assert.equal(height.status,'solved');
  p=points(height.sketch);
  assert.deepEqual([p.get('mounting:holeA:center').y,p.get('mounting:holeB:center').y],[50,50]);
  assert.deepEqual(ids(height.sketch),originalIds);
  assert.equal(height.profile.holes[0].id,'mounting:holeA');
  assert.ok(Math.abs(height.profile.areaMm2-(15000-72*Math.PI))<1e-8);
  const reopen=parseSketch(serializeSketch(height.sketch));
  assert.deepEqual(view(reopen),view(height.sketch));
  assert.deepEqual(ids(reopen),ids(source));
});
test('pointer drag edits an authored right edge inset without moving the shared centreline',()=>{
  const source=initial(),stamp=serializeSketch(source),initialView=view(source);
  const dragged=dragCenteredHolePlateHandle(source,'mounting',{
    version:1,expectedSignature:stamp,
    handleId:'mounting:handle:rightInsetMm',target:{x:100,y:900}
  });
  assert.equal(dragged.kind,'accepted');
  assert.equal(dragged.status,'solved');
  assert.equal(dragged.dimensions.rightInsetMm,20);
  const p=points(dragged.sketch);
  assert.deepEqual([p.get('mounting:holeA:center').x,p.get('mounting:holeB:center').x],[35,100]);
  assert.deepEqual(dragged.gesture.appliedPoint,{x:100,y:40});
  assert.equal(dragged.gesture.deviationMm,860);
  assert.equal(serializeSketch(source),stamp);
  assert.deepEqual(view(dragged.sketch).handles.map(h=>h.id),
    initialView.handles.map(h=>h.id));
});
test('solver distinguishes missing midpoint dependency, redundancy and contradiction',()=>{
  const doc=initial();
  const loose=structuredClone(doc);
  loose.constraints=loose.constraints.filter(c=>c.id!=='mounting:midpoint');
  assert.equal(solveSketch(loose).status,'underconstrained');
  assert.equal(view(loose).status,'dependency_broken');
  assert.equal(view(loose).profile,null);
  const redundant=structuredClone(doc);
  redundant.constraints.push({id:'confirm-mid',kind:'fixed',
    point:'mounting:mid',x:0,y:40});
  assert.equal(solveSketch(redundant).status,'solved');
  assert.ok(solveSketch(redundant).redundantEquations>0);
  const conflict=structuredClone(doc);
  conflict.constraints.push({id:'misplaced-mid',kind:'fixed',
    point:'mounting:mid',x:0,y:41});
  assert.equal(solveSketch(conflict).status,'conflicted');
  assert.equal(view(conflict).status,'conflicted');
  assert.equal(view(conflict).profile,null);
  assert.equal(view(conflict).handles.length,0);
  conflict.constraints=conflict.constraints.filter(c=>c.id!=='misplaced-mid');
  assert.equal(view(conflict).status,'solved');
});
test('dimensioned but physically invalid holes stay editable and recoverable',()=>{
  const doc=initial(),signature=serializeSketch(doc);
  const invalid=edit(doc,'widthMm',40);
  assert.equal(invalid.kind,'accepted');
  assert.equal(invalid.status,'profile_rejected');
  assert.equal(invalid.profile,null);
  assert.equal(invalid.handles.length,0);
  assert.equal(invalid.nativeExact,false);
  const recovered=edit(invalid.sketch,'widthMm',150);
  assert.equal(recovered.kind,'accepted');
  assert.equal(recovered.status,'solved');
  assert.deepEqual(ids(recovered.sketch),ids(doc));
  assert.equal(serializeSketch(doc),signature);
});
test('stale, unknown and nonpositive edits refuse without mutation',()=>{
  const doc=initial(),before=serializeSketch(doc);
  assert.equal(editCenteredHolePlateDimension(doc,'mounting',{
    version:1,expectedSignature:'stale',dimension:'widthMm',valueMm:150
  }).kind,'refused');
  assert.equal(edit(doc,'holeARadiusMm',-2).kind,'refused');
  assert.equal(edit(doc,'unknownDimension',20).kind,'refused');
  assert.equal(serializeSketch(doc),before);
});
test('midpoint validates semantic references instead of trusting seed positions',()=>{
  const doc=initial();
  for(const patch of [
    {point:'mounting:p0'}, {a:'mounting:p0',b:'mounting:p0'}, {b:'unknown'}
  ]){
    const bad=structuredClone(doc);
    const index=bad.constraints.findIndex(c=>c.id==='mounting:midpoint');
    bad.constraints[index]={...bad.constraints[index],...patch};
    assert.throws(()=>solveSketch(bad),/bad midpoint constraint/);
  }
});
test('public example shows create, edit, drag, undo and reopen, without claiming STEP',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const script=fileURLToPath(new URL('../examples/centered-hole-plate.mjs',import.meta.url));
  const rows=execFileSync(process.execPath,[script],{encoding:'utf8',timeout:30000})
    .trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.step),[
    'initial','width','height','radius','drag','reopen','undo']);
  assert.equal(rows[2].holeB.x,115);
  assert.equal(rows[2].holeB.y,50);
  assert.equal(rows[5].nativeExact,false);
});
