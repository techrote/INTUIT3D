import test from 'node:test';
import assert from 'node:assert/strict';
import {plateSketchFixture,serializeSketch,parseSketch,solveSketch} from '../index.mjs';
import {createRoundedPlateIntent,serializeRoundedPlateIntent,parseRoundedPlateIntent,
  solveRoundedPlate} from '../rounded-plate.mjs';
import {inspectRoundedPlateHandles,editRoundedPlateHandle} from '../rounded-plate-handles.mjs';
const initial=()=>({sketch:plateSketchFixture(),intent:createRoundedPlateIntent({
  version:1,id:'fillet:plate',edgeIds:['bottom','right','top','left'],
  holeIds:['holeA','holeB'],radiusMm:8
})});
const preview=(sketch,intent)=>inspectRoundedPlateHandles(sketch,intent);
const move=(sketch,intent,id,target)=>{
  const handles=preview(sketch,intent);
  return editRoundedPlateHandle(sketch,intent,{version:1,handleId:id,target,
    expectedSketchSignature:handles.sketchSignature,
    expectedIntentSignature:handles.intentSignature});
};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,a+' != '+b);

test('discovered dimensions, four analytic corners and hole controls are bound to authored constraints',()=>{
  const {sketch,intent}=initial();
  const r=preview(sketch,intent);
  assert.equal(r.status,'solved');
  assert.equal(r.geometry.previewOnly,true);
  assert.equal(r.handles.length,10);
  assert.deepEqual(r.handles.filter(x=>x.kind==='dimension').map(x=>x.id),
    ['dimension:width','dimension:height']);
  assert.deepEqual(r.handles.filter(x=>x.kind==='corner_radius').map(x=>x.id),
    ['corner-radius:p1','corner-radius:p2','corner-radius:p3','corner-radius:p0']);
  assert.deepEqual(r.handles.filter(x=>x.kind==='hole_center').map(x=>x.id),
    ['hole-center:holeA','hole-center:holeB']);
  assert.deepEqual(r.handles.filter(x=>x.kind==='hole_radius').map(x=>x.id),
    ['hole-radius:holeA','hole-radius:holeB']);
  assert.equal(r.sketchSignature,serializeSketch(sketch));
  assert.equal(r.intentSignature,serializeRoundedPlateIntent(intent));
});

test('pointer width -> corner fillet -> hole center and radius author edits and preserve IDs',()=>{
  let {sketch,intent}=initial();
  const before=preview(sketch,intent);
  for(const [id,target] of [
    ['dimension:width',{x:150,y:200}],
    ['corner-radius:p1',{x:138,y:0}],
    ['hole-center:holeA',{x:40,y:40}],
    ['hole-radius:holeA',{x:47,y:-200}]
  ]){
    const r=move(sketch,intent,id,target);
    assert.equal(r.status,'solved',id+': '+JSON.stringify(r.diagnostics));
    assert.ok(r.sketch&&r.intent);
    assert.equal(r.previewOnly,true);
    assert.ok(r.projection.deviationMm>=0);
    sketch=r.sketch;intent=r.intent;
  }
  assert.equal(solveSketch(sketch).status,'solved');
  assert.equal(sketch.constraints.find(c=>c.id==='width').value,150);
  assert.equal(sketch.constraints.find(c=>c.id==='holeA:fixed').x,40);
  assert.equal(sketch.constraints.find(c=>c.id==='holeA:diameter').value,7);
  assert.equal(intent.radiusMm,12);
  const after=preview(sketch,intent);
  assert.deepEqual(after.handles.map(h=>h.id),before.handles.map(h=>h.id));
  assert.deepEqual(after.geometry.boundary.map(e=>e.id),before.geometry.boundary.map(e=>e.id));
  assert.deepEqual(after.geometry.holes.map(h=>h.id),before.geometry.holes.map(h=>h.id));
  close(after.geometry.areaMm2,150*80-Math.PI*(7*7+6*6)-(4-Math.PI)*12*12);
  assert.equal(after.geometry.status,'analytic_curved_profile_only');
});

