import {roundedPlateArcFixture} from '@intuit3d/sketch/arc-constraints/v1';
import {ARC_HOLE_AUTHORING_VERSION,createArcHoleSelection,
  inspectArcHoleControls,editArcProfileHole,serializeArcHoleSelection,
  type ArcHoleChange,type ArcHoleEditResult,type ArcHoleSelection}
  from '@intuit3d/sketch/arc-hole-authoring/v1';

const sketch=roundedPlateArcFixture();
const selected:ArcHoleSelection=createArcHoleSelection({
  format:'intuit3d.arc-hole-selection',version:ARC_HOLE_AUTHORING_VERSION,
  profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']
});
const handles=inspectArcHoleControls(sketch,selected);
const add:ArcHoleChange={kind:'add',circleId:'holeC',xMm:60,yMm:60,diameterMm:8};
const result:ArcHoleEditResult=editArcProfileHole(sketch,selected,add,{
  sourceSignature:handles.sourceSignature,selectionSignature:serializeArcHoleSelection(selected)
});
if(result.kind==='accepted') {
  const newSelection:ArcHoleSelection=result.selection;
  const status:'analytic_2d_validated_pending_native'=result.profile.status;
  const nativeExact:false=result.profile.exactBrepAvailable;
  void [newSelection,status,nativeExact,result.sketch,result.solution];
}else{
  const reason:string=result.reason;
  void reason;
}
