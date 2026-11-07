#!/usr/bin/env node
/**
 * Source-authoritative fillet + dimension-edit -> actual analytic arc SVG.
 * No native B-rep/3D/independent STEP assertion.
 */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {newProject,commitEvent,serializeProject,deserializeProject} from '../../model/src/index.ts';
import {serializeSketch} from '../../sketch/index.mjs';
import {
  createCenteredHolePlate,inspectCenteredHolePlate,editCenteredHolePlateDimension
} from '../../sketch/centered-hole-plate.mjs';
import {
  createRoundedPlateIntent,editRoundedPlateRadius,serializeRoundedPlateIntent
} from '../../sketch/rounded-plate.mjs';
import {createRoundedPlateSheet} from '../index.mjs';

const profileId='plate',sketchFeatureId='sketch.plate';
const sketch=createCenteredHolePlate({
  id:profileId,widthMm:120,heightMm:80,
  leftInsetMm:35,rightInsetMm:35,holeARadiusMm:6,holeBRadiusMm:6
});
let fillet=createRoundedPlateIntent({
  version:1,id:'plate:fillet',
  edgeIds:['plate:bottom','plate:right','plate:top','plate:left'],
  holeIds:['plate:holeA','plate:holeB'],radiusMm:8
});
let project=newProject('demo.rounded.mounting.plate');
project=commitEvent(project,{eventId:'rounded.sketch.create',type:'feature.create',
  feature:{id:sketchFeatureId,kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketchDocument:serializeSketch(sketch),
      roundedPlateIntent:serializeRoundedPlateIntent(fillet)}}
});
const args=p=>({projectJson:serializeProject(p),sketchFeatureId,profileId,
  title:'ROUNDED MOUNTING PLATE',drawingId:'I3D-FILLET-001'});
const initial=createRoundedPlateSheet(args(project));
fillet=editRoundedPlateRadius(fillet,12);
const solve=inspectCenteredHolePlate(sketch,profileId);
const resize=editCenteredHolePlateDimension(sketch,profileId,{
  version:1,expectedSignature:solve.sourceSignature,
  dimension:'widthMm',valueMm:150
});
if(resize.kind!=='accepted'||resize.status!=='solved')
  throw new Error('SKETCH did not accept authentic width edit');
project=commitEvent(project,{eventId:'rounded.sketch.edit',type:'feature.edit',
  featureId:sketchFeatureId,patch:{payload:{
    sketchDocument:serializeSketch(resize.sketch),
    roundedPlateIntent:serializeRoundedPlateIntent(fillet)
  }}});
const reopened=deserializeProject(serializeProject(project));
const updated=createRoundedPlateSheet(args(reopened));
if(initial.measurement.widthMm!==120||initial.measurement.cornerRadiusMm!==8||
   updated.measurement.widthMm!==150||updated.measurement.cornerRadiusMm!==12||
   updated.measurement.holePitchMm!==80||
   updated.measurement.boundaryCurves.filter(x=>x.kind==='arc').length!==4||
   updated.svg===initial.svg)
  throw new Error('Authentic project fillet/width edit did not update SVG');
const filename=resolve(process.argv[2]??'intuit3d-rounded-mounting-plate.svg');
writeFileSync(filename,updated.svg,'utf8');
console.log(JSON.stringify({
  filename,projectId:reopened.projectId,revision:reopened.revision,
  widthMm:updated.measurement.widthMm,heightMm:updated.measurement.heightMm,
  cornerRadiusMm:updated.measurement.cornerRadiusMm,
  holes:updated.measurement.holes.length,
  pitchMm:updated.measurement.holePitchMm,
  areaMm2:updated.measurement.analyticAreaMm2,
  status:updated.measurement.status,
  nativeExact:false,independentStepQualified:false
},null,2));
