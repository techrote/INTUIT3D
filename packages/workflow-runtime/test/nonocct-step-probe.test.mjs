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

test('POSIX-only synthetic executable exercises source-matched STEP bytes, subprocess, provenance fences', {skip:process.platform==='win32'}, async()=>{
  const {runNonOcctPlateProbe}=await import('../nonocct-step-probe.mjs');
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {createHash}=await import('node:crypto');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const folder=await mkdtemp(join(tmpdir(),'intuit-runtime-probe-double-'));
  try {
    // An intentionally synthetic executable. It is NOT an AnvilCAD qualification.
    const fake=join(folder,'synthetic-nonocct-standin');
    const reply=accepted().trim().split('\n');
    const script='#!/bin/sh\nset -eu\n[ "$#" -eq 5 ]\ngrep -q SYNTHETIC_TEST_STEP "$1"\nprintf "%s\\n" '+
      reply.map(line=>"'"+line+"'").join(' ')+'\n';
    await writeFile(fake,script,{mode:0o700});
    const stepBytes=Uint8Array.from(Buffer.from('SYNTHETIC_TEST_STEP'));
    const step={bytes:stepBytes,sha256:hash(stepBytes),
      verification:'occt8_part21_plate_subset'};
    const source={projectId:'synthetic.project',revision:3,
      archiveSha256:'a'.repeat(64)};
    const opts={probeExecutable:fake,expectedProbeSha256:hash(Buffer.from(script)),
      step,plate,source};
    const result=await runNonOcctPlateProbe(opts);
    assert.equal(result.kind,'executed_nonocct_plate_sample');
    assert.equal(result.stepSha256,step.sha256);
    assert.equal(result.probeSha256,opts.expectedProbeSha256);
    assert.equal(result.source.revision,3);
    assert.equal(result.exactAuthority,false);
    assert.equal(result.independentInteroperability,false);
    assert.equal(result.sample.rays.length,8);
    await assert.rejects(()=>runNonOcctPlateProbe({
      ...opts,expectedProbeSha256:'0'.repeat(64)}),/binary digest/);
    stepBytes[0]^=1;
    await assert.rejects(()=>runNonOcctPlateProbe(opts),/STEP changed/);
  } finally {await rm(folder,{recursive:true,force:true});}
});
