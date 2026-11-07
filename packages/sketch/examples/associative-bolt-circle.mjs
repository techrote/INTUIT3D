import {roundedPlateArcFixture,editArcConstraint,serializeArcSketch,
  parseArcSketch} from '@intuit3d/sketch/arc-constraints/v1';
import {createArcHoleSelection,serializeArcHoleSelection}
  from '@intuit3d/sketch/arc-hole-authoring/v1';
import {proposeArcBoltCircle,inspectArcBoltCircle,
  serializeArcBoltCircle,parseArcBoltCircle}
  from '@intuit3d/sketch/arc-bolt-circle/v1';
let sketch=roundedPlateArcFixture();
let selection=createArcHoleSelection({
  format:'intuit3d.arc-hole-selection',version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
let pattern=null;
const stamp=()=>({sourceSignature:serializeArcSketch(sketch),
  selectionSignature:serializeArcHoleSelection(selection),
  patternSignature:pattern?serializeArcBoltCircle(pattern):null});
const report=(step,kind='accepted')=>{
  const inspection=inspectArcBoltCircle(sketch,selection,pattern);
  console.log(JSON.stringify({step,kind,status:inspection.status,
    patternId:pattern.id,memberIds:inspection.memberIds,
    holeCount:inspection.profile?.holes.length,
    materialAreaMm2:inspection.profile?.materialAreaMm2,
    nativeExact:false,stepQualified:false}));
};
const commit=(step,command)=>{
  const r=proposeArcBoltCircle(sketch,selection,pattern,command,stamp());
  if(r.kind!=='accepted')throw new Error(step+': '+r.reason);
  sketch=r.sketch;selection=r.selection;pattern=r.pattern;report(step);
};
commit('create',{kind:'create',id:'boltCircle',sourceCircleId:'holeA',
  centerXMm:35,centerYMm:25,count:3});
commit('reconfigure',{kind:'reconfigure',centerXMm:35,centerYMm:28,count:4});
commit('move-seed',{kind:'edit-seed',xMm:35,yMm:42,diameterMm:10});
sketch=editArcConstraint(sketch,'plate:width',{value:150});
commit('widen-plate',{kind:'refresh'});
sketch=parseArcSketch(serializeArcSketch(sketch));
selection=createArcHoleSelection(JSON.parse(serializeArcHoleSelection(selection)));
pattern=parseArcBoltCircle(serializeArcBoltCircle(pattern));
report('reopen','reopened');
const refused=proposeArcBoltCircle(sketch,selection,pattern,{
  kind:'reconfigure',centerXMm:35,centerYMm:28,count:12},stamp());
if(refused.kind!=='refused')throw new Error('overlap must fail closed');
console.log(JSON.stringify({step:'refuse-overlap',kind:'refused',reason:refused.reason}));
