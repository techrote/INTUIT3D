#!/usr/bin/env node
/**
 * One-command local CAD startup: real model-backed React UI + isolated trusted
 * RUNTIME native companion. This is NOT a production OCCT/STEP qualification.
 *
 * npm ci
 * npm run dev:local
 * npm run dev:local -- --smoke   # automated loopback startup acceptance
 * npm run dev:local -- --pinned  # explicitly verified local OCCT8 worker
 */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const origin='http://127.0.0.1:5173';
const args=process.argv.slice(2);
if(args.length===1 && (args[0]==='--help'||args[0]==='-h')){
  console.log('Usage: npm run dev:local [-- --smoke] [--pinned]');
  console.log('Default: local model-backed CAD UI plus experimental OCP companion.');
  console.log('--pinned: explicitly launch an independently SHA-pinned Linux OCCT8 worker from INTUIT3D_OCCT8_WORKER and INTUIT3D_OCCT8_WORKER_SHA256.');
  console.log('--smoke verifies both loopback servers and exits without requesting geometry.');
  process.exit(0);
}
if(args.some(arg=>!['--smoke','--pinned'].includes(arg)) ||
   new Set(args).size!==args.length){
  console.error('Unknown/duplicate argument. Use --help, --smoke or --pinned.');
  process.exit(2);
}
const smoke=args.includes('--smoke');
const pinned=args.includes('--pinned');
const viteCandidates=[
  join(root,'node_modules','vite','bin','vite.js'),
  join(root,'apps','web','node_modules','vite','bin','vite.js'),
];
const viteEntry=viteCandidates.find(existsSync);
const hostEntry=pinned
  ? join(root,'tooling','local-pinned-host.mjs')
  : join(root,'apps','web','scripts','local-native-host.mjs');
const children=[];
let failure=null,stopping=false,stopRequested=false;
const hostInfo={url:null,token:null};
const logs={native:'',web:''};
for(const signal of ['SIGINT','SIGTERM']){
  process.on(signal,()=>{stopRequested=true;});
}
function launch(name,script,params,cwd){
  const proc=spawn(process.execPath,[script,...params],{
    cwd,env:process.env,stdio:['ignore','pipe','pipe'],windowsHide:true,
  });
  children.push(proc);
  let pending='';
  proc.stdout.on('data',chunk=>{
    pending+=String(chunk);
    let boundary;
    while((boundary=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,boundary).trim();
      pending=pending.slice(boundary+1);
      if(name==='native'){
        if(line.startsWith('LOCAL_PROVIDER_URL='))hostInfo.url=line.slice(19);
        if(line.startsWith('LOCAL_PAIRING_TOKEN='))hostInfo.token=line.slice(20);
      }
      if(!smoke && line)console.log('['+name+'] '+line);
    }
  });
  proc.stderr.on('data',chunk=>{
    logs[name]=(logs[name]+String(chunk)).slice(-4000);
    if(!smoke)process.stderr.write('['+name+'] '+String(chunk));
  });
  proc.once('error',error=>{
    if(!stopping)failure=new Error(name+' startup failed: '+error.message);
  });
  proc.once('exit',(code,signal)=>{
    if(!stopping)failure=new Error(name+' exited unexpectedly ('+
      (signal||code)+'): '+logs[name]);
  });
  return proc;
}
async function waitFor(fn,description,timeoutMs=45000){
  const start=Date.now();
  while(Date.now()-start<timeoutMs){
    if(failure)throw failure;
    if(stopRequested)throw new Error('Startup interrupted by user');
    try{if(await fn())return;}catch(error){
      if(Date.now()-start>timeoutMs-1500)throw error;
    }
    await pause(150);
  }
  throw new Error('Timed out waiting for '+description+
    '; native stderr='+logs.native+'; web stderr='+logs.web);
}
async function cleanup(){
  stopping=true;
  for(const child of children.slice().reverse()){
    if(child.exitCode===null && child.signalCode===null){
      try{child.kill('SIGTERM');}catch{}
    }
  }
  await pause(1300);
  for(const child of children){
    if(child.exitCode===null && child.signalCode===null){
      try{child.kill('SIGKILL');}catch{}
    }
  }
}
async function main(){
  if(!viteEntry || !existsSync(hostEntry))
    throw new Error('Local workbench dependencies missing. Run npm ci at the repository root.');
  try{
    launch('native',hostEntry,[],root);
    await waitFor(()=>Boolean(hostInfo.url&&hostInfo.token),'native pairing credentials');
    const parsed=new URL(hostInfo.url);
    if(parsed.hostname!=='127.0.0.1'||parsed.protocol!=='http:'||
       !/^[a-f0-9]{64}$/.test(hostInfo.token))
      throw new Error('Native companion published invalid loopback pairing credentials');
    launch('web',viteEntry,['--host','127.0.0.1','--port','5173','--strictPort'],
      join(root,'apps','web'));
    await waitFor(async()=>{
      const response=await fetch(origin,{signal:AbortSignal.timeout(1200)});
      return response.ok && (await response.text()).includes('INTUIT3D');
    },'local React/Vite workbench on '+origin);
    console.log('LOCAL_CAD_WORKBENCH_READY '+origin);
    if(smoke){
      console.log('LOCAL_CAD_SMOKE_PASS: React/Vite + isolated RUNTIME HTTP paired on loopback');
      console.log('NOT_QUALIFIED: no B-rep built, no STEP readback, no browser interaction');
      if(pinned) console.log('PINNED_HOST_CONFIGURED_ONLY: worker digest verified, no physical geometry executed');
      return;
    }
    console.log('Open '+origin+' and enter MODEL-BACKED CAD.');
    console.log('Copy the LOCAL_PROVIDER_URL and LOCAL_PAIRING_TOKEN from the [native] output');
    console.log('into the workbench Local native STEP panel. Keep the token private.');
    if(pinned) console.log('Local provider configured as pinned OCCT8 C++ with a verified worker digest; actual geometry/STEP remains experimental until executed and independently imported.');
    else console.log('Native STEP is experimental OCP, not pinned OCCT 8.0.1 or independent CAD.');
    console.log('Press Ctrl+C to stop both local processes.');
    while(!stopRequested && !failure)await pause(250);
    if(failure)throw failure;
  }finally{
    await cleanup();
  }
}
main().catch(error=>{
  console.error('LOCAL_CAD_START_FAILED',error.stack||String(error));
  process.exitCode=1;
});
