import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');

test('one command starts both loopback CAD processes and shuts them down',{
  timeout:110000,
},async()=>{
  const child=spawn(process.execPath,[join(root,'tooling','dev-local.mjs'),'--smoke'],{
    cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true,
  });
  let stdout='',stderr='',timedOut=false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const watchdog=setTimeout(()=>{
    timedOut=true;
    try{child.kill('SIGKILL');}catch{}
  },95000);
  try{
    const result=await new Promise((res,rej)=>{
      child.once('error',rej);
      child.once('exit',(code,signal)=>res({code,signal}));
    });
    assert.equal(timedOut,false,'local CAD startup hung: '+stdout+'\n'+stderr);
    assert.deepEqual(result,{code:0,signal:null},stdout+'\n'+stderr);
    assert.match(stdout,/LOCAL_CAD_WORKBENCH_READY http:\/\/127\.0\.0\.1:5173/);
    assert.match(stdout,/LOCAL_CAD_SMOKE_PASS/);
    assert.match(stdout,/NOT_QUALIFIED: no B-rep built/);
    assert.doesNotMatch(stdout,/LOCAL_PAIRING_TOKEN=/,
      'smoke-mode logs must not disclose the pairing credential');
  }finally{clearTimeout(watchdog);}
});
