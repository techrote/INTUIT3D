import test from 'node:test';
import assert from 'node:assert/strict';
import {createObroundSlot,inspectObroundSlot,editObroundSlot}
  from '../obround-slot.mjs';
import {serializeArcSketch,parseArcSketch,solveArcSketch} from '../arc-constraints.mjs';

const input={id:'slotA',overallLengthMm:60,diameterMm:12};
const shape=doc=>({points:doc.points.map(p=>p.id),arcs:doc.arcs.map(a=>a.id),
  lines:doc.lines.map(l=>l.id),constraints:doc.constraints.map(c=>c.id)});
const area=(L,D)=>(L-D)*D+Math.PI*(D/2)**2;

test('obround is a genuinely solved tangent semicircular profile with exact analytic area',()=>{
  const doc=createObroundSlot(input),solved=solveArcSketch(doc);
  assert.equal(solved.status,'solved',JSON.stringify(solved.diagnostics));
  assert.equal(solved.degreesOfFreedom,0);
  const report=inspectObroundSlot(doc,'slotA');
  assert.equal(report.status,'solved');
  assert.equal(report.profile.boundary.length,4);
  assert.deepEqual(report.profile.boundary.map(c=>c.kind),
    ['line','arc','line','arc']);
  assert.equal(report.profile.providerSubmissionReady,true);
  assert.equal(report.profile.nativeProfileAdmissible,false);
  assert.equal(report.profile.exactBrepAvailable,false);
  assert.equal(report.profile.stepQualified,false);
  assert.ok(Math.abs(report.profile.materialAreaMm2-area(60,12))<1e-7);
});
test('resize and move keep semantic curve IDs through save/reopen and replay',()=>{
  const original=createObroundSlot(input),before=serializeArcSketch(original);
  const a=editObroundSlot(original,'slotA',
    {kind:'resize',overallLengthMm:80,diameterMm:16},before);
  assert.equal(a.kind,'accepted',a.reason);
  assert.deepEqual(shape(a.sketch),shape(original));
  assert.ok(Math.abs(a.profile.materialAreaMm2-area(80,16))<1e-7);
  const b=editObroundSlot(a.sketch,'slotA',
    {kind:'move',originXmm:25,originYmm:-10},a.sourceSignature);
  assert.equal(b.kind,'accepted',b.reason);
  const reopened=parseArcSketch(serializeArcSketch(b.sketch));
  assert.equal(inspectObroundSlot(reopened,'slotA').profile.materialAreaMm2,
    b.profile.materialAreaMm2);
  assert.deepEqual(shape(reopened),shape(original));
  assert.equal(serializeArcSketch(original),before);
  const replay=editObroundSlot(original,'slotA',
    {kind:'resize',overallLengthMm:80,diameterMm:16},before);
  assert.equal(serializeArcSketch(replay.sketch),serializeArcSketch(a.sketch));
});
test('nonpositive, collapsed or malformed edits fail atomically',()=>{
  const doc=createObroundSlot(input),stamp=serializeArcSketch(doc);
  for(const command of [
    {kind:'resize',overallLengthMm:12,diameterMm:12},
    {kind:'resize',overallLengthMm:10,diameterMm:12},
    {kind:'resize',overallLengthMm:60,diameterMm:0},
    {kind:'resize',overallLengthMm:NaN,diameterMm:4},
    {kind:'move',originXmm:Infinity,originYmm:0},
    {kind:'resize',overallLengthMm:80,diameterMm:16,dropConstraints:true}
  ]){
    assert.equal(editObroundSlot(doc,'slotA',command,stamp).kind,'refused');
    assert.equal(serializeArcSketch(doc),stamp);
  }
  assert.equal(editObroundSlot(doc,'slotA',
    {kind:'resize',overallLengthMm:65,diameterMm:12},'stale').kind,'refused');
  assert.throws(()=>createObroundSlot({...input,overallLengthMm:12}),
    /longer finite slot/);
});
test('independently authored extra constraints never vanish in slot template edit',()=>{
  const doc=createObroundSlot(input);
  doc.constraints.push({id:'user:lock',kind:'fixed',point:'slotA:left-center',x:9,y:6});
  const stamp=serializeArcSketch(doc);
  assert.equal(solveArcSketch(doc).status,'conflicted');
  const result=editObroundSlot(doc,'slotA',
    {kind:'resize',overallLengthMm:90,diameterMm:14},stamp);
  assert.equal(result.kind,'refused');
  assert.match(result.reason,/independent authored edits/);
  assert.equal(serializeArcSketch(doc),stamp);
});
test('public example executes changed dimension, replay and rejected collapse',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const script=fileURLToPath(new URL('../examples/obround-slot.mjs',import.meta.url));
  const rows=execFileSync(process.execPath,[script],
    {encoding:'utf8',timeout:30000}).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.step),['created','resized','moved-reopened','refused']);
  assert.equal(rows[1].solved,true);
  assert.equal(rows[2].nativeExact,false);
  assert.equal(rows[3].kind,'refused');
});
