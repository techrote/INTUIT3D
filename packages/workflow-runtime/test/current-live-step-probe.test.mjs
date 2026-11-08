/** Synthetic process contract tests; NOT evidence of an independent CAD engine. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyCurrentLivePlateStep} from '../nonocct-step-probe.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const plate={width:120,depth:80,thickness:8,
  holes:[{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]};
const volume=(120*80-2*Math.PI*36)*8;
const rays=[['hole.0',-30,0,0,-1,-1],['hole.1',30,0,0,-1,-1],
  ['solid.nw',-20,-80/6,2,0,8],['solid.ne',20,-80/6,2,0,8],
  ['solid.sw',-20,80/6,2,0,8],['solid.se',20,80/6,2,0,8],
  ['exterior',70,0,0,-1,-1],['central.material',0,0,2,0,8]];
// The real AnvilCAD V1 physical importer emits eight additional
// radial wall samples for each admitted bore, after the stock rays.
for(const [i,h] of plate.holes.entries()) {
  const delta=Math.min(h.radius*0.15,0.75);
  for(const [direction,dx,dy] of [
    ['east',1,0],['west',-1,0],['north',0,-1],['south',0,1],
  ]) {
    rays.push(['hole.'+i+'.inner.'+direction,
      h.x+dx*(h.radius-delta),h.y+dy*(h.radius-delta),0,-1,-1]);
    rays.push(['hole.'+i+'.outer.'+direction,
      h.x+dx*(h.radius+delta),h.y+dy*(h.radius+delta),2,0,8]);
  }
}
function fixture(){
  const archive='{"projectId":"sample.project","revision":2}';
  const bytes=Uint8Array.from(Buffer.from('SYNTHETIC_NOT_REAL_STEP'));
  const hash=sha(bytes);
  const source={projectId:'sample.project',revision:2,
    archiveSha256:sha(Buffer.from(archive))};
  const evaluation={kind:'experimental_plate_evaluated',source,
    exactAuthority:false,independentInteroperability:false,
    result:{backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
      intendedPlate:plate,part21Audit:{kind:'part21-plate-structural-v1',sha256:hash}},
    step:{bytes,sha256:hash,verification:'occt8_part21_plate_subset'}};
  let saved=archive,revision=2,current=evaluation.step;
  const session={
    refresh:()=>({projectId:source.projectId,revision}),
    save:()=>saved,
    currentStep:()=>current&&{...current,bytes:Uint8Array.from(current.bytes)},
  };
  return {evaluation,session,change:()=>{revision++;saved+=' ';current=null;},
    swap:()=>{const other=Uint8Array.from(Buffer.from('SYNTHETIC_DIFFERENT'));
      current={...current,bytes:other,sha256:sha(other)};}};
}
test('stale archive, changed STEP and missing audit refuse before executing a probe',async()=>{
  const options={probeExecutable:'/not/installed',expectedProbeSha256:'a'.repeat(64)};
  const a=fixture();a.change();
  await assert.rejects(()=>verifyCurrentLivePlateStep({
    ...options,session:a.session,evaluation:a.evaluation,
  }),/stale live CAD revision/);
  const b=fixture();b.swap();
  await assert.rejects(()=>verifyCurrentLivePlateStep({
    ...options,session:b.session,evaluation:b.evaluation,
  }),/stale live CAD revision/);
  const c=fixture();c.evaluation.result.part21Audit.sha256='0'.repeat(64);
  await assert.rejects(()=>verifyCurrentLivePlateStep({
    ...options,session:c.session,evaluation:c.evaluation,
  }),/pinned source/);
});
test('POSIX synthetic external process checks current receipt, rejects an edit while importing',
  {skip:process.platform==='win32'},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'intuit-current-step-'));
  try {
    const lines=[...rays.map(row=>'RAY '+row.join(' ')),
      'ACCEPT solids=1 source_unit=millimetre imported_exact=true tris=386 open_edges=0 volume_mm3='+
      volume+' expected_mm3='+volume+' warnings=0'];
    const script='#!/bin/sh\nset -eu\n[ "$#" -eq 5 ]\nsleep 0.2\nprintf "%s\\n" '+
      lines.map(line=>"'"+line+"'").join(' ')+'\n';
    const path=join(folder,'synthetic_probe');
    await writeFile(path,script,{mode:0o700});
    const opts={probeExecutable:path,expectedProbeSha256:sha(Buffer.from(script)),
      timeoutMs:3000};
    const first=fixture();
    const outcome=await verifyCurrentLivePlateStep({
      ...opts,session:first.session,evaluation:first.evaluation,
    });
    assert.equal(outcome.kind,'executed_current_live_plate_nonocct_sample');
    assert.equal(outcome.stepSha256,first.evaluation.step.sha256);
    assert.equal(outcome.sample.rays.length,24);
    assert.equal(outcome.exactAuthority,false);
    assert.equal(outcome.independentInteroperability,false);
    const second=fixture();
    const ongoing=verifyCurrentLivePlateStep({
      ...opts,session:second.session,evaluation:second.evaluation,
    });
    await new Promise(resolve=>setTimeout(resolve,60));
    second.change();
    await assert.rejects(ongoing,/stale live CAD revision/);
  }finally{await rm(folder,{recursive:true,force:true});}
});
