import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,plateSketchFixture,parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {suggestProjectedDrag,DRAG_PROJECTION_VERSION} from '../drag-projection.mjs';

const free=()=>createSketch({version:1,units:'mm',
  points:[{id:'a',x:0,y:0},{id:'b',x:5,y:2}],lines:[],circles:[],constraints:[]});
const horizontal=()=>createSketch({version:1,units:'mm',
  points:[{id:'a',x:0,y:0},{id:'b',x:5,y:0}],
  lines:[{id:'line',start:'a',end:'b'}],circles:[],
  constraints:[{id:'anchor',kind:'fixed',point:'a',x:0,y:0},
    {id:'horizontal',kind:'horizontal',line:'line'}]});
test('free drag remains unmodified intent, no transient entities or IDs',()=>{
  const doc=free(),serialized=serializeSketch(doc);
  const r=suggestProjectedDrag(doc,'a',{x:21.5,y:-6.25});
  assert.equal(r.version,DRAG_PROJECTION_VERSION);
  assert.equal(r.status,'ready');
  assert.equal(r.previewOnly,true);
  assert.deepEqual(r.acceptedAxes,['x','y']);
  assert.deepEqual(r.resolvedTarget,{x:21.5,y:-6.25});
  assert.deepEqual(r.geometry.points.map(p=>p.id),['a','b']);
  assert.deepEqual(r.geometry.points[1],{id:'b',x:5,y:2});
  assert.equal(r.sourceSignature,serialized);
  assert.equal(serializeSketch(doc),serialized);
});
test('horizontal line projects unachievable Y while allowing X',()=>{
  const r=suggestProjectedDrag(horizontal(),'b',{x:20,y:11});
  assert.equal(r.status,'projected');
  assert.deepEqual(r.acceptedAxes,['x']);
  assert.deepEqual(r.blockedAxes,['y']);
  assert.deepEqual(r.resolvedTarget,{x:20,y:0});
  assert.equal(r.diagnostics[0].axis,'y');
});
test('constraint-consistent drag is fully admissible',()=>{
  const r=suggestProjectedDrag(horizontal(),'b',{x:32,y:0});
  assert.equal(r.status,'ready');
  assert.deepEqual(r.blockedAxes,[]);
});
test('fully constrained plate is blocked, not silently edited',()=>{
  const doc=plateSketchFixture(),r=suggestProjectedDrag(doc,'p1',{x:180,y:20});
  assert.equal(r.status,'blocked');
  assert.deepEqual(r.blockedAxes,['x','y']);
  assert.deepEqual(r.resolvedTarget,{x:120,y:0});
  assert.deepEqual(r.geometry,solveSketch(doc).geometry);
});
test('inconsistent source yields no geometry',()=>{
  const doc=free();
  doc.constraints.push({id:'c1',kind:'fixed',point:'a',x:0,y:0});
  doc.constraints.push({id:'c2',kind:'fixed',point:'a',x:1,y:0});
  const r=suggestProjectedDrag(doc,'a',{x:10,y:20});
  assert.equal(r.status,'conflicted');
  assert.equal(r.geometry,null);
  assert.equal(r.resolvedTarget,null);
});
test('transient IDs are collision-safe',()=>{
  const doc=free();
  doc.points.push({id:'dragPreview:origin:0',x:3,y:4});
  doc.constraints.push({id:'dragPreview:origin:1:lock',kind:'fixed',point:'dragPreview:origin:0',x:3,y:4});
  const r=suggestProjectedDrag(doc,'a',{x:12,y:15});
  assert.equal(r.status,'ready');
  assert.deepEqual(r.geometry.points.map(p=>p.id),doc.points.map(p=>p.id));
});
test('JSON replay has identical projection and source stamp',()=>{
  const doc=horizontal();
  const r=suggestProjectedDrag(doc,'b',{x:18,y:-3});
  assert.deepEqual(r,suggestProjectedDrag(parseSketch(serializeSketch(doc)),'b',{x:18,y:-3}));
});
test('connected points preserve authored X distance during drag',()=>{
  const doc=createSketch({version:1,units:'mm',
    points:[{id:'a',x:0,y:0},{id:'b',x:8,y:0}],
    lines:[],circles:[],constraints:[{id:'span',kind:'distanceX',a:'a',b:'b',value:8}]});
  const r=suggestProjectedDrag(doc,'a',{x:42,y:7});
  assert.equal(r.status,'ready');
  const a=r.geometry.points.find(p=>p.id==='a');
  const b=r.geometry.points.find(p=>p.id==='b');
  assert.equal(a.x,42);
  assert.equal(a.y,7);
  assert.ok(Math.abs(b.x-a.x-8)<1e-9);
});
test('invalid IDs, targets, schema fail with no document mutation',()=>{
  const doc=free(),saved=serializeSketch(doc);
  assert.throws(()=>suggestProjectedDrag(doc,'absent',{x:1,y:2}),/unknown point/);
  assert.throws(()=>suggestProjectedDrag(doc,'a',{x:Infinity,y:2}),/finite x\/y/);
  assert.throws(()=>suggestProjectedDrag(doc,'a',{x:NaN,y:2}),/finite x\/y/);
  assert.throws(()=>suggestProjectedDrag({...doc,version:2},'a',{x:1,y:2}),/unsupported version/);
  assert.equal(serializeSketch(doc),saved);
});
test('48 adversarial horizontal drag positions preserve constraint exactly',()=>{
  const doc=horizontal();
  for(const x of [-100,-1,0,0.1,8,35,1e4,1e6])
    for(const y of [-500,-1,-0.1,0.1,2,500]){
      const r=suggestProjectedDrag(doc,'b',{x,y});
      assert.equal(r.status,'projected');
      assert.deepEqual(r.resolvedTarget,{x,y:0});
      assert.deepEqual(r.blockedAxes,['y']);
    }
});
