import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNonOcctPlateTranscript} from '../nonocct-step-probe.mjs';
// Synthetic transcripts exercise the parser, not a native or independent CAD engine.
const plate={width:120,depth:80,thickness:8,holes:[{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]};
const volume=(120*80-2*Math.PI*36)*8;
const rays=[['hole.0',-30,0,0,-1,-1],['hole.1',30,0,0,-1,-1],
  ['solid.nw',-20,-80/6,2,0,8],['solid.ne',20,-80/6,2,0,8],
  ['solid.sw',-20,80/6,2,0,8],['solid.se',20,80/6,2,0,8],
  ['exterior',70,0,0,-1,-1],['central.material',0,0,2,0,8]];
const accepted=()=>rays.map(row=>'RAY '+row.join(' ')).join('\n')+'\n'+
  'ACCEPT solids=1 source_unit=millimetre imported_exact=true tris=386 open_edges=0 volume_mm3='+volume+' expected_mm3='+volume+' warnings=0\n';
test('synthetic external-receipt parser tests dimensional and coordinate anchors',()=>{
  const out=parseNonOcctPlateTranscript(accepted(),plate);
  assert.equal(out.rays.length,8);
  assert.equal(out.importedExactBrep,true);
  assert.equal(out.relativeVolumeError,0);
});
test('refuses physical rays moved without any volume change',()=>{
  assert.throws(()=>parseNonOcctPlateTranscript(accepted().replace('RAY hole.1 30 0','RAY hole.1 31 0'),plate),/ray geometry/);
});
test('refuses nonexact importer, open topology and missing rays',()=>{
  assert.throws(()=>parseNonOcctPlateTranscript(accepted().replace('imported_exact=true','imported_exact=false'),plate),/topology/);
  assert.throws(()=>parseNonOcctPlateTranscript(accepted().replace('open_edges=0','open_edges=1'),plate),/topology/);
  assert.throws(()=>parseNonOcctPlateTranscript(accepted().replace('RAY hole.0 -30 0 0 -1 -1\n',''),plate),/rays/);
});
test('refuses independently reported volume incompatible with authored dimensions',()=>{
  assert.throws(()=>parseNonOcctPlateTranscript(accepted().replace('volume_mm3='+volume,'volume_mm3=3000'),plate),/volume/);
});
