import {
  roundedPlateArcFixture,editArcConstraint,editArcCircleRadius,
  solveArcSketch,buildArcWirePreview,serializeArcSketch,parseArcSketch
} from '@intuit3d/sketch/arc-constraints/v1';
const boundary=['bottom','arc1','right','arc2','top','arc3','left','arc0'];
const summarize=(step,doc)=>{
  const solved=solveArcSketch(doc);
  if(solved.status!=='solved')throw new Error(step+': '+JSON.stringify(solved.diagnostics));
  const p=new Map(solved.geometry.points.map(p=>[p.id,p]));
  const wire=buildArcWirePreview(doc,solved,boundary,['holeA','holeB']);
  console.log(JSON.stringify({step,status:solved.status,solverKind:solved.solverKind,
    degreesOfFreedom:solved.degreesOfFreedom,previewOnly:wire.previewOnly,
    nativeProfileAdmissible:wire.nativeProfileAdmissible,
    widthMm:p.get('p1').x,corner1RadiusMm:solved.geometry.arcs[1].radiusMm,
    holeARadiusMm:wire.holes[0].radiusMm,
    boundaryIds:wire.boundary.map(c=>c.id),
    estimatedMaterialAreaMm2:wire.estimatedMaterialAreaMm2}));
};
const original=roundedPlateArcFixture();
summarize('initial',original);
let changed=editArcConstraint(original,'plate:width',{value:150});
changed=editArcConstraint(changed,'corner1:radius',{value:14});
changed=editArcCircleRadius(changed,'holeA',7);
summarize('edited-width-corner-hole',changed);
const archive=serializeArcSketch(changed);
summarize('reopened',parseArcSketch(archive));
const invalid=editArcConstraint(changed,'corner1:radius',{value:999});
const invalidSolution=solveArcSketch(invalid);
let admission='refused',reason='';
try{buildArcWirePreview(invalid,invalidSolution,boundary,['holeA','holeB']);admission='preview';}
catch(error){reason=error.message;}
console.log(JSON.stringify({step:'oversized-radius-admission',
  constraintStatus:invalidSolution.status,admission,reason}));
