import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDimensionedPlateSheet,measurePlateFromProject,renderPlateDrawingSvg,
  createRoundedPlateSheet,measureRoundedPlateFromProject
} from '../index.mjs';
import {newProject,commitEvent,serializeProject,deserializeProject} from '../../model/src/index.ts';
import {serializeSketch} from '../../sketch/index.mjs';
import {
  createRoundedPlateIntent,editRoundedPlateRadius,
  serializeRoundedPlateIntent
} from '../../sketch/rounded-plate.mjs';
import {
  createCenteredHolePlate,inspectCenteredHolePlate,editCenteredHolePlateDimension
} from '../../sketch/centered-hole-plate.mjs';

const sketchId='sketch.plate';
const profileId='plate';
const createSource=(widthMm=120)=>{
  const sketch=createCenteredHolePlate({
    id:profileId,widthMm,heightMm:80,
    leftInsetMm:35,rightInsetMm:35,holeARadiusMm:6,holeBRadiusMm:6
  });
  let doc=newProject('demo.mounting.plate');
  doc=commitEvent(doc,{
    eventId:'event.sketch.create',type:'feature.create',
    feature:{id:sketchId,kind:'sketch',dependsOn:[],writeTargets:[],
      payload:{sketchDocument:serializeSketch(sketch)}}
  });
  return {doc,sketch};
};
const source=(doc)=>({projectJson:serializeProject(doc),
  sketchFeatureId:sketchId,profileId});

test('actual INTENT project + solved centered plate generates truthful dimensioned A3 SVG',()=>{
  const {doc}=createSource();
  const result=createDimensionedPlateSheet({...source(doc),drawingId:'P-100'});
  const m=result.measurement;
  assert.equal(m.status,'analytic_sketch_only');
  assert.equal(m.widthMm,120);assert.equal(m.heightMm,80);
  assert.deepEqual(m.holes.map(h=>[h.offsetXmm,h.offsetYmm,h.diameterMm]),
    [[35,40,12],[85,40,12]]);
  assert.equal(m.holePitchMm,50);
  assert.ok(Math.abs(m.analyticAreaMm2-(9600-72*Math.PI))<1e-9);
  assert.equal(m.provenance.projectRevision,1);
  assert.equal(m.nativeExact,false);
  assert.match(result.svg, /width="420mm" height="297mm" viewBox="0 0 420 297"/);
  assert.match(result.svg,/120 mm/); assert.match(result.svg,/80 mm/);
  assert.match(result.svg,/PITCH 50 mm/);
  assert.match(result.svg,/data-entity="plate:holeA"/);
  assert.match(result.svg,/ANALYTIC SKETCH ONLY/);
  assert.equal(result.svg,renderPlateDrawingSvg(m,{drawingId:'P-100'}));
});

test('retrospective width edit updates hole positions, pitch, SVG and survives save/reopen; undo restores',()=>{
  const {doc,sketch}=createSource();
  const initial=createDimensionedPlateSheet(source(doc));
  const inspected=inspectCenteredHolePlate(sketch,profileId);
  const edit=editCenteredHolePlateDimension(sketch,profileId,{
    version:1,expectedSignature:inspected.sourceSignature,dimension:'widthMm',valueMm:150
  });
  assert.equal(edit.kind,'accepted');assert.equal(edit.status,'solved');
  const updated=commitEvent(doc,{
    eventId:'event.sketch.width',type:'feature.edit',featureId:sketchId,
    patch:{payload:{sketchDocument:serializeSketch(edit.sketch)}}
  });
  const reopened=deserializeProject(serializeProject(updated));
  const edited=createDimensionedPlateSheet(source(reopened));
  assert.equal(edited.measurement.widthMm,150);
  assert.equal(edited.measurement.holePitchMm,80);
  assert.deepEqual(edited.measurement.holes.map(h=>h.offsetXmm),[35,115]);
  assert.notEqual(initial.svg,edited.svg);
  assert.match(edited.svg,/PITCH 80 mm/);
  assert.equal(edited.svg,createDimensionedPlateSheet(source(updated)).svg);
  assert.equal(createDimensionedPlateSheet(source(deserializeProject(
    serializeProject(doc)))).svg, initial.svg);
});

test('rejects missing/unready project sources, malformed sketches and failed profile admission',()=>{
  const {doc,sketch}=createSource();
  assert.throws(()=>measurePlateFromProject({...source(doc),sketchFeatureId:'missing'}),/not ready/);
  assert.throws(()=>measurePlateFromProject({...source(doc),profileId:'absent'}),/missing or rewritten/);
  const incomplete=newProject('demo.missing');
  assert.throws(()=>measurePlateFromProject(source(incomplete)),/not ready/);
  const inspected=inspectCenteredHolePlate(sketch,profileId);
  const edit=editCenteredHolePlateDimension(sketch,profileId,{
    version:1,expectedSignature:inspected.sourceSignature,
    dimension:'holeARadiusMm',valueMm:50
  });
  assert.equal(edit.kind,'accepted');
  let invalid=commitEvent(doc,{
    eventId:'event.big.radius',type:'feature.edit',featureId:sketchId,
    patch:{payload:{sketchDocument:serializeSketch(edit.sketch)}}
  });
  assert.throws(()=>measurePlateFromProject(source(invalid)),/profile is not solved/);
});

