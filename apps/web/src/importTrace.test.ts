import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendImportTrace,serializeImportTrace,IMPORT_TRACE_FORMAT,
  type ImportTraceEntry,
} from './importTrace.ts';

test('stage record is monotonic, bounded, deterministic, and omits private file identity',()=>{
  let trace:readonly ImportTraceEntry[]=[];
  trace=appendImportTrace(trace,'file_selected',0);
  trace=appendImportTrace(trace,'worker_reading',9);
  trace=appendImportTrace(trace,'worker_reading',50);
  trace=appendImportTrace(trace,'worker_validating',8);
  trace=appendImportTrace(trace,'confirmation_ready',53);
  assert.deepEqual(trace.map(x=>x.elapsedMs),[0,9,9,53]);
  const serialized=serializeImportTrace(trace);
  const report=JSON.parse(serialized);
  assert.equal(report.format,IMPORT_TRACE_FORMAT);
  assert.deepEqual(report.stages,trace);
  assert.deepEqual(Object.keys(report),['format','version','scope','stages','privacy','limitations']);
  assert.ok(!serialized.includes('model.json')&&!serialized.includes('projectId')&&
    !serialized.includes('undoStack'));
  assert.equal(serializeImportTrace(trace),serialized);
});

test('trace rejects fabricated stages, invalid durations and empty source',()=>{
  assert.throws(()=>serializeImportTrace([]),/No valid/);
  assert.throws(()=>appendImportTrace([],'contains-private-json' as never,0),/Invalid/);
  assert.throws(()=>appendImportTrace([],'file_selected',Infinity),/Invalid/);
  assert.throws(()=>appendImportTrace([],'file_selected',-1),/Invalid/);
  assert.throws(()=>serializeImportTrace([{stage:'rejected',elapsedMs:NaN}]),/No valid/);
  assert.throws(()=>serializeImportTrace([{stage:'evil' as never,elapsedMs:1}]),/No valid/);
  let trace:readonly ImportTraceEntry[]=[];
  for(let i=0;i<100;i++)trace=appendImportTrace(trace,
    i%2?'worker_reading':'worker_validating',i);
  assert.equal(trace.length,24);
});
