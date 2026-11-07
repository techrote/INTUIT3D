import {roundedPlateArcFixture,solveArcSketch} from '@intuit3d/sketch/arc-constraints/v1';
import {prepareArcProfileForProvider,ARC_PROFILE_VERSION,ARC_PROFILE_FORMAT,
  type AnalyticArcProfile} from '@intuit3d/sketch/arc-profile/v1';
const source=roundedPlateArcFixture();
const version:1=ARC_PROFILE_VERSION;
const format:'intuit3d.analytic-arc-profile'=ARC_PROFILE_FORMAT;
const response:AnalyticArcProfile=prepareArcProfileForProvider(
  source,solveArcSketch(source),{
  profileId:'plate:profile',boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']
});
const previewOnly:false=response.nativeProfileAdmissible;
const notStep:false=response.stepQualified;
const pending:'analytic_2d_validated_pending_native'=response.status;
void [version,format,previewOnly,notStep,pending];