test('user labels are escaped; no arbitrary injected SVG elements',()=>{
  const {doc}=createSource();
  const result=createDimensionedPlateSheet({...source(doc),
    title:'<script>alert("x")</script>',drawingId:'A&B'});
  assert.doesNotMatch(result.svg,/<script>/);
  assert.match(result.svg,/&lt;script&gt;/);
  assert.equal(result.filename,'A_B.svg');
});

const authoredFillet=(radiusMm=8)=>createRoundedPlateIntent({
  version:1,id:'plate:fillet',
  edgeIds:['plate:bottom','plate:right','plate:top','plate:left'],
  holeIds:['plate:holeA','plate:holeB'],radiusMm
});
const withFillet=(doc,sketch,intent,eventId='event.fillet')=>commitEvent(doc,{
  eventId,type:'feature.edit',featureId:sketchId,
  patch:{payload:{sketchDocument:serializeSketch(sketch),
    roundedPlateIntent:serializeRoundedPlateIntent(intent)}}
});

test('real saved SKETCH v1 fillet renders four analytic SVG circular arcs, not sharp polygon chords',()=>{
  const {doc,sketch}=createSource();
  const authored=withFillet(doc,sketch,authoredFillet());
  const curved=createRoundedPlateSheet({...source(authored),drawingId:'R-008'});
  const m=curved.measurement,base=measurePlateFromProject(source(authored));
  assert.equal(m.outlineKind,'rounded_plate');
  assert.equal(m.cornerRadiusMm,8);
  assert.equal(m.provenance.roundedIntentId,'plate:fillet');
  assert.equal(m.holePitchMm,50);
  assert.equal(m.status,'analytic_sketch_only');
  assert.equal(m.nativeExact,false);
  assert.equal(m.boundaryCurves.filter(x=>x.kind==='arc').length,4);
  assert.ok(Math.abs(m.analyticAreaMm2-
    (base.analyticAreaMm2-(1-Math.PI/4)*4*8*8))<1e-8);
  assert.match(curved.svg,/data-outline="rounded-plate"/);
  assert.doesNotMatch(curved.svg,/<polygon class="outline"/);
  assert.equal((curved.svg.match(/ A [0-9.]+ [0-9.]+ 0 0 [01] /g)??[]).length,4);
  assert.match(curved.svg,/4 × R8/);
  assert.equal(curved.svg,renderPlateDrawingSvg(m,{drawingId:'R-008'}));
});

test('authoritative fillet-radius and early-width edits regenerate distinct sheets after archive/reopen',()=>{
  const {doc,sketch}=createSource();
  const fillet8=authoredFillet(8);
  const firstProject=withFillet(doc,sketch,fillet8);
  const first=createRoundedPlateSheet(source(firstProject));
  const fillet12=editRoundedPlateRadius(fillet8,12);
  const radiusRevision=withFillet(firstProject,sketch,fillet12,'event.fillet.radius');
  const afterRadius=createRoundedPlateSheet(source(
    deserializeProject(serializeProject(radiusRevision))));
  assert.equal(afterRadius.measurement.cornerRadiusMm,12);
  assert.notEqual(afterRadius.svg,first.svg);
  assert.ok(afterRadius.measurement.analyticAreaMm2<
    first.measurement.analyticAreaMm2);

  const inspected=inspectCenteredHolePlate(sketch,profileId);
  const changed=editCenteredHolePlateDimension(sketch,profileId,{
    version:1,expectedSignature:inspected.sourceSignature,
    dimension:'widthMm',valueMm:150
  });
  assert.equal(changed.kind,'accepted');
  const resized=withFillet(radiusRevision,changed.sketch,fillet12,'event.fillet.width');
  const reopened=deserializeProject(serializeProject(resized));
  const final=createRoundedPlateSheet(source(reopened));
  assert.equal(final.measurement.widthMm,150);
  assert.equal(final.measurement.holePitchMm,80);
  assert.equal(final.measurement.cornerRadiusMm,12);
  assert.notEqual(final.svg,afterRadius.svg);
  assert.equal(final.svg,createRoundedPlateSheet(source(resized)).svg);
  // Retain the earlier authoritative journal revision as undo oracle.
  assert.equal(createRoundedPlateSheet(source(firstProject)).svg,first.svg);
});

test('rounded source admission rejects missing, conflicting or non-authored fillet intent',()=>{
  const {doc,sketch}=createSource();
  assert.throws(()=>createRoundedPlateSheet(source(doc)),/roundedPlateIntent missing/);
  const invalid=withFillet(doc,sketch,authoredFillet(41));
  assert.throws(()=>measureRoundedPlateFromProject(source(invalid)),
    /rounded plate profile is not solved: conflicted/);
  const malformed=commitEvent(doc,{eventId:'bad.fillet',type:'feature.edit',
    featureId:sketchId,patch:{payload:{sketchDocument:serializeSketch(sketch),
      roundedPlateIntent:'{"version":1,"id":"x"}'}}});
  assert.throws(()=>measureRoundedPlateFromProject(source(malformed)),/sketch rounded plate/);
});
