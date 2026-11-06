import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROJECT_FORMAT, SCHEMA_VERSION, ProjectFormatError, ProjectRevisionError,
  newProject, commitEvent, featuresOf, planProject, serializeProject, deserializeProject,
} from '../src/index.ts';

const feature = (id, dependsOn = [], writeTargets = [], payload = {}) =>
  ({id, kind:'feature', dependsOn, writeTargets, payload});
const create = (eventId, f) => ({eventId, type:'feature.create', feature:f});
const edit = (eventId, featureId, patch) => ({eventId, type:'feature.edit', featureId, patch});
const remove = (eventId, featureId) => ({eventId, type:'feature.remove', featureId});
const restore = (eventId, featureId) => ({eventId, type:'feature.restore', featureId});
const add = (doc, id, deps=[], writes=[], payload={}) =>
  commitEvent(doc, create('event.'+id,feature(id,deps,writes,payload)));
const state = (plan, id) => plan.features.find(f=>f.feature.id===id);

test('empty v1 project is schema-versioned and executable plan is empty', () => {
  const d=newProject('project.test');
  assert.equal(d.format,PROJECT_FORMAT);
  assert.equal(d.schemaVersion,SCHEMA_VERSION);
  assert.equal(d.revision,0);
  assert.deepEqual(planProject(d).executableOrder, []);
});

test('future dependency retains intent and becomes executable after target is authored', () => {
  let d=add(newProject('project.one'),'feature.cut',['feature.plate']);
  let p=planProject(d);
  assert.equal(state(p,'feature.cut').status,'pending');
  assert.deepEqual(state(p,'feature.cut').diagnostics.map(x=>x.code),['MISSING_REFERENCE']);
  assert.deepEqual(p.executableOrder, []);
  d=add(d,'feature.plate');
  p=planProject(d);
  assert.deepEqual(p.authoredOrder,['feature.cut','feature.plate']);
  assert.deepEqual(p.executableOrder,['feature.plate','feature.cut']);
  assert.equal(state(p,'feature.cut').status,'ready');
});

test('unrelated valid intent remains executable when another feature is pending', () => {
  let d=add(newProject('project.one'),'feature.cut',['feature.absent']);
  d=add(d,'feature.sketch');
  const p=planProject(d);
  assert.deepEqual(p.executableOrder,['feature.sketch']);
  assert.equal(state(p,'feature.cut').status,'pending');
});

test('pending dependency blocks descendant rather than making it independently executable', () => {
  let d=add(newProject('project.one'),'feature.a',['feature.absent']);
  d=add(d,'feature.b',['feature.a']);
  const p=planProject(d);
  assert.equal(state(p,'feature.a').status,'pending');
  assert.equal(state(p,'feature.b').status,'blocked');
  assert.equal(state(p,'feature.b').diagnostics[0].code,'BLOCKED_DEPENDENCY');
});

test('cycle diagnostics retain both members but leave unrelated features evaluable', () => {
  let d=add(newProject('project.one'),'feature.a',['feature.b']);
  d=add(d,'feature.b',['feature.a']);
  d=add(d,'feature.ok');
  d=add(d,'feature.child',['feature.a']);
  const p=planProject(d);
  assert.equal(state(p,'feature.a').status,'conflicted');
  assert.equal(state(p,'feature.b').status,'conflicted');
  assert.equal(state(p,'feature.child').status,'blocked');
  assert.ok(state(p,'feature.a').diagnostics.some(x=>x.code==='DEPENDENCY_CYCLE'));
  assert.deepEqual(p.executableOrder,['feature.ok']);
});

test('self dependency is classified explicitly', () => {
  const p=planProject(add(newProject('project.one'),'feature.a',['feature.a']));
  assert.equal(state(p,'feature.a').status,'conflicted');
  assert.equal(state(p,'feature.a').diagnostics[0].code,'SELF_DEPENDENCY');
});

test('independent same-body writes conflict, despite seemingly convenient authored order', () => {
  let d=add(newProject('project.one'),'feature.cutA',[],['body.plate']);
  d=add(d,'feature.cutB',[],['body.plate']);
  const p=planProject(d);
  assert.deepEqual(p.executableOrder,[]);
  assert.equal(state(p,'feature.cutA').status,'conflicted');
  assert.equal(state(p,'feature.cutB').diagnostics[0].code,'UNORDERED_MUTATION');
});

test('explicit dependency including transitive ordering permits same-body mutation', () => {
  let d=add(newProject('project.one'),'feature.third',['feature.middle'],['body.plate']);
  d=add(d,'feature.middle',['feature.first']);
  d=add(d,'feature.first',[],['body.plate']);
  assert.deepEqual(planProject(d).executableOrder,['feature.first','feature.middle','feature.third']);
});

