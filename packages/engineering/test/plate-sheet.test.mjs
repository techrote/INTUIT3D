import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDimensionedPlateSheet,measurePlateFromProject,renderPlateDrawingSvg
} from '../index.mjs';
import {newProject,commitEvent,serializeProject,deserializeProject} from '../../model/src/index.ts';
import {serializeSketch} from '../../sketch/index.mjs';
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
