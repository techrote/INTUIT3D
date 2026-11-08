/**
 * One user-clicked, pinned OCCT8 source-custody package for the independent
 * STEP consumer. The ONLY source is RUNTIME's atomic capture return value.
 * No second read of the model, revision, STEP or React state is permitted.
 *
 * A single deterministic, uncompressed ZIP avoids browsers blocking multiple
 * automatic downloads and preserves the exact three files required by #275.
 * This does not itself attest a native compilation or independent CAD import.
 */
import type { CurrentStepEvidenceCapture } from '@intuit3d/workflow-runtime/live-plate-session';

const encoder = new TextEncoder();
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
type Member = Readonly<{name:string;bytes:Uint8Array}>;

const CRC_TABLE = Uint32Array.from({length:256},(_,index)=>{
  let crc=index;
  for(let bit=0;bit<8;bit++)
    crc=(crc&1)?(0xedb88320^(crc>>>1)):(crc>>>1);
  return crc>>>0;
});
export function evidenceCrc32(bytes:Uint8Array):number {
  let crc=0xffffffff;
  for(const byte of bytes) crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}

/** ZIP store, UTF-8 filenames, fixed 1980 timestamps and no mutable metadata. */
function zipMembers(members:readonly Member[]):Uint8Array {
  const names=members.map(m=>encoder.encode(m.name));
  if(members.length<1 || members.length>16 ||
      names.some(n=>n.length<1||n.length>255) ||
      members.some(m=>m.bytes.byteLength>MAX_EVIDENCE_BYTES))
    throw Error('STEP custody ZIP has invalid member sizes or names.');
  const locals=members.reduce((total,m,i)=>total+30+names[i].length+m.bytes.length,0);
  const central=members.reduce((total,_,i)=>total+46+names[i].length,0);
  const total=locals+central+22;
  if(total>MAX_EVIDENCE_BYTES) throw Error('STEP custody ZIP exceeds 64 MiB.');
  const output=new Uint8Array(total),view=new DataView(output.buffer);
  let pos=0;
  const u16=(at:number,value:number)=>view.setUint16(at,value,true);
  const u32=(at:number,value:number)=>view.setUint32(at,value,true);
  const dirs: {offset:number;name:Uint8Array;size:number;crc:number}[]=[];
  for(let i=0;i<members.length;i++){
    const member=members[i],name=names[i],offset=pos,size=member.bytes.length;
    const crc=evidenceCrc32(member.bytes);
    u32(pos,0x04034b50);u16(pos+4,20);u16(pos+6,0x0800);
    u16(pos+8,0);u16(pos+10,0);u16(pos+12,0x21);
    u32(pos+14,crc);u32(pos+18,size);u32(pos+22,size);
    u16(pos+26,name.length);u16(pos+28,0);
    pos+=30;output.set(name,pos);pos+=name.length;
    output.set(member.bytes,pos);pos+=size;
    dirs.push({offset,name,size,crc});
  }
  const centralStart=pos;
  for(const dir of dirs){
    u32(pos,0x02014b50);u16(pos+4,20);u16(pos+6,20);
    u16(pos+8,0x0800);u16(pos+10,0);u16(pos+12,0);
    u16(pos+14,0x21);u32(pos+16,dir.crc);
    u32(pos+20,dir.size);u32(pos+24,dir.size);
    u16(pos+28,dir.name.length);u16(pos+30,0);u16(pos+32,0);
    u16(pos+34,0);u16(pos+36,0);u32(pos+38,0);
    u32(pos+42,dir.offset);
    pos+=46;output.set(dir.name,pos);pos+=dir.name.length;
  }
  u32(pos,0x06054b50);u16(pos+4,0);u16(pos+6,0);
  u16(pos+8,dirs.length);u16(pos+10,dirs.length);
  u32(pos+12,pos-centralStart);u32(pos+16,centralStart);u16(pos+20,0);
  if(pos+22!==total) throw Error('STEP custody ZIP size mismatch.');
  return output;
}

export function pinnedStepEvidenceFilename(projectId:string,revision:number):string {
  if(typeof projectId!=='string'||!projectId||
      !Number.isSafeInteger(revision)||revision<0)
    throw Error('Invalid authoritative source identity.');
  return (projectId.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,64)||'model')+
    '-revision-'+revision+'-pinned-step-evidence.zip';
}

export function buildPinnedStepEvidenceZip(capture:CurrentStepEvidenceCapture):Uint8Array {
  if(!capture||capture.format!=='intuit3d.current-step-evidence-capture'||
      capture.version!==1||capture.exactAuthority!==false||
      capture.independentInteroperability!==false||
      typeof capture.archive!=='string'||!capture.archive||
      capture.receipt?.format!=='intuit3d.source-bound-step-receipt'||
      capture.receipt.version!==1||
      capture.receipt.producer?.backend!=='OCCT-cxx-8.0.1'||
      capture.receipt.exactAuthority!==false||
      capture.receipt.independentInteroperability!==false||
      typeof capture.receipt.source?.projectId!=='string'||
      !Number.isSafeInteger(capture.receipt.source.revision)||
      capture.receipt.source.revision<0||
      !/^[a-f0-9]{64}$/.test(capture.receipt.source.archiveSha256)||
      !/^[a-f0-9]{64}$/.test(capture.receipt.step?.sha256)||
      !(capture.stepBytes instanceof Uint8Array)||
      capture.stepBytes.length<1)
    throw Error('No complete revision-bound pinned OCCT8 STEP capture.');
  // All three members are copied from the *same* synchronous capture. Never
  // re-request live state after constructing this snapshot.
  return zipMembers([
    {name:'current.archive.json',bytes:encoder.encode(capture.archive)},
    {name:'current.receipt.json',bytes:encoder.encode(JSON.stringify(capture.receipt))},
    {name:'current.step',bytes:Uint8Array.from(capture.stepBytes)},
  ]);
}
