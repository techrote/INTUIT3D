import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newProject, commitEvent, planProject, serializeProject, deserializeProject,
} from '../src/index.ts';
import { evaluateParameterPlan } from '../src/parameters.ts';

const lit = (value, unit = 'mm') => ({ op: 'literal', value, unit });
const ref = (featureId) => ({ op: 'ref', featureId });
const parameter = (id, name, expression, dependsOn = []) => ({
  id, kind: 'parameter', dependsOn, writeTargets: [],
  payload: { parameter: { name, unit: 'mm', expression } },
});
const create = (eventId, feature) => ({ eventId, type: 'feature.create', feature });
const state = (plan, id) => plan.features.find(({feature}) => feature.id === id)?.status;
const gate = (result, id) => result.featureGates.find((g) => g.featureId === id);

test('journal permits future parameter dependency and later closes it without rewriting authored order', () => {
  let project = newProject('project.parameters');
  project = commitEvent(project, create('event.width', parameter('parameter.width', 'width',
    { op: 'multiply', left: ref('parameter.base'), right: lit(2, 'unitless') },
    ['parameter.base'])));
  project = commitEvent(project, create('event.extrude', {
    id: 'feature.extrude', kind: 'extrude', dependsOn: ['parameter.width'],
    writeTargets: ['body.plate'], payload: { depthMm: 8 },
  }));
  let plan = planProject(project);
  assert.deepEqual(plan.authoredOrder, ['parameter.width', 'feature.extrude']);
  assert.equal(state(plan, 'parameter.width'), 'pending');
  assert.equal(state(plan, 'feature.extrude'), 'blocked');
  assert.deepEqual(evaluateParameterPlan(plan).admissibleExecutableOrder, []);

  project = commitEvent(project, create('event.base',
    parameter('parameter.base', 'base', lit(60))));
  plan = planProject(project);
  assert.deepEqual(plan.authoredOrder, ['parameter.width', 'feature.extrude', 'parameter.base']);
  assert.deepEqual(plan.executableOrder, ['parameter.base', 'parameter.width', 'feature.extrude']);
  assert.deepEqual(evaluateParameterPlan(plan).parameterValues.map(v => [v.featureId, v.value]),
    [['parameter.width', 120], ['parameter.base', 60]]);

  project = commitEvent(project, {
    eventId: 'event.resize', type: 'feature.edit', featureId: 'parameter.base',
    patch: { payload: { parameter: { name: 'base', unit: 'mm', expression: lit(80) } } },
  });
  const restored = deserializeProject(serializeProject(project));
  assert.deepEqual(restored, project);
  assert.equal(evaluateParameterPlan(planProject(restored)).parameterValues[0].value, 160);
  assert.deepEqual(planProject(restored).authoredOrder, plan.authoredOrder);
});

test('removing and restoring parameter preserves semantic ID and recoverable feature states', () => {
  let doc = newProject('project.recover');
  doc = commitEvent(doc, create('event.base', parameter('parameter.base', 'base', lit(25))));
  doc = commitEvent(doc, create('event.derived', parameter('parameter.derived', 'derived', ref('parameter.base'), ['parameter.base'])));
  doc = commitEvent(doc, {
    eventId: 'event.remove', type: 'feature.remove', featureId: 'parameter.base',
  });
  let evaluated = evaluateParameterPlan(planProject(doc));
  assert.equal(gate(evaluated, 'parameter.derived').status, 'unready');
  assert.deepEqual(evaluated.parameterValues, []);
  doc = commitEvent(doc, {
    eventId: 'event.restore', type: 'feature.restore', featureId: 'parameter.base',
  });
  evaluated = evaluateParameterPlan(planProject(deserializeProject(serializeProject(doc))));
  assert.deepEqual(evaluated.parameterValues.map(v => [v.featureId, v.value]),
    [['parameter.base', 25], ['parameter.derived', 25]]);
});

test('geometric feature may be dependency-ready yet parameter-invalid; derived gate never authorizes it', () => {
  let doc = newProject('project.invalid');
  doc = commitEvent(doc, create('event.bad',
    parameter('parameter.bad', 'bad', { op: 'add', left: lit(5), right: lit(90, 'deg') })));
  doc = commitEvent(doc, create('event.cut', {
    id: 'feature.cut', kind: 'cut', dependsOn: ['parameter.bad'],
    writeTargets: ['body.plate'], payload: {},
  }));
  const planned = planProject(doc);
  assert.equal(state(planned, 'feature.cut'), 'ready');
  const result = evaluateParameterPlan(planned);
  assert.deepEqual(result.admissibleExecutableOrder, []);
  assert.equal(gate(result, 'parameter.bad').diagnostics[0].code, 'UNIT_MISMATCH');
  assert.equal(gate(result, 'feature.cut').status, 'blocked_parameter');
});
