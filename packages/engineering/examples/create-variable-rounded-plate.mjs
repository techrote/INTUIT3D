#!/usr/bin/env node
/** Real authored INTENT + SKETCH v2 asymmetric fillet -> dimensioned SVG. */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {newProject,commitEvent,serializeProject,deserializeProject} from '../../model/src/index.ts';
import {serializeSketch} from '../../sketch/index.mjs';
import {
  createCenteredHolePlate,inspectCenteredHolePlate,editCenteredHolePlateDimension
} from '../../sketch/centered-hole-plate.mjs';
import {
  createVariableRoundedPlateIntent,editVariableRoundedPlateRadius,
  serializeVariableRoundedPlateIntent
} from '../../sketch/rounded-plate.mjs';
import {createVariableRoundedPlateSheet} from '../index.mjs';

const id='plate',sketchFeatureId='sketch.plate';
const sketch=createCenteredHolePlate({id,widthMm:120,heightMm:80,
  leftInsetMm:35,rightInsetMm:35,holeARadiusMm:6,holeBRadiusMm:6});
let fillet=createVariableRoundedPlateIntent({
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
let project=newProject('demo.variable.fillet.plate');
project=commitEvent(project,{eventId:'variable.sketch.create',type:'feature.create',
  feature:{id:sketchFeatureId,kind:'sketch',dependsOn:[],writeTargets:[],
    payload:{sketchDocument:serializeSketch(sketch),
      variableRoundedPlateIntent:serializeVariableRoundedPlateIntent(fillet)}}});
const args=p=>({projectJson:serializeProject(p),sketchFeatureId,profileId:id,
  title:'ASYMMETRIC FILLETED PLATE',drawingId:'I3D-VAR-R-001'});
const original=createVariableRoundedPlateSheet(args(project));
fillet=editVariableRoundedPlateRadius(fillet,'plate:p1',10);
const inspection=inspectCenteredHolePlate(sketch,id);
const edit=editCenteredHolePlateDimension(sketch,id,{
  version:1,expectedSignature:inspection.sourceSignature,
  dimension:'widthMm',valueMm:150
});
if(edit.kind!=='accepted'||edit.status!=='solved')
  throw Error('SKETCH did not accept real plate width edit');
project=commitEvent(project,{eventId:'variable.sketch.edit',type:'feature.edit',
  featureId:sketchFeatureId,patch:{payload:{
    sketchDocument:serializeSketch(edit.sketch),
    variableRoundedPlateIntent:serializeVariableRoundedPlateIntent(fillet)}}});
const reopened=deserializeProject(serializeProject(project));
const updated=createVariableRoundedPlateSheet(args(reopened));
if(original.measurement.widthMm!==120||
   updated.measurement.widthMm!==150||
   updated.measurement.holePitchMm!==80||
   updated.measurement.cornerRadiiMm['plate:p1']!==10||
   updated.measurement.boundaryCurves.filter(c=>c.kind==='arc').length!==4||
   updated.svg===original.svg)
  throw Error('authored edits did not regenerate asymmetric curved drawing');
const filename=resolve(process.argv[2]??'intuit3d-variable-rounded-plate.svg');
writeFileSync(filename,updated.svg,'utf8');
console.log(JSON.stringify({filename,revision:reopened.revision,
  dimensionsMm:[updated.measurement.widthMm,updated.measurement.heightMm],
  cornerRadiiMm:updated.measurement.cornerRadiiMm,
  perimeterMm:updated.measurement.perimeterMm,
  areaMm2:updated.measurement.analyticAreaMm2,
  status:updated.measurement.status,nativeExact:false,
  independentStepQualified:false},null,2));
