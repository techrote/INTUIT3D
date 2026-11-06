import assert from 'node:assert/strict';
import test from 'node:test';
import { newProject, commitEvent, planProject, serializeProject, deserializeProject } from '../src/index.ts';
import { evaluateDimensionBindingPlan, DIMENSION_BINDINGS_FORMAT } from '../src/dimension-bindings.ts';

const literal = (value,unit='mm') => ({op:'literal',value,unit});
const ref = featureId => ({op:'ref',featureId});
const expression = (op,left,right) => ({op,left,right});
const manifest = entries => ({format:DIMENSION_BINDINGS_FORMAT,version:1,entries});
const bind = (field,unit,expression) => ({field,unit,expression});
const parameter = (id,value,unit='mm') => ({id,kind:'parameter',dependsOn:[],writeTargets:[],payload:{parameter:{name:'length',unit,expression:literal(value,unit)}}});
const plate = (id,expr,dependsOn=['p.width']) => ({id,kind:'extrude',dependsOn,writeTargets:['body.plate'],payload:{widthMm:1,thicknessMm:8,dimensionBindings:manifest([bind('widthMm','mm',expr)])}});
const create = (eventId,feature) => ({eventId,type:'feature.create',feature});
const value = (result,id,field='widthMm') => result.featureGates.find(g=>g.featureId===id)?.resolvedPayload?.[field];
const gate = (result,id) => result.featureGates.find(g=>g.featureId===id);
const execute = doc => evaluateDimensionBindingPlan(planProject(doc));

function baseProject(width=120) {
  let doc = newProject('project.dimension');
  doc = commitEvent(doc,create('e.plate',plate('feature.plate',ref('p.width'))));
  doc = commitEvent(doc,create('e.width',parameter('p.width',width)));
  return doc;
}

test('retrospective parameter binds in dependency order without changing authored journal',()=>{
  const doc=baseProject(); const previous=serializeProject(doc);
  const result=execute(doc);
  assert.deepEqual(result.admissibleExecutableOrder,['p.width','feature.plate']);
  assert.equal(value(result,'feature.plate'),120);
  assert.equal(gate(result,'feature.plate').status,'bound');
  assert.equal(result.projectId,doc.projectId);
  assert.equal(result.revision,doc.revision);
  assert.equal(serializeProject(doc),previous);
  assert.equal(planProject(doc).features[0].feature.payload.widthMm,1);
  assert.deepEqual(execute(deserializeProject(previous)),result);
});

test('editing earlier parameter updates derived dimension and retains author ID and fallback',()=>{
  let doc=baseProject();
  doc=commitEvent(doc,{eventId:'e.edit',type:'feature.edit',featureId:'p.width',patch:{payload:{parameter:{name:'length',unit:'mm',expression:literal(75)}}}});
  assert.equal(value(execute(doc),'feature.plate'),75);
  assert.equal(planProject(doc).features[0].feature.payload.widthMm,1);
  assert.deepEqual(planProject(doc).authoredOrder,['feature.plate','p.width']);
});

test('pending feature cannot use authored fallback and recovers with future target',()=>{
  let doc=newProject('project.pending');
  doc=commitEvent(doc,create('e.plate',plate('feature.plate',ref('p.width'))));
  assert.equal(gate(execute(doc),'feature.plate').status,'unready');
  assert.equal(value(execute(doc),'feature.plate'),undefined);
  doc=commitEvent(doc,create('e.param',parameter('p.width',120)));
  assert.equal(value(execute(doc),'feature.plate'),120);
});

test('missing declared edge blocks geometry even if parameter exists',()=>{
  let doc=newProject('project.edge');
  doc=commitEvent(doc,create('e.param',parameter('p.width',120)));
  doc=commitEvent(doc,create('e.plate',plate('feature.plate',ref('p.width'),[])));
  const result=execute(doc);
  assert.equal(gate(result,'feature.plate').status,'invalid_binding');
  assert.equal(gate(result,'feature.plate').diagnostics[0].parameterCode,'UNDECLARED_PARAMETER_DEPENDENCY');
  assert.equal(value(result,'feature.plate'),undefined);
});

test('wrong units, division by zero and overflow are explicit without fallback',()=>{
  for (const [expr,expected] of [
    [literal(12,'deg'),'UNIT_MISMATCH'],
    [expression('divide',literal(10),literal(0,'unitless')),'DIVISION_BY_ZERO'],
    [expression('multiply',literal(1e308,'mm'),literal(1e308,'unitless')),'NUMERIC_FAILURE'],
  ]) {
    let doc=newProject('project.invalid');
    doc=commitEvent(doc,create('e.plate',plate('feature.plate',expr,[])));
    const result=execute(doc);
    assert.equal(gate(result,'feature.plate').diagnostics[0].parameterCode,expected);
    assert.equal(gate(result,'feature.plate').resolvedPayload,null);
    assert.deepEqual(result.admissibleExecutableOrder,[]);
  }
});

