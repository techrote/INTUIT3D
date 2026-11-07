import test from 'node:test';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {newProject,commitEvent,serializeProject,deserializeProject}
  from '../../model/src/index.ts';
import {serializeSketch} from '../../sketch/index.mjs';
import {createCenteredHolePlate,inspectCenteredHolePlate,
  editCenteredHolePlateDimension} from '../../sketch/centered-hole-plate.mjs';
import {createVariableRoundedPlateIntent,editVariableRoundedPlateRadius,
  serializeVariableRoundedPlateIntent} from '../../sketch/rounded-plate.mjs';
import {createVariableRoundedPlateSheet,
  measureVariableRoundedPlateFromProject,measurePlateFromProject,
  renderPlateDrawingSvg} from '../index.mjs';

const profileId='plate',sketchFeatureId='sketch.plate';
const sketch=createCenteredHolePlate({id:profileId,widthMm:120,heightMm:80,
  leftInsetMm:35,rightInsetMm:35,holeARadiusMm:6,holeBRadiusMm:6});
const intent=createVariableRoundedPlateIntent({
  version:2,id:'plate:variable-fillet',
  edgeIds:['plate:bottom','plate:right','plate:top','plate:left'],
  holeIds:['plate:holeA','plate:holeB'],
  cornerRadii:[
    {vertexId:'plate:p0',radiusMm:4},
    {vertexId:'plate:p1',radiusMm:8},
    {vertexId:'plate:p2',radiusMm:12},
    {vertexId:'plate:p3',radiusMm:6}
  ]
});
const createProject=()=>commitEvent(newProject('test.variable.fillet'),{
  eventId:'variable.create',type:'feature.create',
  feature:{id:sketchFeatureId,kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketchDocument:serializeSketch(sketch),
      variableRoundedPlateIntent:serializeVariableRoundedPlateIntent(intent)}}});
const args=doc=>({projectJson:serializeProject(doc),sketchFeatureId,profileId,
  drawingId:'AS-04'});
const rev=(doc,sketchArg,intentArg,id)=>commitEvent(doc,{
  eventId:id,type:'feature.edit',featureId:sketchFeatureId,
  patch:{payload:{sketchDocument:serializeSketch(sketchArg),
    variableRoundedPlateIntent:serializeVariableRoundedPlateIntent(intentArg)}}});

test('real saved project draws all four distinct source-authored radii as analytic arcs',()=>{
  const doc=createProject(),result=createVariableRoundedPlateSheet(args(doc));
  const m=result.measurement,base=measurePlateFromProject(args(doc));
  assert.equal(m.outlineKind,'rounded_plate');
  assert.deepEqual(m.cornerRadiiMm,{
    'plate:p0':4,'plate:p1':8,'plate:p2':12,'plate:p3':6
  });
  assert.equal(m.perimeterMm>0,true);
  assert.equal(m.boundaryCurves.filter(c=>c.kind==='arc').length,4);
  assert.equal(m.boundaryLengths.length,8);
  assert.ok(Math.abs(m.analyticAreaMm2-
    (base.analyticAreaMm2-(1-Math.PI/4)*(16+64+144+36)))<1e-8);
  assert.match(result.svg,/data-outline="rounded-plate"/);
  assert.equal((result.svg.match(/ A [0-9.]+ [0-9.]+ 0 0 [01] /g)||[]).length,4);
  for(const [vertex,radius] of Object.entries(m.cornerRadiiMm))
    assert.ok(result.svg.includes('R '+vertex+': '+radius+' mm'));
  assert.doesNotMatch(result.svg,/>4 × R/);
  assert.equal(result.svg,renderPlateDrawingSvg(m,{drawingId:'AS-04'}));
  assert.equal(m.provenance.variableIntentId,'plate:variable-fillet');
  assert.equal(m.nativeExact,false);
});

