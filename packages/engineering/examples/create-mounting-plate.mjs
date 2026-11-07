#!/usr/bin/env node
/** One-command A3 drawing generation from a real saved INTENT+SKETCH source. */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {newProject,commitEvent,serializeProject,deserializeProject} from '../../model/src/index.ts';
import {serializeSketch} from '../../sketch/index.mjs';
import {
  createCenteredHolePlate,inspectCenteredHolePlate,editCenteredHolePlateDimension
} from '../../sketch/centered-hole-plate.mjs';
import {createDimensionedPlateSheet} from '../index.mjs';

const profileId='plate';
let sketch=createCenteredHolePlate({
  id:profileId,widthMm:120,heightMm:80,
  leftInsetMm:35,rightInsetMm:35,holeARadiusMm:6,holeBRadiusMm:6
});
let project=newProject('demo.mounting.plate');
project=commitEvent(project,{
  eventId:'draw.sketch.create',type:'feature.create',
  feature:{id:'sketch.plate',kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketchDocument:serializeSketch(sketch)}}
});
const before=project;
const inspected=inspectCenteredHolePlate(sketch,profileId);
const change=editCenteredHolePlateDimension(sketch,profileId,{
  version:1,expectedSignature:inspected.sourceSignature,
  dimension:'widthMm',valueMm:150
});
if(change.kind!=='accepted'||change.status!=='solved')
  throw new Error('Sketch did not accept a genuine dimension change');
sketch=change.sketch;
project=commitEvent(project,{
  eventId:'draw.sketch.resize',type:'feature.edit',featureId:'sketch.plate',
  patch:{payload:{sketchDocument:serializeSketch(sketch)}}
});
const reopened=deserializeProject(serializeProject(project));
const source=projectDocument=>({
  projectJson:serializeProject(projectDocument),sketchFeatureId:'sketch.plate',
  profileId,title:'DIMENSIONED MOUNTING PLATE',drawingId:'I3D-DEMO-001'
});
const first=createDimensionedPlateSheet(source(before));
const revised=createDimensionedPlateSheet(source(reopened));
if(first.measurement.widthMm!==120||revised.measurement.widthMm!==150||
   first.measurement.holePitchMm!==50||revised.measurement.holePitchMm!==80)
  throw new Error('Expected real source dimension and hole-pitch changes');
const file=resolve(process.argv[2]??'intuit3d-mounting-plate.svg');
writeFileSync(file,revised.svg,'utf8');
console.log(JSON.stringify({
  file,sourceProjectId:reopened.projectId,revision:reopened.revision,
  widthMm:revised.measurement.widthMm,heightMm:revised.measurement.heightMm,
  holePitchMm:revised.measurement.holePitchMm,units:'mm',
  status:revised.measurement.status,nativeExact:false
},null,2));
