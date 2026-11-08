#!/usr/bin/env node
/** Private, locally executed INTUIT3D archive probe for Windows/Firefox #177.
 * Usage: node --experimental-strip-types apps/web/scripts/probe-private-archive.mjs "C:\\path\\to\\original.i3d-model.json"
 *
 * Runs read -> JSON.parse -> authoritative RUNTIME.reopen -> RUNTIME.inspect ->
 * workbench-specific admission in an isolated Node Worker, with bounded stage
 * timeouts. Does not create output files, publish source or print the pathname,
 * project ID, archive text, feature geometry, event payloads or stack traces.
 * A PASS is NOT a Firefox file-selection or WebGL acceptance.
 */
import {isMainThread,parentPort,workerData,Worker} from 'node:worker_threads';
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';

const MAX_ARCHIVE_BYTES=4*1024*1024;
const STAGE_TIMEOUT_MS=12000;
const TOTAL_TIMEOUT_MS=40000;
const stages=['stat','read','json.parse','runtime.reopen','runtime.inspect','workbench.admission'];

if(!isMainThread){
  let stage='stat';
  const enter=name=>{
    stage=name;
    parentPort.postMessage({kind:'stage',stage:name});
  };
  try{
    const pathname=workerData.pathname;
    enter('stat');
    const metadata=await stat(pathname);
    if(!metadata.isFile() || metadata.size>MAX_ARCHIVE_BYTES || metadata.size<1)
      throw new RangeError('Input size/type is unsupported');
    enter('read');
    const source=await readFile(pathname,'utf8');
    enter('json.parse');
    JSON.parse(source);
    enter('runtime.reopen');
    const {runtime,inspectModelSession,reopenModelSession}=
      await import('../src/runtimeSession.ts');
    const history=runtime.reopen(source);
    enter('runtime.inspect');
    const inspected=inspectModelSession(history);
    enter('workbench.admission');
    const admitted=reopenModelSession(source);
    if(history.document.revision!==admitted.document.revision ||
       history.document.projectId!==admitted.document.projectId ||
       inspected.revision!==admitted.document.revision ||
       JSON.stringify(history.document)!==JSON.stringify(admitted.document) ||
       history.undoStack.length!==admitted.undoStack.length ||
       history.redoStack.length!==admitted.redoStack.length)
      throw new Error('RUNTIME/workbench source identity mismatch');
    parentPort.postMessage({kind:'complete',revision:admitted.document.revision,
      undoFrames:admitted.undoStack.length,redoFrames:admitted.redoStack.length,
      bytes:metadata.size});
  }catch(error){
    // Error.message can contain private source text; emit ONLY its class.
    parentPort.postMessage({kind:'failure',stage,
      errorType:error instanceof Error?error.name:'UnknownError'});
  }
}else{
  if(process.argv.length!==3 || !process.argv[2]){
    console.error('Usage: node --experimental-strip-types apps/web/scripts/probe-private-archive.mjs <private-file-path>');
    process.exitCode=2;
  }else{
    const worker=new Worker(new URL(import.meta.url),{
      workerData:{pathname:resolve(process.argv[2])},
    });
    const started=performance.now();
    let finished=false,stage='startup',stageTimer,totalTimer;
    const cleanup=()=>{clearTimeout(stageTimer);clearTimeout(totalTimer);};
    const fail=(code)=>{
      if(finished)return;
      finished=true;cleanup();process.exitCode=code;
      void worker.terminate();
    };
    const armStageTimeout=()=>{
      clearTimeout(stageTimer);
      stageTimer=setTimeout(()=>{
        console.error('PROBE_TIMEOUT stage='+stage+'; no source was printed');
        fail(124);
      },STAGE_TIMEOUT_MS);
    };
    armStageTimeout();
    totalTimer=setTimeout(()=>{
      console.error('PROBE_TIMEOUT stage='+stage+'; overall deadline');
      fail(124);
    },TOTAL_TIMEOUT_MS);
    worker.on('message',message=>{
      if(finished)return;
      if(message.kind==='stage'){
        if(!stages.includes(message.stage)){console.error('PROBE_FAILED invalid stage');fail(1);return;}
        stage=message.stage;
        console.log('PROBE_STAGE '+stage+' +'+Math.round(performance.now()-started)+'ms');
        armStageTimeout();
      }else if(message.kind==='complete'){
        finished=true;cleanup();
        console.log('PROBE_PASS revision='+message.revision+' undoFrames='+message.undoFrames+
          ' redoFrames='+message.redoFrames+' bytes='+message.bytes);
        console.log('LIMITATION: Node RUNTIME/Workbench only; original-file Windows Firefox selection/Worker/confirmation remains untested.');
      }else if(message.kind==='failure'){
        console.error('PROBE_FAILED stage='+message.stage+' type='+message.errorType);
        fail(1);
      }else{
        console.error('PROBE_FAILED unexpected worker message');
        fail(1);
      }
    });
    worker.on('error',()=>{if(!finished){console.error('PROBE_FAILED worker error; source omitted');fail(1);}});
    worker.on('exit',code=>{if(!finished){console.error('PROBE_FAILED worker exited '+code+' at '+stage);fail(1);}});
  }
}