test('bad binding propagates to dependent solid; unrelated feature continues',()=>{
  let doc=newProject('project.propagate');
  doc=commitEvent(doc,create('e.bad',plate('feature.bad',literal(10,'deg'),[])));
  doc=commitEvent(doc,create('e.cut',{id:'feature.cut',kind:'cut',dependsOn:['feature.bad'],writeTargets:['body.cut'],payload:{depthMm:2}}));
  doc=commitEvent(doc,create('e.ok',{id:'feature.ok',kind:'sketch',dependsOn:[],writeTargets:[],payload:{spanMm:20}}));
  const result=execute(doc);
  assert.equal(gate(result,'feature.bad').status,'invalid_binding');
  assert.equal(gate(result,'feature.cut').status,'blocked_binding');
  assert.equal(gate(result,'feature.cut').resolvedPayload,null);
  assert.deepEqual(result.admissibleExecutableOrder,['feature.ok']);
});

test('multiple bindings apply atomically and are never partially installed',()=>{
  let doc=newProject('project.atomic');
  doc=commitEvent(doc,create('e.plate',{id:'feature.plate',kind:'extrude',dependsOn:[],writeTargets:[],payload:{widthMm:4,depthMm:5,
    dimensionBindings:manifest([bind('widthMm','mm',literal(40)),bind('depthMm','mm',literal(90,'deg'))])}}));
  assert.equal(gate(execute(doc),'feature.plate').resolvedPayload,null);
  assert.equal(gate(execute(doc),'feature.plate').status,'invalid_binding');
});

test('duplicate bindings and nonexistent/nonnumeric targets are rejected',()=>{
  for(const [entries,code] of [
    [[bind('widthMm','mm',literal(30)),bind('widthMm','mm',literal(40))],'DUPLICATE_TARGET'],
    [[bind('thicknessMm','mm',literal(30))],'INVALID_TARGET'],
    [[bind('dimensionBindings','mm',literal(30))],'INVALID_TARGET'],
  ]) {
    let doc=newProject('project.targets');
    doc=commitEvent(doc,create('e.plate',plate('feature.plate',literal(10),[])));
    doc=commitEvent(doc,{eventId:'e.bind',type:'feature.edit',featureId:'feature.plate',patch:{payload:{widthMm:1,dimensionBindings:manifest(entries)}}});
    assert.equal(gate(execute(doc),'feature.plate').diagnostics[0].code,code);
  }
});

test('unsupported manifests and unknown fields fail closed',()=>{
  for(const bad of [
    {format:'intuit3d.dimension-bindings',version:2,entries:[]},
    {format:'intuit3d.dimension-bindings',version:1,entries:[],unknown:true},
    {format:'intuit3d.dimension-bindings',version:1,entries:'not-array'},
  ]) {
    let doc=newProject('project.schema');
    doc=commitEvent(doc,create('e.plate',{id:'feature.plate',kind:'extrude',dependsOn:[],writeTargets:[],payload:{widthMm:2,dimensionBindings:bad}}));
    assert.equal(gate(execute(doc),'feature.plate').diagnostics[0].code,'INVALID_BINDING_FORMAT');
  }
});

test('binding budget fails closed and no invalid dimension is admitted',()=>{
  let doc=newProject('project.bound');
  const entries=Array.from({length:65},()=>bind('widthMm','mm',literal(12)));
  doc=commitEvent(doc,create('e.plate',{id:'feature.plate',kind:'extrude',dependsOn:[],writeTargets:[],payload:{widthMm:1,dimensionBindings:manifest(entries)}}));
  assert.equal(gate(execute(doc),'feature.plate').diagnostics[0].code,'BINDING_LIMIT');
});

test('dimensionless factor scales an explicitly referenced mm parameter',()=>{
  let doc=newProject('project.algebra');
  doc=commitEvent(doc,create('e.base',parameter('p.width',40)));
  doc=commitEvent(doc,create('e.plate',plate('feature.plate',expression('multiply',ref('p.width'),literal(3,'unitless')))));
  assert.equal(value(execute(doc),'feature.plate'),120);
});

test('private evaluation IDs do not become journal or external semantic identities',()=>{
  const doc=baseProject();
  const r=execute(doc);
  assert.deepEqual(r.featureGates.map(g=>g.featureId),['feature.plate','p.width']);
  assert.equal(JSON.stringify(doc).includes('intuitBindingTmp'),false);
  assert.equal(r.featureGates.some(g=>g.featureId.startsWith('intuitBindingTmp')),false);
});
