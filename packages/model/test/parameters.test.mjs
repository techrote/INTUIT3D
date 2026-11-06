import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateParameterPlan } from '../src/parameters.ts';

const lit = (value, unit='unitless') => ({ op: 'literal', value, unit });
const ref = featureId => ({ op: 'ref', featureId });
const op = (op,left,right) => ({op,left,right});
const parameter = (id,name,unit,expression,dependsOn=[]) => ({id,kind:'parameter',dependsOn,payload:{parameter:{name,unit,expression}}});
const feature = (id,dependsOn=[]) => ({id,kind:'extrude',dependsOn,payload:{}});
const plan = (order, entries) => ({executableOrder: order,features: entries.map(entry=>({feature:entry,status:'ready'}))});
const byId = (result,id) => result.featureGates.find(x=>x.featureId===id);

test('evaluates retrospective dependency order; keeps authored order and semantic ID binding',()=>{
  const plate = parameter('p.plate','plate_width','mm',op('multiply',ref('p.base'),lit(2)),['p.base']);
  const base = parameter('p.base','base_width','mm',lit(60,'mm'));
  const extrude = feature('cut.1',['p.plate']);
  const p = plan(['p.base','p.plate','cut.1'],[plate,extrude,base]);
  const copy = structuredClone(p);
  const r = evaluateParameterPlan(p);
  assert.deepEqual(r.parameterValues.map(v=>[v.featureId,v.value,v.unit]),[['p.plate',120,'mm'],['p.base',60,'mm']]);
  assert.deepEqual(r.admissibleExecutableOrder,['p.base','p.plate','cut.1']);
  assert.deepEqual(r.featureGates.map(x=>x.status),['admissible','admissible','admissible']);
  assert.deepEqual(p,copy);
});

test('unresolved or cyclic model plan remains unready and never fabricates values',()=>{
  const p = parameter('p.future','future','mm',ref('p.missing'),['p.missing']);
  const r = evaluateParameterPlan({features:[{feature:p,status:'pending'},{feature:feature('cut.1',['p.future']),status:'blocked'}],executableOrder:[]});
  assert.deepEqual(r.admissibleExecutableOrder,[]);
  assert.deepEqual(r.parameterValues,[]);
  assert.deepEqual(r.featureGates.map(x=>x.status),['unready','unready']);
});

test('bad unit arithmetic blocks both parameter and descendant geometric feature',()=>{
  const bad = parameter('p.bad','bad','mm',op('add',lit(3,'mm'),lit(90,'deg')));
  const r=evaluateParameterPlan(plan(['p.bad','plate.1'],[bad,feature('plate.1',['p.bad'])]));
  assert.deepEqual(r.admissibleExecutableOrder,[]);
  assert.equal(byId(r,'p.bad').diagnostics[0].code,'UNIT_MISMATCH');
  assert.equal(byId(r,'plate.1').status,'blocked_parameter');
});

test('reference requires explicit graph edge even when value is in scope',()=>{
  const base=parameter('p.base','base','mm',lit(40,'mm'));
  const refWithoutEdge=parameter('p.derived','derived','mm',ref('p.base'));
  const r=evaluateParameterPlan(plan(['p.base','p.derived'],[base,refWithoutEdge]));
  assert.equal(byId(r,'p.derived').diagnostics[0].code,'UNDECLARED_PARAMETER_DEPENDENCY');
});

test('reference cannot silently target non-parameter feature',()=>{
  const body=feature('body.1');
  const p=parameter('p.bad','bad','mm',ref('body.1'),['body.1']);
  const r=evaluateParameterPlan(plan(['body.1','p.bad'],[p,body]));
  assert.equal(byId(r,'p.bad').diagnostics[0].code,'INVALID_PARAMETER_REFERENCE');
});

test('parameter failure propagates across multi-step parameter and solid feature chains',()=>{
  const bad=parameter('p.a','a','mm',op('divide',lit(4,'mm'),lit(0)));
  const derived=parameter('p.b','b','mm',op('multiply',ref('p.a'),lit(2)),['p.a']);
  const cut=feature('cut',['p.b']);
  const good=parameter('p.good','good','deg',lit(30,'deg'));
  const r=evaluateParameterPlan(plan(['p.a','p.good','p.b','cut'],[bad,derived,cut,good]));
  assert.deepEqual(r.admissibleExecutableOrder,['p.good']);
  assert.equal(byId(r,'p.a').diagnostics[0].code,'DIVISION_BY_ZERO');
  assert.equal(byId(r,'p.b').status,'blocked_parameter');
  assert.equal(byId(r,'cut').status,'blocked_parameter');
  assert.deepEqual(r.parameterValues.map(x=>x.featureId),['p.good']);
});

