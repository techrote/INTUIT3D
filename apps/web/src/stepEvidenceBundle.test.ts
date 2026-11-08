import test from 'node:test';
import assert from 'node:assert/strict';
import type {CurrentStepEvidenceCapture} from '@intuit3d/workflow-runtime/live-plate-session';
import {buildPinnedStepEvidenceZip,evidenceCrc32,pinnedStepEvidenceFilename} from './stepEvidenceBundle.ts';

const enc=new TextEncoder(),dec=new TextDecoder();
function fixture():CurrentStepEvidenceCapture {
  const archive='{"format":"intuit3d.model-archive","project":"private.local","revision":11}';
  return {
    format:'intuit3d.current-step-evidence-capture',version:1,
    archive,exactAuthority:false,independentInteroperability:false,
    receipt:{
      format:'intuit3d.source-bound-step-receipt',version:1,
      source:{projectId:'private.local',revision:11,archiveSha256:'a'.repeat(64)},
      producer:{requestId:'native.11',cutFeatureId:'cut',backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1'},
      step:{filename:'model.step',sha256:'b'.repeat(64),
        verification:{sourceMatched:true}} as CurrentStepEvidenceCapture['receipt']['step'],
      exactAuthority:false,independentInteroperability:false,
    },
    stepBytes:new Uint8Array([0,13,10,255,0,1,127]),
  };
}

/** Read ZIP store independently of the production encoder. */
function readZip(bytes:Uint8Array):Map<string,Uint8Array> {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=(i:number)=>view.getUint16(i,true),u32=(i:number)=>view.getUint32(i,true);
  const files=new Map<string,Uint8Array>();
  let cursor=0;
  while(u32(cursor)===0x04034b50){
    assert.equal(u16(cursor+8),0,'members must be uncompressed');
    assert.equal(u16(cursor+6),0x0800,'UTF-8 filenames');
    const size=u32(cursor+18),nameLength=u16(cursor+26),extra=u16(cursor+28);
    assert.equal(size,u32(cursor+22));
    const name=dec.decode(bytes.subarray(cursor+30,cursor+30+nameLength));
    const start=cursor+30+nameLength+extra,end=start+size;
    const payload=bytes.slice(start,end);
    assert.equal(evidenceCrc32(payload),u32(cursor+14));
    assert.equal(files.has(name),false);
    files.set(name,payload);
    cursor=end;
  }
  const centralStart=cursor;
  for (const [name,data] of files){
    assert.equal(u32(cursor),0x02014b50);
    assert.equal(u16(cursor+10),0);
    assert.equal(u32(cursor+20),data.length);
    const nameLength=u16(cursor+28),extra=u16(cursor+30),comment=u16(cursor+32);
    assert.equal(dec.decode(bytes.subarray(cursor+46,cursor+46+nameLength)),name);
    cursor+=46+nameLength+extra+comment;
  }
  assert.equal(u32(cursor),0x06054b50);
  assert.equal(u16(cursor+8),files.size);
  assert.equal(u16(cursor+10),files.size);
  assert.equal(u32(cursor+12),cursor-centralStart);
  assert.equal(u32(cursor+16),centralStart);
  assert.equal(cursor+22,bytes.length);
  return files;
}

test('one immutable RUNTIME capture becomes three exact independent-custody files',()=>{
  const capture=fixture();
  const original=Uint8Array.from(capture.stepBytes);
  const zip=buildPinnedStepEvidenceZip(capture);
  const files=readZip(zip);
  assert.deepEqual([...files.keys()],
    ['current.archive.json','current.receipt.json','current.step']);
  assert.equal(dec.decode(files.get('current.archive.json')!),capture.archive);
  assert.deepEqual(JSON.parse(dec.decode(files.get('current.receipt.json')!)),capture.receipt);
  assert.deepEqual(files.get('current.step'),original);
  assert.equal(JSON.stringify(capture.receipt).includes('"bytes"'),false);
  assert.equal(zip.byteLength,buildPinnedStepEvidenceZip(capture).byteLength);
  assert.deepEqual(zip,buildPinnedStepEvidenceZip(capture),'deterministic ZIP');
});

test('refuses synthetic/OCP, missing, malformed or falsely exact provenance',()=>{
  const valid=fixture(),bad=(override:object)=>({...valid,...override} as CurrentStepEvidenceCapture);
  assert.throws(()=>buildPinnedStepEvidenceZip(null as unknown as CurrentStepEvidenceCapture));
  assert.throws(()=>buildPinnedStepEvidenceZip(bad({format:'untrusted'})));
  assert.throws(()=>buildPinnedStepEvidenceZip(bad({stepBytes:new Uint8Array()})));
  assert.throws(()=>buildPinnedStepEvidenceZip(bad({exactAuthority:true})));
  assert.throws(()=>buildPinnedStepEvidenceZip(bad({receipt:{
    ...valid.receipt,producer:{...valid.receipt.producer,backend:'OCP-7.9.3.1'},
  }})));
  assert.throws(()=>buildPinnedStepEvidenceZip(bad({receipt:{
    ...valid.receipt,source:{...valid.receipt.source,archiveSha256:'wrong'},
  }})));
});

test('ZIP CRC matches standard and output filename rejects paths and invalid revisions',()=>{
  assert.equal(evidenceCrc32(enc.encode('123456789')),0xcbf43926);
  assert.equal(pinnedStepEvidenceFilename('../../a:b',11),
    '______a_b-revision-11-pinned-step-evidence.zip');
  assert.throws(()=>pinnedStepEvidenceFilename('plate',-1));
  assert.throws(()=>pinnedStepEvidenceFilename('',1));
});
