import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  newProject, commitEvent, featuresOf, serializeProject, planProject,
  ProjectRevisionError, ProjectFormatError,
} from '../src/index.ts';
import {
  FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT, previewFeaturePayloadScalarRevert,
  commitUndoableFeaturePayloadScalarRevert,
} from '../src/feature-payload-scalar-revert.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import {
  HISTORICAL_EDIT_INVENTORY_FORMAT, inspectHistoricalFeatureEdits,
} from '../src/historical-edit-inventory.ts';

const feature=(id,kind,dependsOn,writeTargets,payload)=>({
  id,kind,dependsOn,writeTargets,payload,
});
const find=(doc,id)=>featuresOf(doc).find(f=>f.id===id);
function baseline(){
  let doc=newProject('project.servo.gearbox.scalar.history');
  for (const f of [
    feature('sketch.housing','sketch',[],[],{widthMm:120,depthMm:85}),
    feature('extrude.housing','extrude',['sketch.housing'],['body.housing'],
      {thicknessMm:8,clearanceMm:1.5,sourceSketchId:'sketch.housing'}),
    feature('cut.housing','cut',['extrude.housing'],['body.housing'],
      {targetBodyId:'body.housing',depthMm:4}),
    feature('sketch.lid','sketch',[],[],{widthMm:104,depthMm:70}),
    feature('extrude.lid','extrude',['sketch.lid','cut.housing'],['body.lid'],
      {thicknessMm:4}),
    feature('sketch.gauge','sketch',[],[],{widthMm:26}),
    feature('extrude.gauge','extrude',['sketch.gauge'],['body.gauge'],
      {thicknessMm:2}),
  ]) doc=commitEvent(doc,{type:'feature.create',eventId:'create.'+f.id,feature:f});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.housing.compound',
    featureId:'extrude.housing',patch:{
      payload:{thicknessMm:14,clearanceMm:2.5,sourceSketchId:'sketch.housing'},
      dependsOn:['sketch.housing','sketch.gauge'],
    }});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.housing.datum',
    featureId:'extrude.housing',patch:{
      dependsOn:['sketch.gauge','sketch.housing'],
    }});
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.gauge.later',
    featureId:'extrude.gauge',patch:{payload:{thicknessMm:3}}});
  assert.ok(planProject(doc).features.every(row=>row.status==='ready'));
  return doc;
}
function req(doc,extra={}){
  return {format:FEATURE_PAYLOAD_SCALAR_REVERT_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    expectedDocumentFence:serializeProject(doc),
    targetEventId:'edit.housing.compound',
    eventId:'revert.housing.thickness',
    selectedFields:['thicknessMm'],admission:'require_ready',
    confirmUnresolved:false,...extra};
}
function inventory(doc){
  return inspectHistoricalFeatureEdits(doc,{
    format:HISTORICAL_EDIT_INVENTORY_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    expectedDocumentFence:serializeProject(doc),
    probeEventId:'probe.housing.scalar',cursor:null,limit:16,
  });
}
test('housing scalar is recovered without rolling back another dimension or a later datum edit',()=>{
  const doc=baseline(),before=serializeProject(doc);
  const row=inventory(doc).rows.find(x=>x.targetEventId==='edit.housing.compound');
  assert.equal(row?.status,'blocked');
  assert.deepEqual(row?.scalarChoices.map(x=>[x.field,x.status]),
    [['thicknessMm','available'],['clearanceMm','available']]);
  const choice=row.scalarChoices[0];
  assert.equal(choice.before,8);
  assert.equal(choice.authored,14);
  assert.equal(choice.current,14);
  assert.deepEqual(choice.invalidatedBodyIds,['body.housing','body.lid']);
  const preview=previewFeaturePayloadScalarRevert(doc,req(doc));
  assert.deepEqual(preview.restored,[{
    field:'thicknessMm',before:8,authored:14,current:14,
  }]);
  assert.equal(find(preview.document,'extrude.housing').payload.thicknessMm,8);
  assert.equal(find(preview.document,'extrude.housing').payload.clearanceMm,2.5);
  assert.deepEqual(find(preview.document,'extrude.housing').dependsOn,
    ['sketch.gauge','sketch.housing']);
  assert.equal(find(preview.document,'extrude.gauge').payload.thicknessMm,3);
  assert.deepEqual(preview.invalidatedBodyIds,['body.housing','body.lid']);
  assert.equal(preview.requiresSketchAdmission,true);
  assert.equal(preview.exactGeometryAuthority,false);
  assert.equal(serializeProject(doc),before);
});
test('multi-select restores two explicit numeric fields as a single durable undo frame',()=>{
  const doc=baseline(),request=req(doc,{
    selectedFields:['thicknessMm','clearanceMm'],
  });
  let h=commitUndoableFeaturePayloadScalarRevert(startUndoHistory(doc),request);
  assert.equal(h.undoStack.length,1);
  assert.equal(h.document.revision,doc.revision+1);
  assert.equal(find(h.document,'extrude.housing').payload.thicknessMm,8);
  assert.equal(find(h.document,'extrude.housing').payload.clearanceMm,1.5);
  h=deserializeModelArchive(serializeModelArchive(createModelArchive(h))).history;
  h=undoTransaction(h,['undo.housing.scalar']);
  assert.equal(find(h.document,'extrude.housing').payload.thicknessMm,14);
  assert.equal(find(h.document,'extrude.housing').payload.clearanceMm,2.5);
  h=redoTransaction(h,['redo.housing.scalar']);
  assert.equal(find(h.document,'extrude.housing').payload.thicknessMm,8);
  assert.equal(find(h.document,'extrude.housing').payload.clearanceMm,1.5);
  assert.deepEqual(find(h.document,'extrude.housing').dependsOn,
    ['sketch.gauge','sketch.housing']);
  assert.equal(find(h.document,'extrude.gauge').payload.thicknessMm,3);
});
test('an intervening payload replacement blocks rather than guessing nested-field intent',()=>{
  let doc=baseline();
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.housing.unrelated.payload',
    featureId:'extrude.housing',patch:{payload:{
      ...find(doc,'extrude.housing').payload,clearanceMm:3,
    }}});
  assert.throws(()=>previewFeaturePayloadScalarRevert(doc,req(doc)),
    ProjectRevisionError);
  const row=inventory(doc).rows.find(x=>x.targetEventId==='edit.housing.compound');
  assert.equal(row.scalarChoices.find(x=>x.field==='thicknessMm').status,'blocked');
});
test('divergent equal-revision branches and all malformed selections fail closed',()=>{
  const doc=baseline();
  const fork={...doc,journal:doc.journal.map(x=>x.eventId==='edit.gauge.later'?
    {...x,patch:{payload:{thicknessMm:4}}}:x)};
  assert.equal(fork.revision,doc.revision);
  assert.throws(()=>previewFeaturePayloadScalarRevert(fork,req(doc)),
    ProjectRevisionError);
  for(const extra of [
    {expectedRevision:doc.revision-1},{expectedProjectId:'project.other'},
    {selectedFields:[]},{selectedFields:['thicknessMm','thicknessMm']},
    {selectedFields:['missingMm']},{selectedFields:['sourceSketchId']},
    {selectedFields:['__proto__']},{selectedFields:['thicknessMm','clearanceMm','missingMm']},
    {eventId:'edit.housing.compound'},
    {targetEventId:'edit.gauge.later'},
    {unsupported:true},
  ]) assert.throws(()=>previewFeaturePayloadScalarRevert(doc,req(doc,extra)),
    (e)=>e instanceof ProjectFormatError || e instanceof ProjectRevisionError);
});
test('kind changes, lifecycle and formula-bound dimensions remain explicitly blocked',()=>{
  let doc=baseline();
  const incompatible=commitEvent(doc,{type:'feature.edit',eventId:'edit.housing.kind',
    featureId:'extrude.housing',patch:{kind:'cut'}});
  assert.throws(()=>previewFeaturePayloadScalarRevert(incompatible,req(incompatible)),
    ProjectRevisionError);
  const retired=commitEvent(doc,{type:'feature.remove',eventId:'remove.housing',
    featureId:'extrude.housing'});
  assert.throws(()=>previewFeaturePayloadScalarRevert(retired,req(retired)),
    ProjectRevisionError);
  let bound=newProject('project.bound.history');
  bound=commitEvent(bound,{type:'feature.create',eventId:'create.bound',feature:
    feature('extrude.bound','extrude',[],['body.bound'],{
      thicknessMm:8,dimensionBindings:{entries:[{field:'thicknessMm'}]},
    })});
  bound=commitEvent(bound,{type:'feature.edit',eventId:'edit.bound',featureId:'extrude.bound',
    patch:{payload:{thicknessMm:14,
      dimensionBindings:{entries:[{field:'thicknessMm'}]}}}});
  assert.throws(()=>previewFeaturePayloadScalarRevert(bound,req(bound,{
    targetEventId:'edit.bound',eventId:'revert.bound',
  })),/parameter-bound/);
});
test('strict ready gate refuses unresolved intent, permissive mode preserves it',()=>{
  let doc=baseline();
  doc=commitEvent(doc,{type:'feature.edit',eventId:'edit.housing.invalid.dependency',
    featureId:'extrude.housing',patch:{
      dependsOn:['sketch.absent'],
    }});
  assert.throws(()=>previewFeaturePayloadScalarRevert(doc,req(doc)),
    ProjectFormatError);
  const allowed=previewFeaturePayloadScalarRevert(doc,req(doc,{
    admission:'permit_unresolved',
  }));
  assert.equal(allowed.plan.features.find(x=>x.feature.id==='extrude.housing').status,'pending');
  assert.equal(allowed.exactGeometryAuthority,false);
});
test('connected SKETCH/FEATUREOPS/RUNTIME motor mount scalar-history example',()=>{
  const path=fileURLToPath(new URL('../examples/servo-mount-scalar-history.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',path],
    {encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr||run.stdout);
  const output=JSON.parse(run.stdout);
  assert.equal(output.format,'intuit3d.servo-mount-scalar-history');
  assert.equal(output.selectedHistoricalThicknessRestored,true);
  assert.equal(output.preservedLaterAuthoring,true);
  assert.equal(output.archiveUndoRedo,true);
  assert.equal(output.exactGeometryAuthority,false);
});