test('unrelated writes on different body targets are independently schedulable', () => {
  let d=add(newProject('project.one'),'feature.a',[],['body.first']);
  d=add(d,'feature.b',[],['body.second']);
  assert.deepEqual(planProject(d).executableOrder,['feature.a','feature.b']);
});

test('save, load, replay retain IDs, edit history, intent values and deterministic plan', () => {
  let d=add(newProject('project.one'),'feature.plate',[],['body.plate'],{mm:80, params:{name:'width', expression:'plate_width'}});
  d=add(d,'feature.hole',['feature.plate'],['body.plate'],{radius:2.5});
  d=commitEvent(d,edit('event.edit.1','feature.plate',{payload:{mm:90,params:{name:'width',expression:'plate_width'}}}));
  const bytes=serializeProject(d);
  const restored=deserializeProject(bytes);
  assert.equal(serializeProject(restored), bytes);
  assert.deepEqual(planProject(restored), planProject(d));
  assert.deepEqual(restored.journal.map(x=>x.eventId),['event.feature.plate','event.feature.hole','event.edit.1']);
  assert.equal(featuresOf(restored)[0].payload.mm,90);
});

test('remove and restore preserve semantic identity and original authoring position', () => {
  let d=add(newProject('project.one'),'feature.first');
  d=add(d,'feature.second',['feature.first']);
  d=commitEvent(d,remove('event.remove','feature.first'));
  assert.deepEqual(planProject(d).authoredOrder,['feature.second']);
  assert.equal(state(planProject(d),'feature.second').status,'pending');
  d=commitEvent(d,restore('event.restore','feature.first'));
  assert.deepEqual(planProject(d).authoredOrder,['feature.first','feature.second']);
  assert.deepEqual(planProject(d).executableOrder,['feature.first','feature.second']);
});

test('removed feature IDs cannot be silently recycled with different identity', () => {
  let d=add(newProject('project.one'),'feature.first');
  d=commitEvent(d,remove('event.remove','feature.first'));
  assert.throws(()=>commitEvent(d,create('event.recreate',feature('feature.first'))),ProjectFormatError);
});

test('invalid edits cannot target unknown or removed features', () => {
  const d=newProject('project.one');
  assert.throws(()=>commitEvent(d,edit('event.edit','feature.unknown',{kind:'sketch'})),ProjectFormatError);
  const r=commitEvent(add(d,'feature.a'),remove('event.remove','feature.a'));
  assert.throws(()=>commitEvent(r,edit('event.edit','feature.a',{kind:'sketch'})),ProjectFormatError);
});

test('revision check prevents stale concurrent writer and preserves original input', () => {
  const d=newProject('project.one');
  const next=add(d,'feature.a');
  assert.equal(d.revision,0);
  assert.equal(next.revision,1);
  assert.throws(()=>commitEvent(next,create('event.next',feature('feature.b')),0),ProjectRevisionError);
});

test('unsupported project versions, tampered journal length and duplicates fail closed', () => {
  const d=add(newProject('project.one'),'feature.a');
  assert.throws(()=>deserializeProject(JSON.stringify({...d,schemaVersion:2})),ProjectFormatError);
  assert.throws(()=>deserializeProject(JSON.stringify({...d,revision:99})),ProjectFormatError);
  assert.throws(()=>deserializeProject(JSON.stringify({...d,revision:2,journal:[d.journal[0],d.journal[0]]})),ProjectFormatError);
});

test('JSON payload rejects invalid numbers, unsafe prototype keys and non-JSON values', () => {
  const d=newProject('project.one');
  assert.throws(()=>commitEvent(d,create('event.bad',feature('feature.a',[],[],{x:Infinity}))),ProjectFormatError);
  assert.throws(()=>commitEvent(d,create('event.bad',feature('feature.a',[],[],{x:undefined}))),ProjectFormatError);
  assert.throws(()=>commitEvent(d,create('event.bad',feature('feature.a',[],[],JSON.parse('{"__proto__":7}')))),ProjectFormatError);
});

test('clone snapshot protects caller input from nested payload mutation', () => {
  const payload={nested:{dimension:20}};
  const d=commitEvent(newProject('project.one'),create('event.a',feature('feature.a',[],[],payload)));
  payload.nested.dimension=900;
  assert.equal(featuresOf(d)[0].payload.nested.dimension,20);
});

test('duplicate dependency/write IDs and journal keys are rejected', () => {
  const d=newProject('project.one');
  assert.throws(()=>commitEvent(d,create('event.a',feature('feature.a',['feature.b','feature.b']))),ProjectFormatError);
  assert.throws(()=>commitEvent(d,create('event.a',feature('feature.a',[],['body.one','body.one']))),ProjectFormatError);
});
