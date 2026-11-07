import {roundedPlateArcFixture} from '../arc-constraints.mjs';
import {createArcHoleSelection} from '../arc-hole-authoring.mjs';
import {proposeArcBoltCircle,inspectArcBoltCircle,
  type ArcBoltCircleStamp,type ArcBoltCircleCommand}
  from '../arc-bolt-circle.mjs';
const sketch=roundedPlateArcFixture();
const selected=createArcHoleSelection({
  format:'intuit3d.arc-hole-selection',version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const cmd:ArcBoltCircleCommand={kind:'create',id:'boltCircle',
  sourceCircleId:'holeA',centerXMm:35,centerYMm:25,count:3};
const expected:ArcBoltCircleStamp={sourceSignature:'',selectionSignature:'',
  patternSignature:null};
const result=proposeArcBoltCircle(sketch,selected,null,cmd,expected);
if(result.kind==='accepted'){
  const inspection=inspectArcBoltCircle(result.sketch,result.selection,result.pattern);
  const status:'synchronized'|'seed_changed'|'unresolved'=inspection.status;
  void status;
}
