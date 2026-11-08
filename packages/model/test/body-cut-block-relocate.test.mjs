import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  newProject, commitEvent, featuresOf, planProject, serializeProject,
  ProjectFormatError, ProjectRevisionError,
} from '../src/index.ts';
import {
  startUndoHistory, serializeUndoHistory, undoTransaction, redoTransaction,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import { inspectBodyCutChain } from '../src/body-cut-chain.ts';
import {
  BODY_CUT_BLOCK_RELOCATE_FORMAT, previewBodyCutBlockRelocate,
  commitUndoableBodyCutBlockRelocate, inspectBodyCutBlockDestinations,
} from '../src/body-cut-block-relocate.ts';
import {
  BODY_REBUILD_MANIFEST_FORMAT, planBodyRebuildManifest,
} from '../src/body-rebuild-manifest.ts';

const create=(id,kind,dependsOn,targets,payload={})=>({
  eventId:'create.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets:targets,payload},
});
function gearbox(){
  let doc=newProject('project.servo.gearbox.fixture');
  const events=[
    create('sketch.base','sketch',[],['sketch.base'],{widthMm:126,depthMm:62}),
    ...['key','bearing','relief','tapping','inspection'].map(id=>
      create('sketch.'+id,'sketch',[],['sketch.'+id],{profile:id})),
    create('extrude.gearbox','extrude',['sketch.base'],['body.gearbox'],
      {sourceSketchId:'sketch.base',thicknessMm:22}),
    create('cut.key','cut',['extrude.gearbox','sketch.key'],['body.gearbox'],
      {sourceSketchId:'sketch.key',targetBodyId:'body.gearbox',throughAll:true}),
    create('cut.bearing','cut',['cut.key','sketch.bearing'],['body.gearbox'],
      {sourceSketchId:'sketch.bearing',targetBodyId:'body.gearbox',depthMm:8}),
    create('cut.relief','cut',['cut.bearing','sketch.relief'],['body.gearbox'],
      {sourceSketchId:'sketch.relief',targetBodyId:'body.gearbox',depthMm:5}),
    create('cut.tapping','cut',['cut.relief','sketch.tapping'],['body.gearbox'],
      {sourceSketchId:'sketch.tapping',targetBodyId:'body.gearbox',depthMm:10}),
    create('cut.inspection','cut',['cut.tapping','sketch.inspection'],['body.gearbox'],
      {sourceSketchId:'sketch.inspection',targetBodyId:'body.gearbox',throughAll:true}),
    create('extrude.bracket','extrude',[],['body.bracket'],{thicknessMm:8}),
    create('cut.bracket.key','cut',['extrude.bracket','cut.inspection'],['body.bracket'],
      {targetBodyId:'body.bracket',sourceBodyWriterId:'cut.inspection'}),
    create('extrude.gauge','extrude',[],['body.gauge'],{thicknessMm:2}),
  ];
  for(const event of events) doc=commitEvent(doc,event);
  assert.equal(planProject(doc).features.every(row=>row.status==='ready'),true);
  return doc;
}
const order=doc=>inspectBodyCutChain(doc,'body.gearbox').bodyWriterIds;
function request(doc,changes={}){
  return {
    format:BODY_CUT_BLOCK_RELOCATE_FORMAT,version:1,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    expectedDocumentFence:serializeProject(doc),
    targetBodyId:'body.gearbox',
    cutFeatureIds:['cut.bearing','cut.relief'],
    afterBodyWriterId:'cut.inspection',
    eventIds:['relocate.tapping','relocate.bearing'],
    ...changes,
  };
}
function inventory(doc,changes={}){
  const {afterBodyWriterId,eventIds,...rest}=request(doc);
  return inspectBodyCutBlockDestinations(doc,{
    ...rest,offset:0,limit:16,...changes,
  });
}

test('move an ordered two-cut machining block in one revision-fenced frame',()=>{
  const doc=gearbox(),fence=serializeProject(doc);
  const result=previewBodyCutBlockRelocate(doc,request(doc));
  assert.deepEqual(result.writerOrderBefore,[
    'extrude.gearbox','cut.key','cut.bearing','cut.relief',
    'cut.tapping','cut.inspection',
  ]);
  assert.deepEqual(result.writerOrderAfter,[
    'extrude.gearbox','cut.key','cut.tapping','cut.inspection',
    'cut.bearing','cut.relief',
  ]);
  assert.deepEqual(result.rewiredWriterIds,['cut.tapping','cut.bearing']);
  assert.equal(result.events.length,2);
  assert.equal(result.authoredTimelineChanged,false);
  assert.equal(result.exactGeometryAuthority,false);
  assert.equal(result.requiresNativeRebuild,true);
  assert.equal(serializeProject(doc),fence);
  assert.equal(result.document.revision,doc.revision+2);
  const before=new Map(featuresOf(doc).map(f=>[f.id,f]));
  const after=new Map(featuresOf(result.document).map(f=>[f.id,f]));
  for(const id of ['cut.key','cut.bearing','cut.relief','cut.tapping','cut.inspection']){
    assert.deepEqual(after.get(id).payload,before.get(id).payload);
    assert.deepEqual(after.get(id).writeTargets,before.get(id).writeTargets);
  }
  assert.deepEqual(after.get('cut.tapping').dependsOn,
    ['cut.key','sketch.tapping']);
  assert.deepEqual(after.get('cut.bearing').dependsOn,
    ['cut.inspection','sketch.bearing']);
  assert.deepEqual(after.get('cut.relief').dependsOn,
    before.get('cut.relief').dependsOn);
  assert.ok(result.plan.features.every(row=>row.status==='ready'));
  assert.deepEqual(order(result.document),order(doc));
});

test('moving the middle block forward rewires three boundaries, not block internals',()=>{
  const doc=gearbox();
  const preview=previewBodyCutBlockRelocate(doc,request(doc,{
    cutFeatureIds:['cut.relief','cut.tapping'],
    afterBodyWriterId:'extrude.gearbox',
    eventIds:['move.relief','move.key','move.inspection'],
  }));
  assert.deepEqual(preview.writerOrderAfter,[
    'extrude.gearbox','cut.relief','cut.tapping','cut.key',
    'cut.bearing','cut.inspection',
  ]);
  assert.equal(preview.events.length,3);
  assert.deepEqual(preview.rewiredWriterIds,
    ['cut.relief','cut.key','cut.inspection']);
});

test('cross-body dependent needs rebuild, independent inspection gauge is only a candidate',()=>{
  const doc=gearbox();
  const staged=previewBodyCutBlockRelocate(doc,request(doc));
  assert.deepEqual(staged.invalidatedBodyIds,['body.gearbox','body.bracket']);
  assert.ok(staged.invalidation.readyToEvaluate.includes('cut.bracket.key'));
  assert.ok(staged.invalidation.unchangedReady.includes('extrude.gauge'));
  const manifest=planBodyRebuildManifest(doc,staged.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:doc.projectId,
    expectedFromRevision:doc.revision,
    expectedToRevision:staged.document.revision,
    bodyIds:['body.gearbox','body.bracket','body.gauge'],
  });
  assert.deepEqual(manifest.bodies.map(row=>row.action),
    ['rebuild','rebuild','preserve_candidate']);
});