test('one corner radius and earlier width edit regenerate distinct replay-stable sheets',()=>{
  const first=createProject(),old=createVariableRoundedPlateSheet(args(first));
  const corner=editVariableRoundedPlateRadius(intent,'plate:p1',10);
  const changedRadius=rev(first,sketch,corner,'variable.radius');
  const radiusSheet=createVariableRoundedPlateSheet(args(
    deserializeProject(serializeProject(changedRadius))));
  assert.equal(radiusSheet.measurement.cornerRadiiMm['plate:p1'],10);
  assert.equal(radiusSheet.measurement.cornerRadiiMm['plate:p2'],12);
  assert.ok(radiusSheet.measurement.analyticAreaMm2<old.measurement.analyticAreaMm2);
  const inspected=inspectCenteredHolePlate(sketch,profileId);
  const resized=editCenteredHolePlateDimension(sketch,profileId,{
    version:1,expectedSignature:inspected.sourceSignature,
    dimension:'widthMm',valueMm:150});
  assert.equal(resized.kind,'accepted');
  const latest=rev(changedRadius,resized.sketch,corner,'variable.width');
  const reopened=deserializeProject(serializeProject(latest));
  const sheet=createVariableRoundedPlateSheet(args(reopened));
  assert.equal(sheet.measurement.widthMm,150);
  assert.equal(sheet.measurement.holePitchMm,80);
  assert.equal(sheet.measurement.cornerRadiiMm['plate:p1'],10);
  assert.notEqual(sheet.svg,radiusSheet.svg);
  assert.equal(sheet.svg,createVariableRoundedPlateSheet(args(latest)).svg);
  assert.equal(old.svg,createVariableRoundedPlateSheet(args(first)).svg);
});

test('missing v2 intent, unadmitted overlapping radii and forged v2 map fail closed',()=>{
  const doc=createProject();
  const noIntent=commitEvent(doc,{eventId:'variable.missing',type:'feature.edit',
    featureId:sketchFeatureId,patch:{payload:{sketchDocument:serializeSketch(sketch),
      variableRoundedPlateIntent:null}}});
  assert.throws(()=>measureVariableRoundedPlateFromProject(args(noIntent)),
    /variableRoundedPlateIntent missing/);
  const crossing=editVariableRoundedPlateRadius(intent,'plate:p1',75);
  const invalid=rev(doc,sketch,crossing,'variable.crossing');
  assert.throws(()=>createVariableRoundedPlateSheet(args(invalid)),
    /variable rounded plate profile is not solved: conflicted/);
  const measured=measureVariableRoundedPlateFromProject(args(doc));
  measured.cornerRadiiMm['plate:p1']=19;
  assert.throws(()=>renderPlateDrawingSvg(measured),
    /variable radius annotations do not match/);
});


test('executable public example writes a real SVG sheet from a serialized edited project',()=>{
  const {mkdtempSync,readFileSync,rmSync,statSync}=fs;
  const dir=mkdtempSync(join(tmpdir(),'intuit3d-variable-drawing-'));
  const output=join(dir,'actual-dimensioned-variable-plate.svg');
  try{
    const cmd=fileURLToPath(new URL('../examples/create-variable-rounded-plate.mjs',import.meta.url));
    const proc=spawnSync(process.execPath,['--experimental-strip-types',cmd,output],
      {encoding:'utf8',timeout:30000});
    assert.equal(proc.status,0,proc.stderr||proc.stdout);
    const data=JSON.parse(proc.stdout);
    assert.equal(data.revision,2);
    assert.deepEqual(data.dimensionsMm,[150,80]);
    assert.equal(data.cornerRadiiMm['plate:p1'],10);
    assert.ok(statSync(output).size>2000);
    const svg=readFileSync(output,'utf8');
    assert.match(svg,/width="420mm" height="297mm"/);
    assert.match(svg,/R plate:p1: 10 mm/);
    assert.equal((svg.match(/ A [0-9.]+ [0-9.]+ 0 0 [01] /g)||[]).length,4);
    assert.match(svg,/ANALYTIC SKETCH ONLY/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
