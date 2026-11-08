import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  commitEvent, featuresOf, newProject, planProject,
  ProjectFormatError, ProjectRevisionError, serializeProject,
} from '../src/index.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction,
  serializeUndoHistory, commitUndoableTransaction,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import { inspectBodyCutChain } from '../src/body-cut-chain.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import { BODY_REBUILD_MANIFEST_FORMAT, planBodyRebuildManifest }
  from '../src/body-rebuild-manifest.ts';
import {
  BODY_CUT_RELOCATE_FORMAT, previewBodyCutRelocate,
  commitUndoableBodyCutRelocate, BODY_CUT_DESTINATIONS_FORMAT,
  inspectBodyCutRelocateDestinations,
} from '../src/body-cut-relocate.ts';

const create=(id,kind,dependsOn,writeTargets,payload={})=>({
  eventId:'create.'+id,type:'feature.create',
  feature:{id,kind,dependsOn,writeTargets,payload},
});
function manifold(){
  let doc=newProject('project.hydraulic.manifold');
  for(const e of [
    create('sketch.block','sketch',[],['sketch.block'],{widthMm:140,depthMm:70}),
    create('sketch.axial','sketch',[],['sketch.axial'],{profile:'axial'}),
    create('sketch.gallery','sketch',[],['sketch.gallery'],{profile:'gallery'}),
    create('sketch.pocket','sketch',[],['sketch.pocket'],{profile:'pocket'}),
    create('sketch.exit','sketch',[],['sketch.exit'],{profile:'exit'}),
    create('extrude.manifold','extrude',['sketch.block'],['body.manifold'],
      {sourceSketchId:'sketch.block',thicknessMm:18}),
    create('cut.axial','cut',['extrude.manifold','sketch.axial'],['body.manifold'],
      {sourceSketchId:'sketch.axial',targetBodyId:'body.manifold',throughAll:true}),
    create('cut.gallery','cut',['cut.axial','sketch.gallery'],['body.manifold'],
      {sourceSketchId:'sketch.gallery',targetBodyId:'body.manifold',throughAll:false,depthMm:9}),
    create('cut.pocket','cut',['cut.gallery','sketch.pocket'],['body.manifold'],
      {sourceSketchId:'sketch.pocket',targetBodyId:'body.manifold',throughAll:false,depthMm:5}),
    create('cut.exit','cut',['cut.pocket','sketch.exit'],['body.manifold'],
      {sourceSketchId:'sketch.exit',targetBodyId:'body.manifold',throughAll:true}),
    create('extrude.clamp','extrude',[],['body.clamp'],{thicknessMm:7}),
    create('cut.clamp.edge','cut',['extrude.clamp','cut.exit'],['body.clamp'],
      {targetBodyId:'body.clamp',sourceBodyWriterId:'cut.exit',throughAll:true}),
    create('extrude.gauge','extrude',[],['body.gauge'],{thicknessMm:2}),
  ]) doc=commitEvent(doc,e);
  assert.equal(planProject(doc).features.every(row=>row.status==='ready'),true);
  return doc;
}
const request=(doc,patch={})=>({
  format:BODY_CUT_RELOCATE_FORMAT,version:1,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  targetBodyId:'body.manifold',
  cutFeatureId:'cut.axial',afterBodyWriterId:'cut.pocket',
  eventIds:['relocate.gallery','relocate.axial','relocate.exit'],
  ...patch,
});
const chain=doc=>inspectBodyCutChain(doc,'body.manifold');