test('one durable undo frame replays after save/reopen and retrospective source edit',()=>{
  const doc=gearbox();
  let history=commitUndoableBodyCutBlockRelocate(startUndoHistory(doc),request(doc));
  assert.equal(history.undoStack.length,1);
  const after=history.document;
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  history=undoTransaction(history,['undo.bearing','undo.tapping']);
  for(const id of ['cut.bearing','cut.relief','cut.tapping']){
    assert.deepEqual(featuresOf(history.document).find(f=>f.id===id).dependsOn,
      featuresOf(doc).find(f=>f.id===id).dependsOn);
  }
  history=redoTransaction(history,['redo.tapping','redo.bearing']);
  for(const id of ['cut.bearing','cut.relief','cut.tapping']){
    assert.deepEqual(featuresOf(history.document).find(f=>f.id===id).dependsOn,
      featuresOf(after).find(f=>f.id===id).dependsOn);
  }
});

test('destination inventory is paged, source fenced, and shares actual preview admission',()=>{
  const doc=gearbox();
  const first=inventory(doc,{limit:2});
  const second=inventory(doc,{offset:first.nextOffset,limit:2});
  const full=inventory(doc);
  assert.deepEqual([...first.destinations,...second.destinations],full.destinations);
  assert.equal(full.totalDestinations,4);
  assert.equal(full.nextOffset,null);
  assert.deepEqual(full.destinations.map(x=>[x.afterBodyWriterId,x.eligibility]),[
    ['extrude.gearbox','available'],['cut.key','current'],
    ['cut.tapping','available'],['cut.inspection','available'],
  ]);
  const last=full.destinations.at(-1);
  assert.equal(last.requiredEventIds,2);
  const candidate=previewBodyCutBlockRelocate(doc,request(doc,{
    afterBodyWriterId:last.afterBodyWriterId,
    eventIds:last.rewiredWriterIds.map((_,i)=>'chosen.'+i),
  }));
  assert.deepEqual(candidate.writerOrderAfter,last.proposedWriterOrder);
  assert.deepEqual(candidate.invalidatedBodyIds,last.invalidatedBodyIds);
  assert.equal(full.exactGeometryAuthority,false);
  const changed=commitEvent(doc,{
    eventId:'edit.sketch.base',type:'feature.edit',featureId:'sketch.base',
    patch:{payload:{widthMm:130,depthMm:62}},
  });
  const {afterBodyWriterId,eventIds,...oldSelection}=request(doc);
  assert.throws(()=>inspectBodyCutBlockDestinations(changed,{
    ...oldSelection,offset:0,limit:2,
  }),ProjectRevisionError);
  assert.throws(()=>previewBodyCutBlockRelocate(changed,request(doc)),
    ProjectRevisionError);
});

