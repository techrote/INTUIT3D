import {roundedPlateArcFixture} from '@intuit3d/sketch/arc-constraints/v1';
import {createArcHoleSelection} from '@intuit3d/sketch/arc-hole-authoring/v1';
import {inspectArcHoleAnchor,proposeArcHoleAnchor,
  type ArcHoleAnchorCommand} from '@intuit3d/sketch/arc-hole-anchors/v1';
import {editArcProfileWithTool} from '@intuit3d/sketch/arc-profile-tools/v1';
const sketch=roundedPlateArcFixture();
const selection=createArcHoleSelection({format:'intuit3d.arc-hole-selection',version:1,
  profileId:'plate:main',boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const inspection=inspectArcHoleAnchor(sketch,selection,'holeB');
const bind:ArcHoleAnchorCommand={kind:'bind',circleId:'holeB',anchorPointId:'p1'};
const result=proposeArcHoleAnchor(sketch,selection,bind,inspection);
if(result.kind==='accepted'){
  const offset=result.binding.binding?.offsetXMm;
  if(typeof offset==='number')console.log(offset,result.profile.id);
  editArcProfileWithTool(result.sketch,result.selection,
    {kind:'hole-offset',circleId:'holeB',offsetXMm:-30,offsetYMm:40},
    {sourceSignature:result.sourceSignature,
      selectionSignature:result.selectionSignature});
}