test('non-adjacent relocation rewires three body edges, not chronology or authored profiles',()=>{
  const doc=manifold(),before=serializeProject(doc);
  const result=previewBodyCutRelocate(doc,request(doc));
  assert.deepEqual(result.writerOrderBefore,
    ['extrude.manifold','cut.axial','cut.gallery','cut.pocket','cut.exit']);
  assert.deepEqual(result.writerOrderAfter,
    ['extrude.manifold','cut.gallery','cut.pocket','cut.axial','cut.exit']);
  assert.deepEqual(result.rewiredWriterIds,
    ['cut.gallery','cut.axial','cut.exit']);
  assert.equal(result.events.length,3);
  assert.equal(result.document.revision,doc.revision+3);
  assert.equal(result.authoredTimelineChanged,false);
  assert.equal(result.exactGeometryAuthority,false);
  assert.equal(result.requiresNativeRebuild,true);
  assert.equal(serializeProject(doc),before);
  assert.equal(chain(result.document).eligibleAfterWriterId,'cut.exit');
  assert.ok(result.plan.features.every(f=>f.status==='ready'));
  const originals=new Map(featuresOf(doc).map(f=>[f.id,f]));
  const changed=new Map(featuresOf(result.document).map(f=>[f.id,f]));
  for(const id of ['cut.axial','cut.gallery','cut.pocket','cut.exit']){
    assert.deepEqual(changed.get(id).payload,originals.get(id).payload);
    assert.deepEqual(changed.get(id).writeTargets,originals.get(id).writeTargets);
  }
  assert.deepEqual(changed.get('cut.gallery').dependsOn,
    ['extrude.manifold','sketch.gallery']);
  assert.deepEqual(changed.get('cut.axial').dependsOn,
    ['cut.pocket','sketch.axial']);
  assert.deepEqual(changed.get('cut.exit').dependsOn,
    ['cut.axial','sketch.exit']);
  assert.deepEqual(featuresOf(result.document).map(f=>f.id),
    featuresOf(doc).map(f=>f.id));
});

test('cross-body consumers are invalidated but an independent gauge is preserved',()=>{
  const doc=manifold(),preview=previewBodyCutRelocate(doc,request(doc));
  assert.deepEqual(preview.invalidatedBodyIds,['body.manifold','body.clamp']);
  assert.ok(preview.invalidation.readyToEvaluate.includes('cut.clamp.edge'));
  assert.ok(preview.invalidation.unchangedReady.includes('extrude.gauge'));
  const manifest=planBodyRebuildManifest(doc,preview.document,{
    format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
    expectedProjectId:doc.projectId,
    expectedFromRevision:doc.revision,
    expectedToRevision:preview.document.revision,
    bodyIds:['body.manifold','body.clamp','body.gauge'],
  });
  assert.deepEqual(manifest.bodies.map(b=>b.action),
    ['rebuild','rebuild','preserve_candidate']);
  assert.equal(manifest.exactGeometryAuthority,false);
});

test('relocation is one undo frame across an archive and after retrospective edits',()=>{
  let history=startUndoHistory(manifold());
  const original=history.document;
  history=commitUndoableBodyCutRelocate(history,request(original));
  assert.equal(history.undoStack.length,1);
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  assert.equal(chain(history.document).eligibleAfterWriterId,'cut.exit');
  history=undoTransaction(history,['undo.exit','undo.axial','undo.gallery']);
  assert.deepEqual(featuresOf(history.document).map(f=>f.dependsOn),
    featuresOf(original).map(f=>f.dependsOn));
  history=redoTransaction(history,['redo.gallery','redo.axial','redo.exit']);
  const subsequent=history.document;
  history=commitUndoableTransaction(history,[{
    eventId:'resize.block',type:'feature.edit',featureId:'sketch.block',
    patch:{payload:{widthMm:160,depthMm:70}},
  }]);
  const delta=planIncrementalEvaluation(subsequent,history.document);
  assert.ok(delta.readyToEvaluate.includes('cut.exit'));
  assert.ok(delta.readyToEvaluate.includes('cut.clamp.edge'));
  assert.ok(delta.unchangedReady.includes('extrude.gauge'));
});

test('moving a terminal cut to the front rewires just two edges',()=>{
  const doc=manifold();
  const preview=previewBodyCutRelocate(doc,request(doc,{
    cutFeatureId:'cut.exit',afterBodyWriterId:'extrude.manifold',
    eventIds:['move.exit','move.axial'],
  }));
  assert.deepEqual(preview.writerOrderAfter,
    ['extrude.manifold','cut.exit','cut.axial','cut.gallery','cut.pocket']);
  assert.equal(preview.events.length,2);
  assert.equal(chain(preview.document).eligibleAfterWriterId,'cut.pocket');
});

test('moving an initial cut to the terminal slot rewires just two edges',()=>{
  const doc=manifold();
  const preview=previewBodyCutRelocate(doc,request(doc,{
    afterBodyWriterId:'cut.exit',eventIds:['move.gallery','move.axial'],
  }));
  assert.deepEqual(preview.writerOrderAfter,
    ['extrude.manifold','cut.gallery','cut.pocket','cut.exit','cut.axial']);
  assert.equal(preview.events.length,2);
});

