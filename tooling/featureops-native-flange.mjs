#!/usr/bin/env node
/** Actual FEATUREOPS→INTENT/SKETCH/RUNTIME→experimental OCP 7.9.3.1 STEP.
 * Four-hole flange, named thickness binding/edit, fifth hole, rectangular array,
 * independent undo steps, archive replay and actual OCP STEP.
 * Real same-engine STEP readback only. No OCCT8 C++ or independent CAD claim. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {runExperimentalPlate} from '@intuit3d/kernel-contract/local-plate-provider';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {createExperimentalPlateWorkflow} from '@intuit3d/workflow-runtime/experimental-plate';
import {authorMountingFlange,FEATURE_OPS_FORMAT,FEATURE_OPS_VERSION} from '@intuit3d/feature-ops';
import {commitUndoableParameterAuthoring,PARAMETER_AUTHORING_FORMAT} from '@intuit3d/model/parameter-authoring';
import {commitUndoableParameterEdit} from '@intuit3d/model/parameter-edit';

if(!process.argv[2]?.trim()) throw Error('Usage: node tooling/featureops-native-flange.mjs <new-output-basename>');
const output=resolve(process.argv[2]);
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={model,runtime,sketch,discovery};
const original=transactions.startUndoHistory(model.newProject('integration.four.bolt.flange'));
const built=authorMountingFlange(original,{
  format:FEATURE_OPS_FORMAT,version:FEATURE_OPS_VERSION,
  eventId:'author.mount',expectedRevision:original.document.revision,
  sketchFeatureId:'sketch.mount',extrudeFeatureId:'extrude.mount',
  cutFeatureId:'cut.mount',targetBodyId:'body.mount',thicknessMm:10,
  spec:{widthMm:180,depthMm:100,units:'mm',frame:'local_centered_xy',
    holes:[{id:'nw',xMm:-70,yMm:30,radiusMm:5},
      {id:'ne',xMm:70,yMm:30,radiusMm:5},
      {id:'sw',xMm:-70,yMm:-30,radiusMm:5},
      {id:'se',xMm:70,yMm:-30,radiusMm:5}]}
},services);
assert.equal(built.kind,'committed');
let history=built.history;
const workflow=createExperimentalPlateWorkflow({runtime,model,plateContract,runExperimentalPlate});
async function evaluate(tag,thickness,holes){
  const stepPath=output+'.'+tag+'.step';
  const result=await workflow.evaluate(history,{
    cutFeatureId:'cut.mount',requestId:'integration.mount.'+tag,
    readCurrentHistory:()=>history,exportStep:true,stepOutput:stepPath,timeoutMs:60000,
  });
  assert.equal(result.kind,'experimental_plate_evaluated',JSON.stringify(result));
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
  assert.equal(result.bodyId,'body.mount');
  assert.equal(result.artifact.verification,'same_engine_step_readback');
  assert.equal(result.intendedPlate.width,180);
  assert.equal(result.intendedPlate.depth,100);
  assert.equal(result.intendedPlate.thickness,thickness);
  assert.equal(result.intendedPlate.holes.length,holes);
  assert.equal(result.observed.source.valid,true);
  assert.equal(result.observed.source.solidCount,1);
  assert.equal(result.observed.stepReadback.solidCount,1);
  const expected=plateContract.expectedPlateMetrics(result.intendedPlate).volumeMm3;
  const observed=result.observed.source.volumeMm3;
  assert.ok(Math.abs(expected-observed)<=Math.max(1e-6,expected*1e-9),'source volume vs analytic oracle');
  const actual=await readFile(stepPath);
  assert.ok(actual.length>1000,'genuine STEP bytes');
  const sha256=createHash('sha256').update(actual).digest('hex');
  assert.equal(result.artifact.sha256,sha256);
  return {revision:result.revision,thickness,holes,volumeMm3:observed,
    bytes:actual.length,sha256,stepPath};
}
const first=await evaluate('four',10,4);
// The actual INTENT parameter authoring contract binds this existing extrude
// retrospectively. RUNTIME owns the derived scalar and downstream invalidation:
// no mesh value, alternate journal or synthetic STEP is introduced.
const bound=commitUndoableParameterAuthoring(history,{
  format:PARAMETER_AUTHORING_FORMAT,version:1,
  expectedRevision:history.document.revision,admission:'require_admissible',
  parameter:{
    eventId:'create.parameter.mount.thickness',
    featureId:'parameter.mount.thickness',name:'mountThickness',
    unit:'mm',expression:{op:'literal',value:10,unit:'mm'}
  },
  bindings:[{eventId:'bind.mount.thickness',featureId:'extrude.mount',field:'thicknessMm'}]
});
assert.equal(runtime.inspect(bound).features.find(f=>f.featureId==='extrude.mount').thicknessMm,10);
history=runtime.reopen(runtime.save(bound));
const edited=commitUndoableParameterEdit(history,{
  format:'intuit3d.parameter-edit',version:1,
  eventId:'edit.parameter.mount.thickness',
  featureId:'parameter.mount.thickness',
  expectedRevision:history.document.revision,
  expression:{op:'literal',value:16,unit:'mm'},
  admission:'require_admissible',
});
const parameterInvalidation=runtime.diff(history,edited);
assert.ok(parameterInvalidation.invalidatedFeatureIds.includes('extrude.mount'));
assert.ok(parameterInvalidation.invalidatedFeatureIds.includes('cut.mount'));
assert.ok(!parameterInvalidation.invalidatedFeatureIds.includes('sketch.mount'));
history=runtime.reopen(runtime.save(edited));
const thicker=await evaluate('thick',16,4);
assert.ok(thicker.volumeMm3>first.volumeMm3);
const added=runtime.editPlateHoles(history,{
  sketchFeatureId:'sketch.mount',eventId:'author.fifth',
  expectedRevision:history.document.revision,admission:'require_admissible',
  operations:[{kind:'add',id:'hole.center',x:0,y:0,radius:4}],
});
assert.equal(added.kind,'committed',JSON.stringify(added));
assert.ok(added.invalidation.invalidatedFeatureIds.includes('cut.mount'));
history=runtime.reopen(runtime.save(added.history));
const serialized=runtime.save(history);
await writeFile(output+'.intuit3d.json',serialized,{flag:'wx',mode:0o600});
assert.equal(runtime.save(runtime.reopen(await readFile(output+'.intuit3d.json','utf8'))),serialized);
const fifth=await evaluate('five',16,5);
assert.ok(fifth.volumeMm3<thicker.volumeMm3);
history=runtime.reopen(runtime.save(runtime.undo(history,['undo.fifth'])));
const undone=await evaluate('undo',16,4);
assert.ok(Math.abs(undone.volumeMm3-thicker.volumeMm3)<=Math.max(1e-6,thicker.volumeMm3*1e-9));
// Consume the new RUNTIME one-shot 2x2 array from SOLVED source geometry.
// Three independent bores join the four-hole flange with ONE undo frame.
const patterned=runtime.patternPlateHoles(history,{
  sketchFeatureId:'sketch.mount',eventId:'author.mount.array',
  expectedRevision:history.document.revision,admission:'require_admissible',
  sourceHoleId:'hole.nw',idPrefix:'pattern.mount',
  rows:2,columns:2,pitchXmm:18,pitchYmm:-18,
});
assert.equal(patterned.kind,'committed',JSON.stringify(patterned));
assert.ok(patterned.invalidation.invalidatedFeatureIds.includes('cut.mount'));
history=runtime.reopen(runtime.save(patterned.history));
const patternArchive=runtime.save(history);
await writeFile(output+'.pattern.intuit3d.json',patternArchive,{flag:'wx',mode:0o600});
assert.equal(runtime.save(runtime.reopen(await readFile(output+'.pattern.intuit3d.json','utf8'))),patternArchive);
const patternedStep=await evaluate('pattern',16,7);
assert.ok(patternedStep.volumeMm3<undone.volumeMm3);
history=runtime.reopen(runtime.save(runtime.undo(history,['undo.mount.array'])));
const patternUndone=await evaluate('undo-pattern',16,4);
assert.ok(Math.abs(patternUndone.volumeMm3-undone.volumeMm3)<=
  Math.max(1e-6,undone.volumeMm3*1e-9));
assert.equal(runtime.inspect(history).exactGeometryAvailable,false);
console.log(JSON.stringify({status:'FEATUREOPS_PARAMETER_PATTERN_REAL_EXPERIMENTAL_OCP_PASS',
  initial:first,retrospectiveParameterThickness:thicker,fifthHole:fifth,
  undoFifth:undone,sevenHolePattern:patternedStep,undoPattern:patternUndone,
  archives:[output+'.intuit3d.json',output+'.pattern.intuit3d.json'],
  exactAuthority:false,independentInteroperability:false,
  productionOcct801CppExecuted:false,externalCADReadback:false},null,2));
