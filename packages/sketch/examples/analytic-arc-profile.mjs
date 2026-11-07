import {roundedPlateArcFixture,solveArcSketch,editArcConstraint,editArcCircleRadius,
  serializeArcSketch,parseArcSketch} from '@intuit3d/sketch/arc-constraints/v1';
import {prepareArcProfileForProvider} from '@intuit3d/sketch/arc-profile/v1';
const boundaryIds=['bottom','arc1','right','arc2','top','arc3','left','arc0'];
const result=(label,doc)=>{
  const solution=solveArcSketch(doc);
  const p=prepareArcProfileForProvider(doc,solution,
    {profileId:'plate:main',boundaryIds,holeIds:['holeA','holeB']});
  console.log(JSON.stringify({label,id:p.id,status:p.status,
    materialAreaMm2:p.materialAreaMm2,curveIds:p.boundary.map(c=>c.id),
    circleIds:p.holes.map(c=>c.id),
    providerSubmissionReady:p.providerSubmissionReady,
    nativeProfileAdmissible:p.nativeProfileAdmissible,stepQualified:p.stepQualified}));
};
const original=roundedPlateArcFixture();
result('original',original);
let edited=editArcConstraint(original,'plate:width',{value:150});
edited=editArcConstraint(edited,'corner1:radius',{value:14});
edited=editArcCircleRadius(edited,'holeA',7);
result('revised',edited);
result('save-reopen',parseArcSketch(serializeArcSketch(edited)));
try{
  result('invalid-hole',editArcCircleRadius(edited,'holeA',45));
  throw Error('inadmissible hole was accepted');
}catch(e){
  if(e.message==='inadmissible hole was accepted')throw e;
  console.log(JSON.stringify({label:'invalid-hole',providerSubmissionReady:false,reason:e.message}));
}
