/**
 * One-command REAL experimental native/HTTP test:
 * npm run demo:bridge --workspace @intuit3d/workflow-runtime
 * Requires pinned Linux Python/OCP 7.9.3.1.1. This is NOT production exactness
 * or independent STEP interoperability.
 */
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {runExperimentalPlate} from '@intuit3d/kernel-contract/local-plate-provider';
import {createWorkflowRuntime} from '../index.mjs';
import {startLocalPlateBridge} from '../local-plate-bridge.mjs';
import {evaluateLocalPlate} from '../local-plate-client.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const created=(eventId,feature)=>({eventId,type:'feature.create',feature});
let current=transactions.startUndoHistory(model.newProject('runtime.native_bridge_demo'));
current=runtime.commit(current,[
  created('create.sketch',{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketch:sketch.plateSketchFixture()}}),
  created('create.plate',{id:'plate',kind:'extrude',dependsOn:['sketch.plate'],
    writeTargets:['body.plate'],payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
  created('create.cut',{id:'cut',kind:'cut',dependsOn:['plate'],writeTargets:['body.plate'],
    payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
]);
const host=await startLocalPlateBridge({runtime,model,plateContract,runExperimentalPlate,
  timeoutMs:45000});
try {
  const evaluate=async requestId=>{
    const out=await evaluateLocalPlate({url:host.url,token:host.token,runtime,
      readCurrentHistory:()=>current,cutFeatureId:'cut',requestId,exportStep:true});
    assert.equal(out.kind,'experimental_plate_evaluated',JSON.stringify(out));
    assert.ok(out.step.bytes.length>0);
    assert.equal(out.exactAuthority,false);
    assert.equal(out.independentInteroperability,false);
    return {revision:out.source.revision,plate:out.result.intendedPlate,
      sha256:out.step.sha256,bytes:out.step.bytes.length,
      volumeMm3:out.result.observed.source.volumeMm3,
      backend:out.result.backend,occtVersion:out.result.occtVersion};
  };
  const first=await evaluate('bridge.native.first');
  current=runtime.commit(current,[created('create.parameter',{id:'parameter.t',
    kind:'parameter',dependsOn:[],writeTargets:[],
    payload:{parameter:{name:'thickness',unit:'mm',
      expression:{op:'literal',value:10,unit:'mm'}}}})]);
  current=runtime.editDimensions(current,{
    format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,
    version:dimensions.DIMENSION_BATCH_EDIT_VERSION,
    expectedRevision:current.document.revision,
    admission:'require_admissible',
    edits:[{eventId:'bind.thickness',featureId:'plate',field:'thicknessMm',
      binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.t'}}}],
  });
  current=runtime.reopen(runtime.save(current));
  const second=await evaluate('bridge.native.second');
  assert.equal(first.plate.thickness,8);
  assert.equal(second.plate.thickness,10);
  assert.notEqual(first.sha256,second.sha256);
  assert.ok(second.volumeMm3>first.volumeMm3);
  console.log(JSON.stringify({status:'real_experimental_native_bridge_pass',
    first,second,independentStep:false,productionExact:false},null,2));
} finally {await host.close();}
