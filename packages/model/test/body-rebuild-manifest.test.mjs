import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newProject, commitEvent, serializeProject, deserializeProject,
  ProjectFormatError, ProjectRevisionError,
} from '../src/index.ts';
import {
  BODY_REBUILD_MANIFEST_FORMAT, planBodyRebuildManifest,
} from '../src/body-rebuild-manifest.ts';
import {runLeadScrewCarriageRebuild} from '../examples/lead-screw-carriage-rebuild.mjs';

const f=(id,kind,dependsOn=[],writeTargets=[],payload={})=>
  ({id,kind,dependsOn,writeTargets,payload});
const create=(feature)=>({
  eventId:'author.'+feature.id,type:'feature.create',feature,
});
const edit=(eventId,featureId,patch)=>({
  eventId,type:'feature.edit',featureId,patch,
});
const remove=(eventId,featureId)=>({eventId,type:'feature.remove',featureId});
const restore=(eventId,featureId)=>({eventId,type:'feature.restore',featureId});
const append=(doc,event)=>commitEvent(doc,event);
function prepared(){
  let doc=newProject('project.multi.body.manifest');
  for(const feature of [
    f('sketch.datum','sketch'),
    f('extrude.datum','extrude',['sketch.datum'],['body.datum']),
    f('sketch.arm','sketch'),
    f('extrude.arm','extrude',['sketch.arm'],['body.arm']),
    f('cut.arm','cut',['extrude.arm','sketch.arm','extrude.datum'],['body.arm']),
    f('sketch.gauge','sketch'),
    f('extrude.gauge','extrude',['sketch.gauge'],['body.gauge']),
  ]) doc=append(doc,create(feature));
  return doc;
}
const request=(before,after,bodyIds=['body.arm','body.datum','body.gauge'])=>({
  format:BODY_REBUILD_MANIFEST_FORMAT,version:1,
  expectedProjectId:before.projectId,
  expectedFromRevision:before.revision,expectedToRevision:after.revision,
  bodyIds,
});
const rows=(manifest)=>new Map(manifest.bodies.map((row)=>[row.bodyId,row]));

test('datum sketch edit schedules only two dependent bodies, preserves unaffected gauge',()=>{
  const before=prepared();
  const after=append(before,edit('edit.datum.width','sketch.datum',
    {payload:{widthMm:52}}));
  const original=serializeProject(before);
  const manifest=planBodyRebuildManifest(before,after,request(before,after));
  const r=rows(manifest);
  assert.deepEqual(manifest.bodies.map((b)=>b.action),
    ['rebuild','rebuild','preserve_candidate']);
  assert.deepEqual(r.get('body.arm').invalidatedWriterIds,['cut.arm']);
  assert.deepEqual(r.get('body.arm').unchangedWriterCandidates,['extrude.arm']);
  assert.deepEqual(r.get('body.arm').invalidatedExternalInputIds,
    ['sketch.datum','extrude.datum']);
  assert.deepEqual(r.get('body.arm').externalInputFeatureIds,
    ['sketch.datum','extrude.datum','sketch.arm']);
  assert.deepEqual(r.get('body.datum').invalidatedWriterIds,['extrude.datum']);
  assert.deepEqual(r.get('body.gauge').readyWriterIds,['extrude.gauge']);
  assert.equal(manifest.exactGeometryAuthority,false);
  assert.ok(manifest.bodies.every((b)=>b.requiresProviderValidation));
  assert.equal(serializeProject(before),original);
});

test('retiring the terminal cut requires rebuilding its body, not retiring its extrusion',()=>{
  const before=prepared();
  const after=append(before,remove('remove.cut.arm','cut.arm'));
  const m=rows(planBodyRebuildManifest(before,after,request(before,after)));
  assert.equal(m.get('body.arm').action,'rebuild');
  assert.deepEqual(m.get('body.arm').departedWriterIds,['cut.arm']);
  assert.deepEqual(m.get('body.arm').readyWriterIds,['extrude.arm']);
  assert.deepEqual(m.get('body.arm').invalidatedWriterIds,[]);
  assert.equal(m.get('body.datum').action,'preserve_candidate');
  assert.equal(m.get('body.gauge').action,'preserve_candidate');
});

test('retiring a sole extrusion retires body, and restoring it rebuilds that body',()=>{
  const before=prepared();
  const without=append(before,remove('remove.gauge.extrude','extrude.gauge'));
  const retired=rows(planBodyRebuildManifest(before,without,
    request(before,without)));
  assert.equal(retired.get('body.gauge').action,'retire');
  assert.deepEqual(retired.get('body.gauge').departedWriterIds,['extrude.gauge']);
  const restored=append(without,restore('restore.gauge.extrude','extrude.gauge'));
  const revived=rows(planBodyRebuildManifest(without,restored,
    request(without,restored)));
  assert.equal(revived.get('body.gauge').action,'rebuild');
  assert.deepEqual(revived.get('body.gauge').readyWriterIds,['extrude.gauge']);
});

