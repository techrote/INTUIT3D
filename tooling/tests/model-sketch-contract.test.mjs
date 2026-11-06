/**
 * INTUIT3D integration: model intent, sketch profiles and a non-geometric
 * analytic oracle. This test does NOT run OCCT or qualify solid/STEP output.
 * Source providers are byte-identical to their respective in-flight lane PRs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  newProject, commitEvent, planProject, serializeProject, deserializeProject,
} from '../../packages/model/src/index.ts';
import {
  plateSketchFixture, solveSketch, buildPlateProfile, editConstraint,
  serializeSketch, parseSketch, suggestDrag,
} from '../../packages/sketch/index.mjs';
import { analyticPlate } from '../plate-oracle.mjs';

const analyticFixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../integration/fixtures/plate-two-holes.v1.json', import.meta.url)), 'utf8'
));
const edges = ['bottom', 'right', 'top', 'left'];
const holes = ['holeA', 'holeB'];
function feature(eventId, id, kind, dependsOn, writeTargets, payload) {
  return { eventId, type: 'feature.create', feature: { id, kind, dependsOn, writeTargets, payload } };
}
function planned(doc, id) { return planProject(doc).features.find(f => f.feature.id === id); }
function checkedProfile(sketch) {
  const solved = solveSketch(sketch);
  assert.equal(solved.status, 'solved', JSON.stringify(solved.diagnostics));
  assert.equal(solved.degreesOfFreedom, 0);
  const profile = buildPlateProfile(sketch, solved, edges, holes);
  assert.equal(profile.status, 'analytic_profile_only');
  return profile;
}
function documentWithLateSketch(sketch) {
  let doc = newProject('project.crosslane-plate');
  doc = commitEvent(doc, feature('event.cut', 'feature.cut', 'cut',
    ['feature.extrude'], ['body.plate'], {holeIds:holes}));
  doc = commitEvent(doc, feature('event.extrude', 'feature.extrude', 'extrude',
    ['feature.sketch'], ['body.plate'], {thicknessMm:analyticFixture.thickness}));
  doc = commitEvent(doc, feature('event.sketch', 'feature.sketch', 'sketch',
    [], ['sketch.plate'], {sketch:JSON.parse(serializeSketch(sketch))}));
  return doc;
}

test('cross-lane: out-of-order features retain chronology but evaluate sketch then extrude then cut', () => {
  const sketch=plateSketchFixture();
  const doc=documentWithLateSketch(sketch);
  const plan=planProject(doc);
  assert.deepEqual(plan.authoredOrder, ['feature.cut','feature.extrude','feature.sketch']);
  assert.deepEqual(plan.executableOrder, ['feature.sketch','feature.extrude','feature.cut']);
  for(const id of plan.executableOrder) assert.equal(planned(doc,id).status,'ready');
  const profile=checkedProfile(sketch);
  assert.equal(profile.holes.length,2);
  const expected=analyticPlate(analyticFixture);
  assert.equal(expected.status,'analytic_intent_only');
  assert.ok(Math.abs(profile.areaMm2*analyticFixture.thickness-expected.expectedVolumeMm3)<1e-8);
});

test('cross-lane: retrospective width constraint change survives model journal and sketch save/reopen', () => {
  const original=plateSketchFixture();
  const before=documentWithLateSketch(original);
  const wider=editConstraint(original,'width',{value:140});
  const after=commitEvent(before, {
    eventId:'event.resize', type:'feature.edit', featureId:'feature.sketch',
    patch:{payload:{sketch:JSON.parse(serializeSketch(wider))}},
  });
  const reopened=deserializeProject(serializeProject(after));
  const updated=planned(reopened,'feature.sketch').feature.payload.sketch;
  const parsed=parseSketch(JSON.stringify(updated));
  assert.equal(checkedProfile(parsed).areaMm2-checkedProfile(original).areaMm2,20*analyticFixture.depth);
  assert.equal(checkedProfile(original).status,'analytic_profile_only');
  assert.equal(before.revision+1,reopened.revision);
  assert.deepEqual(planProject(reopened).executableOrder,['feature.sketch','feature.extrude','feature.cut']);
  assert.deepEqual(planProject(before).executableOrder,['feature.sketch','feature.extrude','feature.cut']);
});

test('cross-lane: impossible constrained drag yields no geometry and no persisted intent mutation', () => {
  const sketch=plateSketchFixture();
  const serialized=serializeSketch(sketch);
  const first=sketch.points.find(p=>p.id==='p0');
  assert.ok(first);
  const attempt=suggestDrag(sketch,'p0',{x:first.x+10,y:first.y});
  assert.equal(attempt.previewOnly,true);
  assert.equal(attempt.status,'conflicted');
  assert.equal(attempt.geometry,null);
  assert.equal(serializeSketch(sketch),serialized);
});
