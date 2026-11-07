import assert from 'node:assert/strict';
import test from 'node:test';
import { commitEvent, featuresOf, newProject, planProject, ProjectFormatError,
  ProjectRevisionError, serializeProject } from '../src/index.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import { startUndoHistory, commitUndoableTransaction, undoTransaction,
  redoTransaction, serializeUndoHistory } from '../src/transactions.ts';
import { createModelArchive, serializeModelArchive,
  deserializeModelArchive } from '../src/archive.ts';
import { inspectBodyCutChain } from '../src/body-cut-chain.ts';
import { BODY_CUT_ORDER_FORMAT, previewBodyCutSwap,
  commitUndoableBodyCutSwap } from '../src/body-cut-order.ts';

const make=(id,kind,dependsOn,writeTargets,payload={})=>({
  eventId:'create.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets,payload},
});
function plate(){
  let doc=newProject('project.resequence.plate');
  for(const e of [
    make('sketch.plate','sketch',[],['sketch.plate'],{widthMm:120,heightMm:80}),
    make('sketch.holes','sketch',[],['sketch.holes'],{
      holes:[{id:'hole.left',xMm:25,radiusMm:4},{id:'hole.right',xMm:95,radiusMm:4}]}),
    make('extrude.plate','extrude',['sketch.plate'],['body.plate'],
      {sourceSketchId:'sketch.plate',thicknessMm:8}),
    make('cut.holes','cut',['extrude.plate','sketch.holes'],['body.plate'],
      {targetBodyId:'body.plate',sourceSketchId:'sketch.holes',
       profileCandidateId:'cycle:holes',throughAll:true}),
    make('cut.pocket','cut',['cut.holes','sketch.holes'],['body.plate'],
      {targetBodyId:'body.plate',sourceSketchId:'sketch.holes',
       profileCandidateId:'cycle:pocket',throughAll:false,depthMm:3}),
    make('cut.notch','cut',['cut.pocket','sketch.holes'],['body.plate'],
      {targetBodyId:'body.plate',sourceSketchId:'sketch.holes',
       profileCandidateId:'cycle:notch',throughAll:true}),
    make('extrude.spacer','extrude',[],['body.spacer'],{thicknessMm:2}),
  ]) doc=commitEvent(doc,e);
  assert.ok(planProject(doc).features.every(x=>x.status==='ready'));
  return doc;
}
const req=(doc,rest={})=>({
  format:BODY_CUT_ORDER_FORMAT,version:1,expectedProjectId:doc.projectId,
  expectedRevision:doc.revision,targetBodyId:'body.plate',
  firstCutFeatureId:'cut.holes',secondCutFeatureId:'cut.pocket',
  eventIds:['swap.pocket','swap.holes','swap.notch'],...rest,
});
const writers=doc=>inspectBodyCutChain(doc,'body.plate');

test('actual dependency execution changes, not just presentation chronology',()=>{
  const doc=plate(),frozen=serializeProject(doc);
  const preview=previewBodyCutSwap(doc,req(doc));
  assert.deepEqual(preview.writerOrderBefore,
    ['extrude.plate','cut.holes','cut.pocket','cut.notch']);
  assert.deepEqual(preview.writerOrderAfter,
    ['extrude.plate','cut.pocket','cut.holes','cut.notch']);
  assert.equal(preview.authoredTimelineChanged,false);
  assert.equal(preview.exactGeometryAuthority,false);
  assert.equal(preview.requiresNativeRebuild,true);
  assert.equal(preview.document.revision,doc.revision+3);
  assert.deepEqual(preview.invalidation.readyToEvaluate,
    ['cut.pocket','cut.holes','cut.notch']);
  assert.ok(preview.invalidation.unchangedReady.includes('extrude.plate'));
  assert.ok(preview.invalidation.unchangedReady.includes('extrude.spacer'));
  assert.equal(writers(preview.document).eligibleAfterWriterId,'cut.notch');
  assert.ok(preview.plan.features.every(x=>x.status==='ready'));
  const byId=new Map(featuresOf(preview.document).map(f=>[f.id,f]));
  assert.deepEqual(byId.get('cut.pocket').dependsOn,['extrude.plate','sketch.holes']);
  assert.deepEqual(byId.get('cut.holes').dependsOn,['cut.pocket','sketch.holes']);
  assert.deepEqual(byId.get('cut.notch').dependsOn,['cut.holes','sketch.holes']);
  assert.equal(byId.get('cut.pocket').payload.depthMm,3);
  assert.equal(byId.get('cut.pocket').payload.profileCandidateId,'cycle:pocket');
  assert.equal(byId.get('cut.holes').payload.throughAll,true);
  assert.deepEqual(featuresOf(preview.document).map(f=>f.id),
    featuresOf(doc).map(f=>f.id));
  assert.equal(serializeProject(doc),frozen);
});

