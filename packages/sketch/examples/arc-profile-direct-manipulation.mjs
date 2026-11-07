/**
 * Real nonlinear rounded-plate sketch interaction, no mock geometry.
 * The returned solved analytic profile remains pending native B-rep admission.
 */
import {roundedPlateArcFixture,parseArcSketch,serializeArcSketch}
  from '@intuit3d/sketch/arc-constraints/v1';
import {createArcHoleSelection,serializeArcHoleSelection}
  from '@intuit3d/sketch/arc-hole-authoring/v1';
import {inspectArcProfileTools,editArcProfileWithTool}
  from '@intuit3d/sketch/arc-profile-tools/v1';

let doc=roundedPlateArcFixture();
let selection=createArcHoleSelection({format:'intuit3d.arc-hole-selection',
  version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const log=step=>{
  const result=inspectArcProfileTools(doc,selection);
  if(!result.profile)throw new Error(step+': '+result.status+' '+result.profileError);
  console.log(JSON.stringify({step,status:result.status,profileId:result.profile.id,
    holes:result.profile.holes.map(h=>({id:h.id,x:h.x,y:h.y,d:h.radiusMm*2})),
    areaMm2:result.profile.materialAreaMm2,
    curveIds:result.profile.boundary.map(c=>c.id),
    providerSubmissionReady:result.profile.providerSubmissionReady,
    exactBrepAvailable:result.profile.exactBrepAvailable}));
};
const apply=(step,command)=>{
  const current=inspectArcProfileTools(doc,selection);
  const result=editArcProfileWithTool(doc,selection,command,{
    sourceSignature:current.sourceSignature,selectionSignature:current.selectionSignature});
  if(result.kind!=='accepted')throw Error(step+': '+result.reason);
  doc=result.sketch;selection=result.selection;log(step);
};
log('original');
apply('drag-hole-a',{kind:'drag-handle',handleId:'hole-center:holeA',
  xMm:30,yMm:48});
apply('resize-hole-b',{kind:'drag-handle',handleId:'hole-diameter:holeB',
  xMm:91,yMm:40});
apply('move-both',{kind:'translate-holes',circleIds:['holeA','holeB'],
  deltaXMm:5,deltaYMm:-3});
apply('retrospective-width',{kind:'drag-handle',
  handleId:'dimension:plate:width',xMm:150,yMm:0});
doc=parseArcSketch(serializeArcSketch(doc));
selection=createArcHoleSelection(JSON.parse(serializeArcHoleSelection(selection)));
log('reopened');
const old=inspectArcProfileTools(doc,selection);
const rejected=editArcProfileWithTool(doc,selection,{
  kind:'translate-holes',circleIds:['holeA','holeB'],deltaXMm:-200,deltaYMm:0
},{sourceSignature:old.sourceSignature,selectionSignature:old.selectionSignature});
if(rejected.kind!=='refused')throw Error('invalid group movement must be refused');
console.log(JSON.stringify({step:'invalid-translation',kind:rejected.kind,
  reason:rejected.reason}));
