import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importAsciiDxf,renderDxfSketchSvg} from '../index.mjs';
const load=async name=>importAsciiDxf(await readFile(new URL('../fixtures/'+name,import.meta.url),'utf8'));
test('authentic 120x80 DXF renders millimetre-scale SVG with all outlines and holes',async()=>{
  const d=await load('plate-120x80.dxf'),svg=renderDxfSketchSvg(d);
  assert.match(svg,/width="130mm" height="90mm" viewBox="-5 -85 130 90"/);
  assert.equal((svg.match(/data-kind="line"/g)||[]).length,4);
  assert.equal((svg.match(/data-kind="circle"/g)||[]).length,2);
  assert.match(svg,/data-layer="OUTLINE"/);
  assert.match(svg,/data-layer="HOLES"/);
  assert.equal(svg,renderDxfSketchSvg(d));
});
test('real rounded DXF preserves all four circular arcs instead of faceting them',async()=>{
  const d=await load('rounded-120x80.dxf'),svg=renderDxfSketchSvg(d);
  assert.equal((svg.match(/data-kind="arc"/g)||[]).length,4);
  assert.equal((svg.match(/ A 8 8 0 0 0 /g)||[]).length,4);
  assert.equal((svg.match(/data-kind="circle"/g)||[]).length,2);
});
test('large CCW arc bounding box includes cardinal extrema and has correct SVG sweep',()=>{
  const d={version:1,units:'mm',sourceUnits:'mm',entities:[{
    id:'a1',kind:'arc',layer:'CURVES',center:{x:0,y:0},
    radiusMm:10,startAngleDeg:10,endAngleDeg:250
  }]};
  const svg=renderDxfSketchSvg(d,{paddingMm:0});
  assert.match(svg,/ A 10 10 0 1 0 /);
  const bounds=svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  assert.equal(bounds[0],-10); // 180° X minimum lies inside the sweep
  assert.equal(bounds[1],-10); // 90° Y maximum lies inside the sweep
  assert.ok(bounds[2]>19&&bounds[3]>19);
});
test('SVG entity labels are XML-safe; invalid rendering options reject explicitly',async()=>{
  const d=await load('plate-120x80.dxf');
  d.entities[0].layer="Fabrication & assembly's";
  assert.match(renderDxfSketchSvg(d),/Fabrication &amp; assembly&#39;s/);
  assert.throws(()=>renderDxfSketchSvg(d,{strokeWidthMm:0}),/stroke/);
  assert.throws(()=>renderDxfSketchSvg(d,{paddingMm:-2}),/padding/);
});
