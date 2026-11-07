import {plateSketchFixture} from '../index.mjs';
import {createRoundedPlateIntent,editRoundedPlateRadius,solveRoundedPlate,
  serializeRoundedPlateIntent,parseRoundedPlateIntent} from '../rounded-plate.mjs';
import type {RoundedPlateIntent,RoundedPlateResult,RoundedBoundary} from '../rounded-plate.mjs';
const intent:RoundedPlateIntent=createRoundedPlateIntent({
  version:1,id:'fillet:plate',edgeIds:['bottom','right','top','left'],
  holeIds:['holeA','holeB'],radiusMm:8
});
const edited:RoundedPlateIntent=editRoundedPlateRadius(intent,10);
const restored:RoundedPlateIntent=parseRoundedPlateIntent(serializeRoundedPlateIntent(edited));
const result:RoundedPlateResult=solveRoundedPlate(plateSketchFixture(),restored);
if(result.geometry){
  const boundary:RoundedBoundary[]=result.geometry.boundary;
  const area:number=result.geometry.areaMm2;
  const previewOnly:true=result.geometry.previewOnly;
  void [boundary,area,previewOnly];
}
