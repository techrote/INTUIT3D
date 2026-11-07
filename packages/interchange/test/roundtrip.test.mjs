import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 importAsciiDxf,exportAsciiDxf,toLinearSketch,toArcSketch,
 exportSolvedSketch,sketchImportPreview,DxfInterchangeError
} from '../index.mjs';
import {solveSketch,editConstraint,buildPlateProfile} from '../../sketch/index.mjs';
import {solveArcSketch} from '../../sketch/arc-constraints.mjs';
const load=async name=>readFile(new URL('../fixtures/'+name,import.meta.url),'utf8');
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,a+' != '+b);
test('actual ASCII polyline plate: real linear SKETCH solve, analytic profile, edit, reimport',async()=>{
  const d=importAsciiDxf(await load('plate-120x80.dxf'));
  assert.equal(d.sourceUnits,'mm');assert.equal(d.entities.length,6);
  assert.equal(d.entities.filter(e=>e.kind==='line').length,4);
  assert.deepEqual(d.entities.filter(e=>e.kind==='circle').map(e=>e.radiusMm),[6,6]);
  const a=toLinearSketch(d),base=solveSketch(a.document);
  assert.equal(base.status,'solved');
  near(buildPlateProfile(a.document,base,a.document.lines.map(l=>l.id),a.document.circles.map(c=>c.id)).areaMm2,
    9600-2*Math.PI*36);
  let edit=editConstraint(a.document,'fixed:'+a.document.lines[0].end,{x:150});
  edit=editConstraint(edit,'fixed:'+a.document.lines[1].end,{x:150});
  edit=editConstraint(edit,'radius:'+a.document.circles[0].id,{value:7});
  const sol=solveSketch(edit);assert.equal(sol.status,'solved');
  const profile=buildPlateProfile(edit,sol,edit.lines.map(l=>l.id),edit.circles.map(c=>c.id));
  near(profile.areaMm2,12000-Math.PI*(49+36));
  const exported=exportAsciiDxf(exportSolvedSketch(a,edit,sol));
  const reimport=importAsciiDxf(exported),again=toLinearSketch(reimport);
  assert.equal(solveSketch(again.document).status,'solved');
  assert.equal(Math.max(...reimport.entities.filter(x=>x.kind==='line').flatMap(x=>[x.start.x,x.end.x])),150);
  assert.deepEqual(reimport.entities.filter(e=>e.kind==='circle').map(e=>e.radiusMm),[7,6]);
  assert.deepEqual(reimport.entities.map(e=>e.layer),d.entities.map(e=>e.layer));
  assert.throws(()=>exportSolvedSketch(a,a.document,sol),/stale|modified/);
  assert.equal(sketchImportPreview(d).providerSubmissionReady,false);
});
test('real bulged rounded plate: 4 analytic circular arcs, actual nonlinear SKETCH solver, roundtrip',async()=>{
  const d=importAsciiDxf(await load('rounded-120x80.dxf'));
  assert.equal(d.entities.length,10);
  const arcs=d.entities.filter(e=>e.kind==='arc');
  assert.equal(arcs.length,4);
  for(const a of arcs){near(a.radiusMm,8,1e-12);
    near(((a.endAngleDeg-a.startAngleDeg)%360+360)%360,90,1e-9);}
  assert.throws(()=>toLinearSketch(d),/cannot contain analytic arcs/);
  const a=toArcSketch(d),sol=solveArcSketch(a.document);
  assert.equal(sol.status,'solved',JSON.stringify(sol.diagnostics));
  const next=importAsciiDxf(exportAsciiDxf(exportSolvedSketch(a,a.document,sol)));
  assert.equal(next.entities.filter(e=>e.kind==='arc').length,4);
  assert.equal(next.entities.filter(e=>e.kind==='circle').length,2);
  assert.equal(solveArcSketch(toArcSketch(next).document).status,'solved');
});
test('explicit inch conversion and source layer names survive geometry roundtrip',async()=>{
  const mm=importAsciiDxf(await load('plate-120x80.dxf'));
  const inch=importAsciiDxf(exportAsciiDxf(mm,{units:'in'}));
  assert.equal(inch.sourceUnits,'in');
  near(inch.entities[0].end.x,120);
  near(inch.entities[4].radiusMm,6);
  assert.equal(inch.entities[0].layer,'OUTLINE');
  assert.equal(inch.entities[4].layer,'HOLES');
  assert.match(exportAsciiDxf(inch),/\$INSUNITS\r\n70\r\n1/);
});
test('fail closed on material unsupported/units/nonplanar/invalid-polyline inputs',async()=>{
  const s=await load('plate-120x80.dxf');
  assert.throws(()=>importAsciiDxf(s.replace('LWPOLYLINE','INSERT')),
    e=>e instanceof DxfInterchangeError&&e.code==='unsupported_entity');
  assert.throws(()=>importAsciiDxf(s.replace('$INSUNITS','NOTUNITS')),
    e=>e instanceof DxfInterchangeError&&e.code==='missing_units');
  assert.throws(()=>importAsciiDxf(s.replace('70\r\n4','70\r\n0')),
    e=>e instanceof DxfInterchangeError&&e.code==='missing_units');
  assert.throws(()=>importAsciiDxf(s.replace('70\r\n1','70\r\n0')),
    e=>e instanceof DxfInterchangeError&&e.code==='unsupported_polyline');
  assert.throws(()=>importAsciiDxf(s.replace('40\r\n6','30\r\n1\r\n40\r\n6')),
    e=>e instanceof DxfInterchangeError&&e.code==='nonplanar_entity');
  assert.throws(()=>importAsciiDxf(s.replace('10\r\n120','10\r\nnot-a-number')),
    e=>e instanceof DxfInterchangeError&&e.code==='invalid_number');
});