test('wrong revision, stale project, invalid IDs, no-op, and malformed fields fail atomically',()=>{
  const doc=manifold(),history=startUndoHistory(doc),frozen=serializeUndoHistory(history);
  for(const change of [
    {expectedProjectId:'project.other'},
    {expectedRevision:doc.revision-1},
    {targetBodyId:'body.gauge'},
    {targetBodyId:'body.other'},
    {cutFeatureId:'extrude.manifold'},
    {cutFeatureId:'cut.unknown'},
    {afterBodyWriterId:'cut.unknown'},
    {afterBodyWriterId:'cut.axial'},
    {afterBodyWriterId:'extrude.manifold'},
    {eventIds:['one','two']},
    {eventIds:['one','one','three']},
    {eventIds:['one','two','three','four']},
    {eventIds:['create.cut.axial','two','three']},
    {extra:true},
  ]){
    assert.throws(()=>commitUndoableBodyCutRelocate(history,request(doc,change)),
      change.expectedProjectId || change.expectedRevision!==undefined
        ? ProjectRevisionError : ProjectFormatError);
  }
  assert.equal(serializeUndoHistory(history),frozen);
});

test('a projected sketch depending on the moving cut cannot become cyclic',()=>{
  let doc=manifold();
  doc=commitEvent(doc,create('sketch.projected','sketch',['cut.axial'],[],
    {projection:'face.after.axial'}));
  const gallery=featuresOf(doc).find(f=>f.id==='cut.gallery');
  doc=commitEvent(doc,{
    eventId:'bind.gallery.projected',type:'feature.edit',featureId:'cut.gallery',
    patch:{dependsOn:[...gallery.dependsOn,'sketch.projected']},
  });
  assert.equal(planProject(doc).features.every(f=>f.status==='ready'),true);
  assert.throws(()=>previewBodyCutRelocate(doc,request(doc)),
    /previously ready feature unresolved/);
});

test('nested authored topology reference forbids dropping its body dependency',()=>{
  const base=manifold(),gallery=featuresOf(base).find(f=>f.id==='cut.gallery');
  const doc=commitEvent(base,{
    eventId:'bind.gallery.edge',type:'feature.edit',featureId:'cut.gallery',
    patch:{payload:{...gallery.payload,placement:{
      references:[{format:'intuit3d.semantic-topology-reference',version:1,
        projectId:base.projectId,atRevision:base.revision,
        anchor:{kind:'edge',featureId:'cut.axial',roleId:'edge.axial.entry'}}],
    }}},
  });
  assert.throws(()=>previewBodyCutRelocate(doc,request(doc)),
    /authored topology on cut.gallery requires earlier source writer cut.axial/);
});


test('non-adjacent writer edge references cannot become future-facing topology',()=>{
  const base=manifold();
  const pocket=featuresOf(base).find(f=>f.id==='cut.pocket');
  // This source is an earlier non-immediate writer, so no immediate chain
  // predecessor is being dropped from this cut during relocation.
  const doc=commitEvent(base,{
    eventId:'bind.pocket.axial.role',type:'feature.edit',
    featureId:'cut.pocket',patch:{payload:{...pocket.payload,selection:{
      guide:{format:'intuit3d.semantic-topology-reference',version:1,
        projectId:base.projectId,atRevision:base.revision,
        anchor:{kind:'edge',featureId:'cut.axial',roleId:'edge.axial.source'}},
    }}},
  });
  assert.ok(planProject(doc).features.every(f=>f.status==='ready'));
  // Moving axial after pocket used to pass because pocket retains its
  // original dependency on gallery and its payload was not rewritten.
  assert.throws(()=>previewBodyCutRelocate(doc,request(doc)),
    /authored topology on cut.pocket requires earlier source writer cut.axial/);
});

test('selected-edge source writer identity is guarded even without a topology mapping',()=>{
  const base=manifold();
  const pocket=featuresOf(base).find(f=>f.id==='cut.pocket');
  const doc=commitEvent(base,{
    eventId:'bind.pocket.edge.origin',type:'feature.edit',
    featureId:'cut.pocket',
    patch:{payload:{...pocket.payload,edgeSourceBodyId:'body.manifold',
      edgeSourceWriterId:'cut.axial'}},
  });
  assert.throws(()=>previewBodyCutRelocate(doc,request(doc)),
    /authored topology on cut.pocket requires earlier source writer cut.axial/);
});

