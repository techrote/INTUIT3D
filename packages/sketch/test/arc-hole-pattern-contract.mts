import {roundedPlateArcFixture,serializeArcSketch}
  from '@intuit3d/sketch/arc-constraints/v1';
import {createArcHoleSelection,serializeArcHoleSelection}
  from '@intuit3d/sketch/arc-hole-authoring/v1';
import {proposeArcHolePattern,inspectArcHolePattern,parseArcHolePattern,
  serializeArcHolePattern} from '@intuit3d/sketch/arc-hole-pattern/v1';
import type {ArcHolePattern,ArcHolePatternCommand,ArcHolePatternStamp,
  ArcHolePatternInspection,ArcHolePatternResult}
  from '@intuit3d/sketch/arc-hole-pattern/v1';

const sketch=roundedPlateArcFixture();
const selection=createArcHoleSelection({format:'intuit3d.arc-hole-selection',
  version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const stamp:ArcHolePatternStamp={
  sourceSignature:serializeArcSketch(sketch),
  selectionSignature:serializeArcHoleSelection(selection),
  patternSignature:null
};
const command:ArcHolePatternCommand={kind:'create',id:'boltGrid',sourceCircleId:'holeA',
  rows:2,columns:2,spacingXmm:20,spacingYmm:20};
const result:ArcHolePatternResult=proposeArcHolePattern(sketch,selection,null,command,stamp);
if(result.kind==='accepted'){
  const pattern:ArcHolePattern=parseArcHolePattern(serializeArcHolePattern(result.pattern));
  const inspected:ArcHolePatternInspection=inspectArcHolePattern(result.sketch,
    result.selection,pattern);
  const profileId:string=inspected.profile?.id??'';
  const next:ArcHolePatternCommand={kind:'reconfigure',rows:1,columns:2,
    spacingXmm:20,spacingYmm:20};
  const nextResult:ArcHolePatternResult=proposeArcHolePattern(
    result.sketch,result.selection,pattern,next,{
      sourceSignature:result.sourceSignature,
      selectionSignature:result.selectionSignature,
      patternSignature:result.patternSignature
    });
  void profileId;void nextResult;
}
