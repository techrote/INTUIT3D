import {roundedPlateArcFixture,solveArcSketch,serializeArcSketch,parseArcSketch,
  editArcConstraint} from '@intuit3d/sketch/arc-constraints/v1';
import {prepareArcProfileForProvider} from '@intuit3d/sketch/arc-profile/v1';
import {createArcHoleSelection,inspectArcHoleControls,editArcProfileHole}
  from '@intuit3d/sketch/arc-hole-authoring/v1';

const selection=createArcHoleSelection({format:'intuit3d.arc-hole-selection',version:1,
  profileId:'plate:main',boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const original=roundedPlateArcFixture();
const stamp=(doc,selected)=>({
  sourceSignature:serializeArcSketch(doc),
  selectionSignature:JSON.stringify(selected)
});
const apply=(doc,selected,change)=>{
  const result=editArcProfileHole(doc,selected,change,stamp(doc,selected));
  if(result.kind!=='accepted')throw Error(result.reason);
  console.log(JSON.stringify({operation:change.kind,holeIds:result.selection.holeIds,
    profileId:result.profile.id,areaMm2:result.profile.materialAreaMm2,
    status:result.profile.status,nativeExact:result.profile.exactBrepAvailable}));
  return result;
};
const added=apply(original,selection,{kind:'add',circleId:'holeC',xMm:60,yMm:63,diameterMm:10});
const moved=apply(added.sketch,added.selection,{kind:'move',circleId:'holeC',xMm:60,yMm:20});
const resized=apply(moved.sketch,moved.selection,{kind:'resize',circleId:'holeC',diameterMm:14});
const width150=editArcConstraint(resized.sketch,'plate:width',{value:150});
const reopened=parseArcSketch(serializeArcSketch(width150));
const profile=prepareArcProfileForProvider(reopened,solveArcSketch(reopened),{
  profileId:resized.selection.profileId,boundaryIds:resized.selection.boundaryIds,
  holeIds:resized.selection.holeIds});
console.log(JSON.stringify({operation:'retrospective-width-and-archive',
  widthMm:150,handles:inspectArcHoleControls(reopened,resized.selection).controls,
  profileId:profile.id,areaMm2:profile.materialAreaMm2,nativeExact:profile.exactBrepAvailable}));
const removed=apply(reopened,resized.selection,{kind:'remove',circleId:'holeC'});
const rejected=editArcProfileHole(removed.sketch,removed.selection,
  {kind:'add',circleId:'holeD',xMm:3,yMm:40,diameterMm:12},stamp(removed.sketch,removed.selection));
if(rejected.kind!=='refused')throw Error('boundary piercing hole was accepted');
console.log(JSON.stringify({operation:'invalid-placement',status:rejected.kind,reason:rejected.reason}));