test('a still-earlier authored topology source is preserved across relocation',()=>{
  const base=manifold();
  const pocket=featuresOf(base).find(f=>f.id==='cut.pocket');
  const doc=commitEvent(base,{
    eventId:'bind.pocket.root.role',type:'feature.edit',
    featureId:'cut.pocket',patch:{payload:{...pocket.payload,selection:{
      guide:{format:'intuit3d.semantic-topology-reference',version:1,
        projectId:base.projectId,atRevision:base.revision,
        anchor:{kind:'edge',featureId:'extrude.manifold',roleId:'edge.root'}},
    }}},
  });
  const staged=previewBodyCutRelocate(doc,request(doc));
  assert.equal(staged.plan.features.every(f=>f.status==='ready'),true);
  assert.equal(staged.writerOrderAfter.indexOf('extrude.manifold') <
    staged.writerOrderAfter.indexOf('cut.pocket'),true);
});

test('an unordered extra writer is never silently repaired',()=>{
  const doc=commitEvent(manifold(),create('cut.rogue','cut',
    ['extrude.manifold','sketch.axial'],['body.manifold'],
    {targetBodyId:'body.manifold',throughAll:true}));
  assert.equal(chain(doc).status,'unavailable');
  assert.throws(()=>previewBodyCutRelocate(doc,request(doc)),ProjectFormatError);
});

