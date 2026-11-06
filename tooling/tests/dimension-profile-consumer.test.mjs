/**
 * INTEGRATION: published INTENT dimension binding -> SKETCH analytic profile
 * (no exact kernel/browser claim). Tests public APIs and explicit fail-closed handoff.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject, commitEvent, planProject, serializeProject, deserializeProject} from '@intuit3d/model';
import {evaluateDimensionBindingPlan} from '@intuit3d/model/dimension-bindings';
import {plateSketchFixture, editConstraint, serializeSketch} from '@intuit3d/sketch';
import {discoverPlateProfiles, admitDiscoveredPlateProfile} from '@intuit3d/sketch/profile-discovery/v1';

const literal=(value,unit='mm')=>({op:'literal',value,unit});
const widthBinding=expression=>({format:'intuit3d.dimension-bindings',version:1,
  entries:[{field:'widthMm',unit:'mm',expression}]});
const feature=(id,kind,dependsOn,payload)=>({id,kind,dependsOn,writeTargets:[],payload});
const create=(eventId,item)=>({eventId,type:'feature.create',feature:item});
const gate=(result,id)=>result.featureGates.find(f=>f.featureId===id);
function project() {
  let doc=newProject('integration.profile-binding');
  // The extrude feature is deliberately authored before its parameter.
  doc=commitEvent(doc,create('event.plate',feature('feature.plate','extrude',['parameter.width'],{
    widthMm:1, thicknessMm:8,dimensionBindings:widthBinding({op:'ref',featureId:'parameter.width'})
  })));
  doc=commitEvent(doc,create('event.width',feature('parameter.width','parameter',[],{
    parameter:{name:'width',unit:'mm',expression:literal(120)}
  })));
  return doc;
}
function profileForGate(g) {
  assert.equal(g.status,'bound');
  assert.ok(g.resolvedPayload);
  const sketch=editConstraint(plateSketchFixture(),'width',{value:g.resolvedPayload.widthMm});
  const proposal=discoverPlateProfiles(sketch);
  assert.equal(proposal.status,'ready');
  assert.equal(proposal.previewOnly,true);
  const analytic=admitDiscoveredPlateProfile(sketch,proposal,proposal.candidates[0].id);
  assert.equal(analytic.status,'analytic_profile_only');
  return {sketch,proposal,analytic};
}

test('nonchronological parameter binds a real solved plate sketch after deterministic save/reopen',()=>{
  const doc=project(), saved=serializeProject(doc), reopened=deserializeProject(saved);
  assert.equal(serializeProject(reopened),saved);
  const plan=planProject(reopened), result=evaluateDimensionBindingPlan(plan);
  assert.deepEqual(plan.authoredOrder,['feature.plate','parameter.width']);
  assert.deepEqual(result.admissibleExecutableOrder,['parameter.width','feature.plate']);
  assert.equal(result.revision,reopened.revision);
  assert.equal(gate(result,'feature.plate').resolvedPayload.widthMm,120);
  assert.equal(plan.features[0].feature.payload.widthMm,1);
  const {sketch,analytic}=profileForGate(gate(result,'feature.plate'));
  assert.equal(serializeSketch(sketch),serializeSketch(editConstraint(plateSketchFixture(),'width',{value:120})));
  assert.equal(analytic.holes.length,2);
  assert.ok(Math.abs(analytic.areaMm2-(9600-72*Math.PI))<1e-8);
});

test('retrospective parameter edit updates analytic preview but fences the former proposal',()=>{
  const doc=project(), old=evaluateDimensionBindingPlan(planProject(doc));
  const original=profileForGate(gate(old,'feature.plate'));
  const edited=commitEvent(doc,{eventId:'event.edit-width',type:'feature.edit',featureId:'parameter.width',
    patch:{payload:{parameter:{name:'width',unit:'mm',expression:literal(140)}}}});
  const roundtrip=deserializeProject(serializeProject(edited));
  const updated=evaluateDimensionBindingPlan(planProject(roundtrip));
  assert.equal(updated.revision,old.revision+1);
  assert.equal(gate(updated,'feature.plate').resolvedPayload.widthMm,140);
  const next=profileForGate(gate(updated,'feature.plate'));
  assert.ok(Math.abs(next.analytic.areaMm2-(11200-72*Math.PI))<1e-8);
  assert.throws(()=>admitDiscoveredPlateProfile(next.sketch,original.proposal,
    original.proposal.candidates[0].id),/stale, ambiguous or modified/);
  assert.equal(gate(updated,'feature.plate').status,'bound');
  assert.equal(planProject(roundtrip).features[0].feature.payload.widthMm,1);
});

test('invalid unit binding never supplies a sketch candidate through stale numeric fallback',()=>{
  const doc=project();
  const broken=commitEvent(doc,{eventId:'event.invalid-width',type:'feature.edit',featureId:'parameter.width',
    patch:{payload:{parameter:{name:'width',unit:'deg',expression:literal(120,'deg')}}}});
  const evaluated=evaluateDimensionBindingPlan(planProject(broken));
  const plate=gate(evaluated,'feature.plate');
  assert.equal(plate.resolvedPayload,null);
  assert.equal(plate.status,'invalid_binding');
  assert.equal(evaluated.admissibleExecutableOrder.includes('feature.plate'),false);
  assert.equal(planProject(broken).features[0].feature.payload.widthMm,1);
});
