import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createArcSketch,parseArcSketch,serializeArcSketch,solveArcSketch,
 editArcConstraint,editArcCircleRadius,suggestArcDrag,buildArcWirePreview,roundedPlateArcFixture
} from '../arc-constraints.mjs';
const tol=(actual,expected,eps=2e-6)=>assert.ok(Math.abs(actual-expected)<eps,String(actual)+' != '+String(expected));
const profile=s=>buildArcWirePreview(s,solveArcSketch(s),
 ['bottom','arc1','right','arc2','top','arc3','left','arc0'],['holeA','holeB']);

test('actual four-corner nonlinear radius and tangency equations solve with stable analytic curves and holes',()=>{
 const doc=roundedPlateArcFixture(),result=solveArcSketch(doc);
 assert.equal(result.status,'solved',JSON.stringify(result.diagnostics));
 assert.equal(result.degreesOfFreedom,0);
 assert.equal(result.previewOnly,true);
 assert.equal(result.exactGeometryAvailable,false);
 const p=new Map(result.geometry.points.map(p=>[p.id,p]));
 tol(p.get('arc1:center').x,112);tol(p.get('arc2:center').y,68);
 for(const a of result.geometry.arcs){
  tol(a.sweepRad,Math.PI/2);tol(a.radiusMm,[4,8,12,6][Number(a.id.at(-1))]);
 }
 const wire=profile(doc);
 assert.equal(wire.nativeProfileAdmissible,false);
 assert.deepEqual(wire.boundary.map(x=>x.kind),['line','arc','line','arc','line','arc','line','arc']);
 assert.deepEqual(wire.holes.map(h=>h.id),['holeA','holeB']);
 tol(wire.estimatedMaterialAreaMm2,9600-72*Math.PI-(1-Math.PI/4)*(4**2+8**2+12**2+6**2));
});

test('retrospective width/radius/hole edits resolve true nonlinear equations with stable profiles and archive replay',()=>{
 const original=roundedPlateArcFixture();
 const before=profile(original);
 let next=editArcConstraint(original,'plate:width',{value:150});
 next=editArcConstraint(next,'corner1:radius',{value:14});
 next=editArcCircleRadius(next,'holeA',7);
 const solved=solveArcSketch(next);
 assert.equal(solved.status,'solved',JSON.stringify(solved.diagnostics));
 const p=new Map(solved.geometry.points.map(v=>[v.id,v]));
 tol(p.get('p1').x,150);tol(p.get('arc1:center').x,136);tol(p.get('arc1:center').y,14);
 const updated=profile(next);
 assert.deepEqual(updated.boundary.map(x=>x.id),before.boundary.map(x=>x.id));
 assert.deepEqual(updated.holes.map(x=>x.id),before.holes.map(x=>x.id));
 assert.equal(updated.holes[0].radiusMm,7);
 const reopened=parseArcSketch(serializeArcSketch(next));
 assert.deepEqual(profile(reopened),updated);
 assert.deepEqual(profile(original),before);
});

test('underconstraint is observable, never admissible as a closed profile',()=>{
 const free=roundedPlateArcFixture();
 free.constraints=free.constraints.filter(c=>c.id!=='corner1:radius');
 const s=solveArcSketch(free);
 assert.equal(s.status,'underconstrained',JSON.stringify(s.diagnostics));
 assert.ok(s.degreesOfFreedom>=1);
 assert.throws(()=>buildArcWirePreview(free,s,['bottom','arc1','right','arc2','top','arc3','left','arc0']),/unsolved/);
});

test('contradictory radius dimensions preserve authored intent and return no geometry',()=>{
 const bad=roundedPlateArcFixture();
 bad.constraints.push({id:'different-radius',kind:'arcRadius',arc:'arc1',value:22});
 const s=solveArcSketch(bad);
 assert.equal(s.status,'conflicted');assert.equal(s.geometry,null);
 assert.deepEqual(s.diagnostics[0].candidates,['corner1:radius','different-radius']);
 const repaired=editArcConstraint(bad,'different-radius',{value:8});
 assert.equal(solveArcSketch(repaired).status,'solved');
});

test('materially inconsistent fixed position never claims solved or returns fabricated geometry',()=>{
 const bad=roundedPlateArcFixture();
 bad.constraints.push({id:'wrong-anchor',kind:'fixed',point:'p0',x:1,y:0});
 const s=solveArcSketch(bad);
 assert.equal(s.status,'conflicted');assert.equal(s.geometry,null);
});

test('stale/fabricated and unconnected profile requests are refused',()=>{
 const doc=roundedPlateArcFixture(),s=solveArcSketch(doc);
 const forged=structuredClone(s);forged.geometry.points[0].x=1234;
 assert.throws(()=>buildArcWirePreview(doc,forged,['bottom','arc1','right','arc2','top','arc3','left','arc0']),/modified/);
 assert.throws(()=>buildArcWirePreview(doc,s,['top','arc1','bottom']),/unconnected/);
 assert.throws(()=>buildArcWirePreview(doc,s,['bottom','arc1','right','arc2','top','arc3','left','arc0'],['ghost']),/missing circle/);
 const changed=editArcConstraint(doc,'corner1:radius',{value:9});
 assert.throws(()=>buildArcWirePreview(changed,s,['bottom','arc1','right','arc2','top','arc3','left','arc0']),/stale/);
});

test('direct drag is temporary and cannot silently move a dimensioned point',()=>{
 const doc=roundedPlateArcFixture(),before=serializeArcSketch(doc);
 const drag=suggestArcDrag(doc,'p0',{x:9,y:0});
 assert.equal(drag.previewOnly,true);
 assert.equal(drag.status,'conflicted');
 assert.equal(drag.geometry,null);
 assert.equal(serializeArcSketch(doc),before);
});

test('references, shared tangent endpoints, physical dimensions and strict schema checked',()=>{
 const doc=roundedPlateArcFixture();
 assert.throws(()=>createArcSketch({...doc,extra:'renderer'}),/invalid document/);
 assert.throws(()=>createArcSketch({...doc,arcs:[{...doc.arcs[0],start:'missing'},...doc.arcs.slice(1)]}),/invalid arc/);
 assert.throws(()=>createArcSketch({...doc,constraints:[...doc.constraints,{id:'bad-tangent',kind:'tangent',arc:'arc0',line:'right',at:'start'}]}),/share an authored point/);
 assert.throws(()=>editArcConstraint(doc,'corner1:tangent_in',{value:999}),/invalid dimension patch/);
 assert.throws(()=>editArcCircleRadius(doc,'holeA',0),/invalid circle/);
});

test('actual nonlinear residual corrects materially displaced initial curve seed rather than merely constructing a fixed fillet',()=>{
 const doc=roundedPlateArcFixture();
 doc.points.find(p=>p.id==='arc1:center').x-=2.5;
 doc.points.find(p=>p.id==='arc1:start').x+=1.2;
 doc.points.find(p=>p.id==='arc1:end').y+=1;
 const result=solveArcSketch(doc);
 assert.equal(result.status,'solved',JSON.stringify(result.diagnostics));
 const p=new Map(result.geometry.points.map(p=>[p.id,p]));
 tol(p.get('arc1:center').x,112);tol(p.get('arc1:center').y,8);
 assert.ok(result.iterations>0);
});
