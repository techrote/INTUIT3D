import {roundedPlateArcFixture,editArcConstraint,serializeArcSketch,
  parseArcSketch} from '@intuit3d/sketch/arc-constraints/v1';
import {createArcHoleSelection,serializeArcHoleSelection}
  from '@intuit3d/sketch/arc-hole-authoring/v1';
import {inspectArcHolePattern,proposeArcHolePattern,serializeArcHolePattern,
  parseArcHolePattern} from '@intuit3d/sketch/arc-hole-pattern/v1';

let sketch=roundedPlateArcFixture();
let selection=createArcHoleSelection({format:'intuit3d.arc-hole-selection',
  version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
let pattern=null;
const stamps=()=>({
  sourceSignature:serializeArcSketch(sketch),
  selectionSignature:serializeArcHoleSelection(selection),
  patternSignature:pattern?serializeArcHolePattern(pattern):null
});
const report=(step,result)=>{
  const view=inspectArcHolePattern(sketch,selection,pattern);
  console.log(JSON.stringify({step,kind:result?.kind||'reopened',
    status:view.status,patternId:pattern.id,
    holeIds:view.profile?.holes.map(h=>h.id),
    widthMm:sketch.constraints.find(c=>c.id==='plate:width').value,
    memberCount:view.memberIds.length,
    areaMm2:view.profile?.materialAreaMm2,
    nativeExact:view.profile?.exactBrepAvailable,
    stepQualified:view.profile?.stepQualified}));
};
const apply=(step,command)=>{
  const result=proposeArcHolePattern(sketch,selection,pattern,command,stamps());
  if(result.kind!=='accepted')throw new Error(step+': '+result.reason);
  sketch=result.sketch;selection=result.selection;pattern=result.pattern;
  report(step,result);
};
apply('create-pattern',{kind:'create',id:'boltGrid',sourceCircleId:'holeA',
  rows:2,columns:2,spacingXmm:20,spacingYmm:20});
apply('drag-seed-and-resize',{kind:'edit-seed',xMm:40,yMm:35,diameterMm:10});
apply('expand-pattern',{kind:'reconfigure',rows:2,columns:3,
  spacingXmm:16,spacingYmm:20});
apply('reduce-pattern',{kind:'reconfigure',rows:1,columns:2,
  spacingXmm:16,spacingYmm:20});
sketch=editArcConstraint(sketch,'plate:width',{value:150});
apply('replay-retrospective-width',{kind:'refresh'});
sketch=parseArcSketch(serializeArcSketch(sketch));
selection=createArcHoleSelection(JSON.parse(serializeArcHoleSelection(selection)));
pattern=parseArcHolePattern(serializeArcHolePattern(pattern));
report('reopened');
const invalid=proposeArcHolePattern(sketch,selection,pattern,{
  kind:'reconfigure',rows:2,columns:2,spacingXmm:0,spacingYmm:0},stamps());
if(invalid.kind!=='refused')throw new Error('invalid placement must be refused');
console.log(JSON.stringify({step:'overlap-refused',kind:invalid.kind,
  reason:invalid.reason,profileId:selection.profileId}));