test('one undoable authoring action survives save/reopen and later dimensions',()=>{
  let history=startUndoHistory(plate());
  history=commitUndoableBodyCutSwap(history,req(history.document));
  assert.equal(history.undoStack.length,1);
  history=deserializeModelArchive(serializeModelArchive(createModelArchive(history))).history;
  assert.equal(writers(history.document).eligibleAfterWriterId,'cut.notch');
  history=undoTransaction(history,['undo.notch','undo.holes','undo.pocket']);
  assert.deepEqual(previewBodyCutSwap(history.document,req(history.document,{
    eventIds:['new.pocket','new.holes','new.notch'],
  })).writerOrderBefore,
    ['extrude.plate','cut.holes','cut.pocket','cut.notch']);
  history=redoTransaction(history,['redo.pocket','redo.holes','redo.notch']);
  const restored=previewBodyCutSwap(history.document,req(history.document,{
    firstCutFeatureId:'cut.pocket',secondCutFeatureId:'cut.holes',
    eventIds:['reverse.holes','reverse.pocket','reverse.notch'],
  }));
  assert.deepEqual(restored.writerOrderBefore,
    ['extrude.plate','cut.pocket','cut.holes','cut.notch']);

  const before=history.document;
  history=commitUndoableTransaction(history,[{
    eventId:'resize.plate',type:'feature.edit',featureId:'sketch.plate',
    patch:{payload:{widthMm:150,heightMm:80}},
  }]);
  const invalidation=planIncrementalEvaluation(before,history.document);
  assert.deepEqual(invalidation.readyToEvaluate,
    ['sketch.plate','extrude.plate','cut.pocket','cut.holes','cut.notch']);
  assert.ok(invalidation.unchangedReady.includes('extrude.spacer'));
  assert.equal(featuresOf(history.document).find(f=>f.id==='sketch.plate').payload.widthMm,150);
});

test('terminal two-cut swap needs only two journal events',()=>{
  const doc=plate(),request=req(doc,{
    firstCutFeatureId:'cut.pocket',secondCutFeatureId:'cut.notch',
    eventIds:['swap.notch','swap.pocket'],
  });
  const preview=previewBodyCutSwap(doc,request);
  assert.deepEqual(preview.writerOrderAfter,
    ['extrude.plate','cut.holes','cut.notch','cut.pocket']);
  assert.equal(preview.events.length,2);
  assert.equal(writers(preview.document).eligibleAfterWriterId,'cut.pocket');
  assert.deepEqual(preview.invalidation.readyToEvaluate,['cut.notch','cut.pocket']);
});

test('wrong, stale, ambiguous and malformed edits fail closed without partial commit',()=>{
  const doc=plate(),original=startUndoHistory(doc),frozen=serializeUndoHistory(original);
  for(const patch of [
    {expectedProjectId:'project.other'},
    {expectedRevision:doc.revision-1},
    {targetBodyId:'body.spacer'},
    {firstCutFeatureId:'cut.pocket',secondCutFeatureId:'cut.holes'},
    {firstCutFeatureId:'cut.holes',secondCutFeatureId:'cut.notch'},
    {firstCutFeatureId:'extrude.plate'},
    {firstCutFeatureId:'cut.holes',secondCutFeatureId:'cut.holes'},
    {eventIds:['one','two']},
    {eventIds:['one','one','three']},
    {eventIds:['one','two','three','four']},
    {eventIds:['create.cut.holes','two','three']},
    {unknown:true},
  ]) {
    assert.throws(()=>commitUndoableBodyCutSwap(original,req(doc,patch)),
      patch.expectedRevision!==undefined || patch.expectedProjectId!==undefined
        ? ProjectRevisionError:ProjectFormatError);
  }
  assert.equal(serializeUndoHistory(original),frozen);
});

test('dependent source sketch makes reverse order a real cycle and is rejected',()=>{
  let doc=newProject('project.dependent.cut');
  for(const e of [
    make('sketch.plate','sketch',[],[],{widthMm:120}),
    make('extrude.plate','extrude',['sketch.plate'],['body.plate'],
      {sourceSketchId:'sketch.plate',thicknessMm:8}),
    make('cut.first','cut',['extrude.plate','sketch.plate'],['body.plate'],
      {targetBodyId:'body.plate',sourceSketchId:'sketch.plate',throughAll:true}),
    make('sketch.projected','sketch',['cut.first'],[],{projectedFrom:'cut.first'}),
    make('cut.second','cut',['cut.first','sketch.projected'],['body.plate'],
      {targetBodyId:'body.plate',sourceSketchId:'sketch.projected',throughAll:false,depthMm:3}),
  ]) doc=commitEvent(doc,e);
  assert.ok(planProject(doc).features.every(x=>x.status==='ready'));
  const request={
    ...req(doc),firstCutFeatureId:'cut.first',secondCutFeatureId:'cut.second',
    eventIds:['swap.second','swap.first'],
  };
  assert.throws(()=>previewBodyCutSwap(doc,request),ProjectFormatError);
  assert.equal(planProject(doc).features.every(x=>x.status==='ready'),true);
});

test('an unordered extra writer must be repaired, not silently included in swap',()=>{
  let doc=plate();
  doc=commitEvent(doc,make('cut.rogue','cut',['extrude.plate','sketch.holes'],
    ['body.plate'],{targetBodyId:'body.plate',throughAll:true}));
  assert.notEqual(writers(doc).status,'ready');
  assert.throws(()=>previewBodyCutSwap(doc,req(doc)),ProjectFormatError);
});

test('standalone product resequencing fixture runs and reports honest native status',async()=>{
  const { spawnSync }=await import('node:child_process');
  const { fileURLToPath }=await import('node:url');
  const file=fileURLToPath(new URL('../examples/resequence-plate-cuts.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',file],
    {encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr || run.stdout);
  const result=JSON.parse(run.stdout.trim());
  assert.equal(result.format,'intuit3d.body-cut-order-demo');
  assert.equal(result.widthMm,150);
  assert.equal(result.nativeStepStatus,'not_executed');
  assert.deepEqual(result.writerOrderAfter,
    ['extrude.plate','cut.pocket','cut.slot']);
  assert.equal(result.independentBodyReusable,true);
});