test('dimensionless quotient and same-unit algebra can be chained',()=>{
  const a=parameter('p.factor','factor','unitless',op('divide',lit(10,'mm'),lit(5,'mm')));
  const b=parameter('p.final','final','mm',op('subtract',op('multiply',ref('p.factor'),lit(90,'mm')),lit(60,'mm')),['p.factor']);
  const r=evaluateParameterPlan(plan(['p.factor','p.final'],[a,b]));
  assert.deepEqual(r.parameterValues.map(x=>x.value),[2,120]);
});

test('disallows unsupported derived units instead of treating area as length',()=>{
  const p=parameter('p.area','area','mm',op('multiply',lit(2,'mm'),lit(3,'mm')));
  const r=evaluateParameterPlan(plan(['p.area'],[p]));
  assert.equal(byId(r,'p.area').diagnostics[0].code,'UNIT_MISMATCH');
});

test('explicit declaration unit must agree with computed value',()=>{
  const p=parameter('p.w','w','mm',lit(12,'unitless'));
  const r=evaluateParameterPlan(plan(['p.w'],[p]));
  assert.equal(byId(r,'p.w').diagnostics[0].code,'UNIT_MISMATCH');
});

test('non-finite inputs, overflow and underflow reject rather than change engineering meaning',()=>{
  const inputs=[
    [lit(Infinity,'mm'),'PARAMETER_FORMAT'],
    [op('multiply',lit(1e308),lit(1e308)),'NUMERIC_FAILURE'],
    [op('multiply',lit(1e-300),lit(1e-300)),'NUMERIC_FAILURE'],
    [op('divide',lit(1),lit(0)),'DIVISION_BY_ZERO'],
  ];
  for (const [expr,code] of inputs) {
    const p=parameter('p.bad','bad','mm',expr);
    // Multiplication/division cases have unitless output but numeric errors take precedence.
    const r=evaluateParameterPlan(plan(['p.bad'],[p]));
    assert.equal(byId(r,'p.bad').diagnostics[0].code,code);
  }
});

test('malformed payload, unknown ops and dangerous keys are rejected',()=>{
  for (const data of [null,{}, {name:'x',unit:'mm',expression:{op:'wat'}}, {name:'x',unit:'mm',expression:JSON.parse('{"op":"literal","unit":"mm","value":1,"__proto__":5}')}, {name:'invalid name',unit:'mm',expression:lit(1,'mm')}]) {
    const p={id:'p.bad',kind:'parameter',dependsOn:[],payload:{parameter:data}};
    const r=evaluateParameterPlan(plan(['p.bad'],[p]));
    assert.equal(byId(r,'p.bad').status,'invalid_parameter');
  }
});

test('deep expressions are bounded',()=>{
  let expr=lit(1,'mm');for(let i=0;i<70;i++)expr={op:'negate',operand:expr};
  const r=evaluateParameterPlan(plan(['p.deep'],[parameter('p.deep','deep','mm',expr)]));
  assert.equal(byId(r,'p.deep').diagnostics[0].code,'EXPRESSION_LIMIT');
});

test('new resolution after historical edit is derived, without modifying input',()=>{
  const p=parameter('p.w','width','mm',lit(30,'mm'));
  const initial=plan(['p.w','cut'],[p,feature('cut',['p.w'])]);
  const before=evaluateParameterPlan(initial);
  const revised=structuredClone(initial);revised.features[0].feature.payload.parameter.expression.value=50;
  const after=evaluateParameterPlan(revised);
  assert.equal(before.parameterValues[0].value,30);
  assert.equal(after.parameterValues[0].value,50);
  assert.equal(initial.features[0].feature.payload.parameter.expression.value,30);
  assert.deepEqual(before.admissibleExecutableOrder,after.admissibleExecutableOrder);
});
