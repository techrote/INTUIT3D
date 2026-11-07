import {roundedPlateArcFixture,editArcConstraint,serializeArcSketch,parseArcSketch}
  from '@intuit3d/sketch/arc-constraints/v1';
import {createArcHoleSelection,serializeArcHoleSelection}
  from '@intuit3d/sketch/arc-hole-authoring/v1';
import {proposeArcBoltCircle,inspectArcBoltCircleControls,
  serializeArcBoltCircle,parseArcBoltCircle}
  from '@intuit3d/sketch/arc-bolt-circle/v1';
let sketch=roundedPlateArcFixture();
let selected=createArcHoleSelection({format:'intuit3d.arc-hole-selection',version:1,
  profileId:'plate:main',boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
let record=null;
const stamp=()=>({sourceSignature:serializeArcSketch(sketch),
  selectionSignature:serializeArcHoleSelection(selected),
  patternSignature:record?serializeArcBoltCircle(record):null});
function show(step,kind='accepted'){
  const controls=inspectArcBoltCircleControls(sketch,selected,record);
  console.log(JSON.stringify({step,kind,profileId:controls.profileId,
    dimensions:controls.dimensions,handles:controls.handles,
    previewOnly:true,nativeExact:false,stepQualified:false}));
}
function commit(step,command){
  const r=proposeArcBoltCircle(sketch,selected,record,command,stamp());
  if(r.kind!=='accepted')throw Error(step+': '+r.reason);
  sketch=r.sketch;selected=r.selection;record=r.pattern;show(step);
}
commit('create',{kind:'create',id:'boltCircle',sourceCircleId:'holeA',
  centerXMm:35,centerYMm:25,count:3});
commit('numeric',{kind:'edit-layout',count:4,centerXMm:35,centerYMm:25,
  pitchDiameterMm:32,phaseDeg:45,holeDiameterMm:8});
commit('pitch',{kind:'drag-handle',handleId:'boltCircle:pitch',xMm:45,yMm:40});
commit('center',{kind:'drag-handle',handleId:'boltCircle:center',xMm:38,yMm:27});
sketch=editArcConstraint(sketch,'plate:width',{value:150});
commit('widen',{kind:'refresh'});
sketch=parseArcSketch(serializeArcSketch(sketch));
selected=createArcHoleSelection(JSON.parse(serializeArcHoleSelection(selected)));
record=parseArcBoltCircle(serializeArcBoltCircle(record));
show('reopen','reopened');
const bad=proposeArcBoltCircle(sketch,selected,record,{
  kind:'edit-layout',count:4,centerXMm:38,centerYMm:27,
  pitchDiameterMm:8,phaseDeg:0,holeDiameterMm:10},stamp());
if(bad.kind!=='refused')throw Error('overlap must refuse');
console.log(JSON.stringify({step:'refuse',kind:'refused',reason:bad.reason}));
