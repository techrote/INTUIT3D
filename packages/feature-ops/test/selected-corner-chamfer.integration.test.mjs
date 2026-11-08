import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as sketch from '@intuit3d/sketch';
import * as chamfer from '@intuit3d/sketch/selected-corner-chamfer/v1';
import {makeInstrumentCover,command,services,runtime,runDemo}
  from '../examples/chamfered-instrument-cover.mjs';
import {authorSelectedCornerChamfer,editSelectedCornerChamfer,
  dragSelectedCornerChamfer}
  from '@intuit3d/feature-ops/selected-corner-chamfer/v1';

const feature=(h,id)=>model.featuresOf(h.document).find(f=>f.id===id);
const create=(h,s,overrides={})=>command(h,s,'cover:ne',{
  cornerPointId:'outline.ne',incomingMm:14,outgoingMm:9,...overrides});
const edit=(h,s,overrides={})=>command(h,s,'cover:ne',{
  incomingMm:18,outgoingMm:12,...overrides});
test('real four-hole cover chamfer commits one revision and invalidates only the named body',()=>{
  const {history,selection}=makeInstrumentCover();
  const original=sketch.serializeSketch(feature(history,'sketch.cover').payload.sketch);
  const result=authorSelectedCornerChamfer(history,create(history,selection),services);
  assert.equal(result.kind,'committed');
  assert.equal(result.history.document.revision,history.document.revision+1);
  assert.equal(result.history.undoStack.length,history.undoStack.length+1);
  assert.equal(result.chamfer.cornerPointId,'outline.ne');
  assert.equal(result.chamfer.incomingMm,14);
  assert.equal(result.chamfer.outgoingMm,9);
  assert.notEqual(sketch.serializeSketch(
    feature(result.history,'sketch.cover').payload.sketch),original);
  assert.deepEqual(JSON.parse(JSON.stringify(
    feature(result.history,'sketch.cover').payload.selectedProfileSelection)),
    result.selectedProfile);
  assert.deepEqual(result.semanticIds.cutFeatureIds,['cut.cover.holes']);
  for(const id of ['sketch.cover','extrude.cover','cut.cover.holes'])
    assert.ok(result.invalidation.invalidatedFeatureIds.includes(id),id);
  for(const id of ['sketch.brace','extrude.brace','cut.brace'])
    assert.ok(!result.invalidation.invalidatedFeatureIds.includes(id),id);
  assert.equal(result.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
  assert.equal(result.exactAuthority,false);
  assert.equal(result.independentInteroperability,false);
});
test('two different corners retain stable IDs through retrospective edits, drag and archive',()=>{
  const {history,selection}=makeInstrumentCover();
  const first=authorSelectedCornerChamfer(history,create(history,selection),services);
  const second=authorSelectedCornerChamfer(first.history,
    command(first.history,first.selectedProfile,'cover:nw',{
      cornerPointId:'outline.nw',incomingMm:11,outgoingMm:7}),services);
  const resized=editSelectedCornerChamfer(second.history,
    edit(second.history,second.selectedProfile),services);
  const source=feature(resized.history,'sketch.cover').payload.sketch;
  const nw=chamfer.inspectSelectedCornerChamfer(source,resized.selectedProfile,'cover:nw');
  assert.equal(nw.kind,'selected_corner_chamfer');
  const handle=nw.handles.find(h=>h.kind==='outgoing');
  const dragged=dragSelectedCornerChamfer(resized.history,
    command(resized.history,resized.selectedProfile,'cover:nw',{
      handleId:handle.id,target:{x:handle.position.x+3,y:handle.position.y-2}
    }),services);
  assert.ok(dragged.gesture.projectionDeviationMm>0);
  const undo=runtime.undo(dragged.history,['corner.undo']);
  const redo=runtime.redo(undo,['corner.redo']);
  const reopened=runtime.reopen(runtime.save(redo));
  const saved=feature(reopened,'sketch.cover').payload;
  const ne=chamfer.inspectSelectedCornerChamfer(saved.sketch,
    saved.selectedProfileSelection,'cover:ne');
  const nwReopen=chamfer.inspectSelectedCornerChamfer(saved.sketch,
    saved.selectedProfileSelection,'cover:nw');
  assert.equal(ne.kind,'selected_corner_chamfer');
  assert.equal(nwReopen.kind,'selected_corner_chamfer');
  assert.deepEqual([ne.incomingMm,ne.outgoingMm],[18,12]);
  assert.notEqual(nwReopen.outgoingMm,7);
  assert.deepEqual(saved.sketch.circles.map(x=>x.id).sort(),
    ['hole.ne','hole.nw','hole.se','hole.sw']);
  assert.equal(feature(reopened,'cut.cover.holes').id,'cut.cover.holes');
  assert.equal(feature(reopened,'extrude.brace').payload.thicknessMm,5);
});
test('missing, wrong-body, invalid-corner, ambiguous and stale selection fail before mutation',()=>{
  const {history,selection}=makeInstrumentCover();
  const bytes=JSON.stringify(history);
  const invalid=[
    {sourceSketchId:'sketch.brace'},
    {extrudeFeatureId:'extrude.brace'},
    {targetBodyId:'body.brace'},
    {targetBodyId:'body.unknown'},
    {expectedCutFeatureIds:[]},
    {expectedCutFeatureIds:['cut.brace']},
    {expectedProjectId:'other.project'},
    {expectedRevision:history.document.revision-1},
    {units:'inch'},{frame:'world_xy'},
    {cornerPointId:'outline.none'},
    {cornerPointId:'hole.ne.center'},
    {cornerPointId:'outline.sw',incomingMm:999},
    {incomingMm:0},{incomingMm:999},
    {outgoingMm:-1},{outgoingMm:1e9},
    {selection:{...selection,candidateId:'cycle:old'}},
    {selection:{...selection,sourceSignature:'old'}},
    {chamferId:'extrude.cover'}
  ];
  for(const update of invalid){
    assert.throws(()=>authorSelectedCornerChamfer(history,{
      ...create(history,selection),...update},services),JSON.stringify(update));
    assert.equal(JSON.stringify(history),bytes);
  }
});
test('retrospective edits refuse no-ops, forged handles and external SKETCH revisions',()=>{
  const {history,selection}=makeInstrumentCover();
  const made=authorSelectedCornerChamfer(history,create(history,selection),services);
  const bytes=JSON.stringify(made.history);
  const bad=[
    {incomingMm:14,outgoingMm:9},
    {incomingMm:0},{incomingMm:9000},{outgoingMm:Number.NaN},
    {chamferId:'missing.chamfer'},
    {expectedRevision:made.history.document.revision-1},
    {expectedCutFeatureIds:['cut.brace']},
    {selection:{...made.selectedProfile,sourceSignature:'stale'}},
    {targetBodyId:'body.brace'}
  ];
  for(const update of bad){
    assert.throws(()=>editSelectedCornerChamfer(made.history,{
      ...edit(made.history,made.selectedProfile),...update},services),
    JSON.stringify(update));
    assert.equal(JSON.stringify(made.history),bytes);
  }
  const handle=made.chamfer.handles[0];
  for(const update of [
    {handleId:'fake.handle'},{target:{x:Infinity,y:4}},
    {target:{x:NaN,y:4}},{targetBodyId:'body.brace'}
  ]){
    assert.throws(()=>dragSelectedCornerChamfer(made.history,{
      ...command(made.history,made.selectedProfile,'cover:ne',{
        handleId:handle.id,target:{x:handle.position.x+1,y:handle.position.y}
      }),...update},services));
    assert.equal(JSON.stringify(made.history),bytes);
  }
  const external=runtime.editSketchConstraints(made.history,{
    sketchFeatureId:'sketch.cover',eventId:'external.cover.width',
    expectedRevision:made.history.document.revision,
    edits:[{constraintId:'outline.width',patch:{value:190}}],
    admission:'require_admissible'
  });
  assert.equal(external.kind,'committed');
  assert.throws(()=>editSelectedCornerChamfer(external.history,
    edit(external.history,made.selectedProfile),services),/stale selected SKETCH/);
});
test('public Node consumer rebuilds a dual-bevel instrument cover and independent brace',()=>{
  const filename=fileURLToPath(new URL(
    '../examples/chamfered-instrument-cover.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',filename],
    {encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||String(run.error));
  const out=JSON.parse(run.stdout);
  assert.equal(out.operation,'@intuit3d/feature-ops/selected-corner-chamfer/v1');
  assert.deepEqual(out.chamferIds,['cover:ne','cover:nw']);
  assert.equal(out.coverDepthMm,13);
  assert.equal(out.unchangedBraceDepthMm,5);
  assert.equal(out.unchangedBraceCutId,'cut.brace');
  assert.equal(out.braceUnaffected,true);
  assert.ok(out.dragProjectionDeviationMm>0);
  assert.equal(out.exactAuthority,false);
  assert.deepEqual(out.status.map(x=>x[1]),
    ['analytic_profile_only','preview_only','pending_exact_provider']);
});
test('the library example is callable without injected fake services',()=>{
  const out=runDemo();
  assert.equal(out.revisions.first,out.revisions.start+1);
  assert.equal(out.revisions.second,out.revisions.first+1);
  assert.equal(out.revisions.edited,out.revisions.second+1);
  assert.equal(out.revisions.dragged,out.revisions.edited+1);
});
