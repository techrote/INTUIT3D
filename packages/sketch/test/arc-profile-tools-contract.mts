import {roundedPlateArcFixture} from '../arc-constraints.mjs';
import {createArcHoleSelection} from '../arc-hole-authoring.mjs';
import {inspectArcProfileTools,editArcProfileWithTool,
  type ArcProfileToolChange,type ArcProfileToolControl}
  from '../arc-profile-tools.mjs';
const doc=roundedPlateArcFixture();
const selection=createArcHoleSelection({format:'intuit3d.arc-hole-selection',
  version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const inspected=inspectArcProfileTools(doc,selection);
const change:ArcProfileToolChange={kind:'array',sourceCircleId:'holeA',
  patternId:'arrayA',rows:2,columns:2,spacingXmm:20,spacingYmm:20};
const edited=editArcProfileWithTool(doc,selection,change,{
  sourceSignature:inspected.sourceSignature,
  selectionSignature:inspected.selectionSignature});
if(edited.kind==='accepted'){
  const holes:number=edited.profile.holes.length;
  const first:ArcProfileToolControl|undefined=inspected.controls[0];
  void [holes,first,edited.createdIds,edited.sketch];
}else{
  const error:string=edited.reason;
  void error;
}

const handleChange:ArcProfileToolChange={
  kind:'drag-handle',handleId:'hole-center:holeA',xMm:31,yMm:40
};
const groupChange:ArcProfileToolChange={
  kind:'translate-holes',circleIds:['holeA','holeB'],deltaXMm:5,deltaYMm:2
};
for(const command of [handleChange,groupChange]){
  const result=editArcProfileWithTool(doc,selection,command,{
    sourceSignature:inspected.sourceSignature,
    selectionSignature:inspected.selectionSignature});
  if(result.kind==='accepted'){
    const applied:number|undefined=result.gesture?.deviationMm;
    const affected:string[]|undefined=result.movedHoleIds;
    void [applied,affected,result.profile.id];
  }
}