test('missing datum sketch holds source and dependent arm bodies, not independent gauge',()=>{
  const before=prepared();
  const after=append(before,remove('remove.datum.sketch','sketch.datum'));
  const m=rows(planBodyRebuildManifest(before,after,request(before,after)));
  assert.equal(m.get('body.datum').action,'hold_unresolved');
  assert.equal(m.get('body.arm').action,'hold_unresolved');
  assert.deepEqual(m.get('body.arm').unresolvedWriters.map((x)=>x.featureId),
    ['cut.arm']);
  assert.equal(m.get('body.arm').unresolvedWriters[0].status,'blocked');
  assert.ok(m.get('body.datum').unresolvedWriters[0].diagnosticCodes
    .includes('MISSING_REFERENCE'));
  assert.equal(m.get('body.gauge').action,'preserve_candidate');
});

test('unordered body mutation holds entire body, retaining valid writer evidence only',()=>{
  const before=prepared();
  const after=append(before,create(f('cut.arm.parallel','cut',
    ['sketch.arm'],['body.arm'])));
  const m=rows(planBodyRebuildManifest(before,after,request(before,after)));
  assert.equal(m.get('body.arm').action,'hold_unresolved');
  assert.deepEqual(m.get('body.arm').readyWriterIds,[]);
  assert.ok(m.get('body.arm').unresolvedWriters
    .some((row)=>row.diagnosticCodes.includes('UNORDERED_MUTATION')));
  assert.equal(m.get('body.gauge').action,'preserve_candidate');
});

test('cannot omit an affected cut/extrude target or invent phantom bodies',()=>{
  const before=prepared();
  const after=append(before,edit('edit.datum.width','sketch.datum',
    {payload:{widthMm:52}}));
  assert.throws(()=>planBodyRebuildManifest(before,after,
    request(before,after,['body.datum'])),ProjectFormatError);
  assert.throws(()=>planBodyRebuildManifest(before,after,
    request(before,after,['body.arm','body.datum','body.phantom'])),
    ProjectFormatError);
});

test('stale revision, wrong project, forked journal, rollback and malformed requests refuse',()=>{
  const before=prepared();
  const after=append(before,edit('edit.datum.width','sketch.datum',
    {payload:{widthMm:52}}));
  const req=request(before,after);
  assert.throws(()=>planBodyRebuildManifest(before,after,{
    ...req,expectedToRevision:after.revision-1}),ProjectRevisionError);
  assert.throws(()=>planBodyRebuildManifest(before,after,{
    ...req,expectedProjectId:'project.other'}),ProjectRevisionError);
  assert.throws(()=>planBodyRebuildManifest(after,before,
    request(after,before)),ProjectRevisionError);
  const fork=append(before,edit('edit.alt.width','sketch.datum',
    {payload:{widthMm:54}}));
  assert.throws(()=>planBodyRebuildManifest(after,fork,
    request(after,fork)),ProjectRevisionError);
  for(const bad of [
    {...req,bodyIds:['body.arm','body.arm']},
    {...req,bodyIds:[]},
    {...req,bodyIds:['body.arm','INVALID BODY']},
    {...req,unsupported:true},
    {...req,version:2},
  ]) assert.throws(()=>planBodyRebuildManifest(before,after,bad),
    ProjectFormatError);
});

test('save/reopen produces identical multi-body manifest without retaining provider data',()=>{
  const before=prepared();
  const after=append(before,edit('edit.datum.width','sketch.datum',
    {payload:{widthMm:52}}));
  const expected=planBodyRebuildManifest(before,after,request(before,after));
  const actual=planBodyRebuildManifest(
    deserializeProject(serializeProject(before)),
    deserializeProject(serializeProject(after)),request(before,after));
  assert.deepEqual(actual,expected);
});

test('real SKETCH, FEATUREOPS and RUNTIME carriage/endstop authoring preserves undo and archive',()=>{
  const result=runLeadScrewCarriageRebuild();
  assert.deepEqual(result.actions,[
    ['body.carriage','rebuild'],['body.endstop','rebuild'],
    ['body.gauge','preserve_candidate'],
  ]);
  assert.ok(result.carriageDirty.includes('cut.carriage.stop'));
  assert.equal(result.archiveUndoRedo,true);
  assert.equal(result.exactGeometryAuthority,false);
  assert.equal(result.independentSTEP,false);
});