test('actual SKETCH + FEATUREOPS + RUNTIME hydraulic manifold demo is executable',()=>{
  const file=fileURLToPath(new URL('../examples/hydraulic-manifold-cut-relocate.mjs',
    import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',file],
    {encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr || run.stdout);
  const output=JSON.parse(run.stdout.trim());
  assert.equal(output.format,'intuit3d.body-cut-relocate-demo');
  assert.deepEqual(output.bodyActions,['rebuild','rebuild','preserve_candidate']);
  assert.equal(output.admittedSketchProfiles,4);
  assert.equal(output.archiveUndoRedo,true);
  assert.equal(output.exactGeometryAuthority,false);
  assert.equal(output.nativeSTEP,'not_executed');
});

const inventoryRequest=(doc,patch={})=>({
  format:BODY_CUT_DESTINATIONS_FORMAT,version:1,
  expectedProjectId:doc.projectId,expectedRevision:doc.revision,
  targetBodyId:'body.manifold',cutFeatureId:'cut.axial',
  offset:0,limit:16,...patch,
});

test('destination inventory uses dependency order and distinguishes current, legal and blocked',()=>{
  const doc=manifold(),before=serializeProject(doc);
  const inventory=inspectBodyCutRelocateDestinations(doc,inventoryRequest(doc));
  assert.equal(inventory.format,BODY_CUT_DESTINATIONS_FORMAT);
  assert.equal(inventory.revision,doc.revision);
  assert.deepEqual(inventory.writerOrderBefore,
    ['extrude.manifold','cut.axial','cut.gallery','cut.pocket','cut.exit']);
  assert.equal(inventory.totalDestinations,4);
  assert.equal(inventory.nextOffset,null);
  assert.deepEqual(inventory.destinations.map(x=>[x.afterBodyWriterId,x.eligibility,
    x.requiredEventIds]),[
    ['extrude.manifold','current',0],
    ['cut.gallery','available',3],
    ['cut.pocket','available',3],
    ['cut.exit','available',2],
  ]);
  const pocket=inventory.destinations[2];
  assert.deepEqual(pocket.proposedWriterOrder,
    ['extrude.manifold','cut.gallery','cut.pocket','cut.axial','cut.exit']);
  assert.deepEqual(pocket.invalidatedBodyIds,['body.manifold','body.clamp']);
  assert.deepEqual(pocket.rewiredWriterIds,
    ['cut.gallery','cut.axial','cut.exit']);
  assert.equal(inventory.exactGeometryAuthority,false);
  assert.equal(inventory.requiresNativeRebuildForAvailableMoves,true);
  assert.equal(serializeProject(doc),before);
});

test('paged destination discovery is deterministic and revision-fenced',()=>{
  const doc=manifold();
  const first=inspectBodyCutRelocateDestinations(doc,inventoryRequest(doc,{limit:2}));
  assert.equal(first.offset,0);
  assert.equal(first.nextOffset,2);
  const second=inspectBodyCutRelocateDestinations(doc,
    inventoryRequest(doc,{offset:first.nextOffset,limit:2}));
  assert.equal(second.nextOffset,null);
  const whole=inspectBodyCutRelocateDestinations(doc,inventoryRequest(doc));
  assert.deepEqual([...first.destinations,...second.destinations],whole.destinations);
  const changed=commitEvent(doc,{
    eventId:'change.manifold.sketch',type:'feature.edit',featureId:'sketch.block',
    patch:{payload:{widthMm:150,depthMm:70}},
  });
  assert.throws(()=>inspectBodyCutRelocateDestinations(changed,
    inventoryRequest(doc,{offset:2,limit:2})),ProjectRevisionError);
  assert.throws(()=>previewBodyCutRelocate(changed,request(doc,{
    afterBodyWriterId:'cut.pocket',
  })),ProjectRevisionError);
});

test('destination list surfaces actual nested topology and selected-edge blockers',()=>{
  const base=manifold();
  const pocket=featuresOf(base).find(f=>f.id==='cut.pocket');
  const doc=commitEvent(base,{
    eventId:'pocket.depends.on.axial.edge',type:'feature.edit',
    featureId:'cut.pocket',
    patch:{payload:{...pocket.payload,selector:{
      origin:{format:'intuit3d.semantic-topology-reference',version:1,
        projectId:base.projectId,atRevision:base.revision,
        anchor:{kind:'edge',featureId:'cut.axial',roleId:'edge.source.axial'}}},
    }},
  });
  const choices=inspectBodyCutRelocateDestinations(doc,inventoryRequest(doc));
  assert.deepEqual(choices.destinations.map(x=>x.eligibility),
    ['current','available','blocked','blocked']);
  assert.match(choices.destinations[2].diagnostic,
    /requires earlier source writer cut.axial/);
  assert.equal(choices.destinations[2].requiredEventIds,0);
  assert.deepEqual(choices.destinations[2].invalidatedBodyIds,[]);
  assert.equal(serializeProject(doc),serializeProject(doc));

  const second=commitEvent(base,{
    eventId:'pocket.selected.edge.writer',type:'feature.edit',
    featureId:'cut.pocket',
    patch:{payload:{...pocket.payload,edgeSourceBodyId:'body.manifold',
      edgeSourceWriterId:'cut.axial'}},
  });
  const selected=inspectBodyCutRelocateDestinations(second,inventoryRequest(second));
  assert.equal(selected.destinations[2].eligibility,'blocked');
  assert.match(selected.destinations[2].diagnostic,/requires earlier source writer/);
});

test('destination selection commits exactly the previewed three rewires in one undo frame',()=>{
  const doc=manifold();
  const inventory=inspectBodyCutRelocateDestinations(doc,inventoryRequest(doc));
  const chosen=inventory.destinations.find(x=>x.afterBodyWriterId==='cut.pocket');
  assert.equal(chosen.eligibility,'available');
  const move=request(doc,{
    afterBodyWriterId:chosen.afterBodyWriterId,
    eventIds:Array.from({length:chosen.requiredEventIds},(_,i)=>'chosen.move.'+i),
  });
  const preview=previewBodyCutRelocate(doc,move);
  assert.deepEqual(preview.writerOrderAfter,chosen.proposedWriterOrder);
  assert.deepEqual(preview.invalidatedBodyIds,chosen.invalidatedBodyIds);
  let history=commitUndoableBodyCutRelocate(startUndoHistory(doc),move);
  assert.equal(history.undoStack.length,1);
  assert.deepEqual(chain(history.document).bodyWriterIds.length,5);
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  assert.deepEqual(featuresOf(history.document).map(f=>f.dependsOn),
    featuresOf(preview.document).map(f=>f.dependsOn));
});

test('inventory rejects invalid fences, unsupported bodies and pagination',()=>{
  const doc=manifold(),original=serializeProject(doc);
  for(const change of [
    {expectedProjectId:'project.wrong'},
    {expectedRevision:doc.revision+1},
    {cutFeatureId:'cut.missing'},
    {cutFeatureId:'extrude.manifold'},
    {targetBodyId:'body.gauge'},
    {offset:-1},{offset:4},{offset:1.5},{limit:0},{limit:17},
    {limit:1.5},{extra:true},
  ]) {
    assert.throws(()=>inspectBodyCutRelocateDestinations(doc,
      inventoryRequest(doc,change)),
      change.expectedProjectId || change.expectedRevision!==undefined
        ? ProjectRevisionError : ProjectFormatError);
  }
  const branched=commitEvent(doc,create('cut.unordered','cut',
    ['extrude.manifold','sketch.axial'],['body.manifold'],
    {targetBodyId:'body.manifold',throughAll:true}));
  assert.throws(()=>inspectBodyCutRelocateDestinations(branched,
    inventoryRequest(branched)),ProjectFormatError);
  assert.equal(serializeProject(doc),original);
});