test('a dimension drag can retain a contradictory authored value without invented geometry, then undo',()=>{
  const {sketch,intent}=initial();
  const candidate=move(sketch,intent,'dimension:width',{x:14,y:0});
  assert.equal(candidate.status,'conflicted');
  assert.equal(candidate.geometry,null);
  assert.equal(candidate.sketch.constraints.find(c=>c.id==='width').value,14);
  assert.equal(solveRoundedPlate(candidate.sketch,candidate.intent).status,'conflicted');
  assert.equal(preview(candidate.sketch,candidate.intent).handles.length,0);
  // Undo is owned by the model journal; restoring its archived sketch/intent
  // does not lose the four stable fillet arc IDs.
  assert.deepEqual(preview(parseSketch(serializeSketch(sketch)),
    parseRoundedPlateIntent(serializeRoundedPlateIntent(intent))).geometry,
    preview(sketch,intent).geometry);
});

test('hole moving into a rounded corner fails closed; source is not mutated',()=>{
  const {sketch,intent}=initial();
  const source=serializeSketch(sketch);
  const candidate=move(sketch,intent,'hole-center:holeA',{x:6.5,y:6.5});
  assert.equal(candidate.status,'conflicted');
  assert.equal(candidate.geometry,null);
  assert.match(candidate.diagnostics[0].message,/rounded boundary/);
  assert.equal(serializeSketch(sketch),source);
  assert.equal(move(sketch,intent,'hole-center:holeA',{x:40,y:40}).status,'solved');
});

test('stale pointer revisions are rejected; zero radius is a visible non-commit',()=>{
  const {sketch,intent}=initial();
  const old=preview(sketch,intent);
  const next=move(sketch,intent,'dimension:width',{x:140,y:0});
  assert.throws(()=>editRoundedPlateHandle(next.sketch,intent,{
    version:1,handleId:'dimension:width',target:{x:150,y:0},
    expectedSketchSignature:old.sketchSignature,
    expectedIntentSignature:old.intentSignature
  }),/stale edit/);
  const rejected=move(sketch,intent,'corner-radius:p1',{x:120,y:0});
  assert.equal(rejected.status,'rejected');
  assert.equal(rejected.sketch,null);
  assert.equal(rejected.intent,null);
  assert.equal(rejected.geometry,null);
  assert.equal(preview(sketch,intent).status,'solved');
});

test('authored underconstraint suppresses edit handles rather than manufacturing solver authority',()=>{
  const {sketch,intent}=initial();
  sketch.constraints=sketch.constraints.filter(c=>c.id!=='width');
  const v=preview(sketch,intent);
  assert.equal(v.status,'underconstrained');
  assert.equal(v.handles.length,0);
  assert.equal(v.geometry,null);
  assert.throws(()=>editRoundedPlateHandle(sketch,intent,{
    version:1,handleId:'corner-radius:p1',target:{x:110,y:0},
    expectedSketchSignature:v.sketchSignature,expectedIntentSignature:v.intentSignature
  }),/solve authored constraints/);
});

test('fully edited geometry survives save/reopen and supports another retrospective handle edit',()=>{
  let {sketch,intent}=initial();
  ({sketch,intent}=move(sketch,intent,'dimension:height',{x:120,y:96}));
  ({sketch,intent}=move(sketch,intent,'corner-radius:p1',{x:110,y:0}));
  const archive=JSON.stringify({
    sketch:serializeSketch(sketch),intent:serializeRoundedPlateIntent(intent)
  });
  const doc=JSON.parse(archive);
  const a=preview(sketch,intent);
  const b=preview(parseSketch(doc.sketch),parseRoundedPlateIntent(doc.intent));
  assert.deepEqual(a,b);
  const later=move(parseSketch(doc.sketch),parseRoundedPlateIntent(doc.intent),
    'dimension:width',{x:160,y:0});
  assert.equal(later.status,'solved');
  assert.equal(later.sketch.constraints.find(c=>c.id==='width').value,160);
  assert.equal(later.intent.radiusMm,10);
});
