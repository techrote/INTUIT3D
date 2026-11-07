import {roundedPlateArcFixture,serializeArcSketch,parseArcSketch}
  from '@intuit3d/sketch/arc-constraints/v1';
import {createArcHoleSelection,serializeArcHoleSelection}
  from '@intuit3d/sketch/arc-hole-authoring/v1';
import {inspectArcProfileTools,editArcProfileWithTool}
  from '@intuit3d/sketch/arc-profile-tools/v1';
let doc=roundedPlateArcFixture(),selection=createArcHoleSelection({
  format:'intuit3d.arc-hole-selection',version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const summary=(step,inspected)=>console.log(JSON.stringify({step,
  solver:inspected.status,profileId:inspected.profile?.id,
  holeIds:inspected.profile?.holes.map(h=>h.id),
  areaMm2:inspected.profile?.materialAreaMm2,
  nativeExact:inspected.profile?.exactBrepAvailable,
  stepQualified:inspected.profile?.stepQualified}));
const apply=(step,command)=>{
  const before=inspectArcProfileTools(doc,selection);
  const out=editArcProfileWithTool(doc,selection,command,{
    sourceSignature:before.sourceSignature,selectionSignature:before.selectionSignature});
  if(out.kind!=='accepted')throw new Error(step+': '+out.reason);
  doc=out.sketch;selection=out.selection;
  summary(step,inspectArcProfileTools(doc,selection));
};
summary('original',inspectArcProfileTools(doc,selection));
apply('drag-width-to-150',{kind:'drag-dimension',constraintId:'plate:width',xMm:150,yMm:0});
apply('create-2x2-pattern',{kind:'array',sourceCircleId:'holeA',
  patternId:'arrayA',rows:2,columns:2,spacingXmm:20,spacingYmm:20});
apply('retrospective-corner-radius',{kind:'dimension',constraintId:'corner1:radius',valueMm:14});
apply('resize-patterned-hole',{kind:'hole',change:{
  kind:'resize',circleId:'arrayA:r1c1',diameterMm:14}});
doc=parseArcSketch(serializeArcSketch(doc));
selection=createArcHoleSelection(JSON.parse(serializeArcHoleSelection(selection)));
summary('reopened',inspectArcProfileTools(doc,selection));
const inspected=inspectArcProfileTools(doc,selection);
const rejected=editArcProfileWithTool(doc,selection,{kind:'array',
  sourceCircleId:'holeA',patternId:'badOverlap',rows:2,columns:2,
  spacingXmm:0,spacingYmm:0},{sourceSignature:inspected.sourceSignature,
  selectionSignature:inspected.selectionSignature});
if(rejected.kind!=='refused')throw Error('overlapping array must be refused');
console.log(JSON.stringify({step:'invalid-array',result:rejected.kind,reason:rejected.reason}));