test('stale revision, equal-revision divergent journal, malformed and reordered selection reject',()=>{
  const doc=gearbox(),history=startUndoHistory(doc);
  const original=serializeUndoHistory(history);
  const alternate=commitEvent(newProject(doc.projectId),{
    eventId:'create.alternate',type:'feature.create',
    feature:{id:'other',kind:'sketch',dependsOn:[],writeTargets:[],payload:{}},
  });
  for(const [change,error] of [
    [{expectedRevision:doc.revision-1},ProjectRevisionError],
    [{expectedProjectId:'project.wrong'},ProjectRevisionError],
    [{expectedDocumentFence:serializeProject(alternate)},ProjectRevisionError],
    [{expectedDocumentFence:serializeProject({
      ...doc,journal:doc.journal.map((event,i) =>
        i===0 ? {...event,feature:{...event.feature,payload:{widthMm:127,depthMm:62}}} : event),
    })},ProjectRevisionError],
    [{cutFeatureIds:['cut.relief','cut.bearing']},ProjectFormatError],
    [{cutFeatureIds:['cut.key','cut.relief']},ProjectFormatError],
    [{cutFeatureIds:['cut.bearing','cut.bearing']},ProjectFormatError],
    [{cutFeatureIds:['cut.bearing']},ProjectFormatError],
    [{afterBodyWriterId:'cut.bearing'},ProjectFormatError],
    [{afterBodyWriterId:'cut.key'},ProjectFormatError],
    [{afterBodyWriterId:'body.other'},ProjectFormatError],
    [{eventIds:['one','one']},ProjectFormatError],
    [{eventIds:['one']},ProjectFormatError],
    [{eventIds:['create.cut.key','two']},ProjectFormatError],
    [{extra:true},ProjectFormatError],
  ]){
    assert.throws(()=>commitUndoableBodyCutBlockRelocate(history,request(doc,change)),error);
  }
  assert.equal(serializeUndoHistory(history),original);
});

test('original named-edge topology and explicit selected-edge writer identity block unsafe move',()=>{
  const doc=gearbox();
  const tapping=featuresOf(doc).find(f=>f.id==='cut.tapping');
  const anchored=commitEvent(doc,{
    eventId:'edit.tapping.edge',type:'feature.edit',
    featureId:tapping.id,patch:{payload:{...tapping.payload,selector:{
      format:'intuit3d.semantic-topology-reference',version:1,
      projectId:doc.projectId,atRevision:doc.revision,
      anchor:{kind:'edge',featureId:'cut.relief',roleId:'edge.relief.wall'},
    }}},
  });
  const req=request(anchored);
  assert.throws(()=>previewBodyCutBlockRelocate(anchored,req),
    /requires earlier source writer cut.relief/);
  const blocked=inventory(anchored);
  assert.equal(blocked.destinations.at(-1).eligibility,'blocked');
  assert.match(blocked.destinations.at(-1).diagnostic,
    /requires earlier source writer cut.relief/);
  const selected=commitEvent(doc,{
    eventId:'edit.tapping.edge.writer',type:'feature.edit',
    featureId:tapping.id,patch:{payload:{
      ...tapping.payload,edgeSourceWriterId:'cut.relief',
    }},
  });
  assert.throws(()=>previewBodyCutBlockRelocate(selected,request(selected)),
    /requires earlier source writer cut.relief/);
});

test('actual SKETCH FEATUREOPS RUNTIME servo mount example executes through public contracts',()=>{
  const file=fileURLToPath(new URL('../examples/servo-mount-cut-block-relocate.mjs',
    import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',file],
    {encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr || run.stdout);
  const output=JSON.parse(run.stdout);
  assert.equal(output.format,'intuit3d.body-cut-block-relocate-demo');
  assert.deepEqual(output.bodyActions,['rebuild','rebuild','preserve_candidate']);
  assert.equal(output.archiveUndoRedo,true);
  assert.equal(output.exactGeometryAuthority,false);
  assert.equal(output.nativeSTEP,'not_executed');
});
