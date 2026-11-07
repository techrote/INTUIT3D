import {parseSketch,serializeSketch,solveSketch} from '../index.mjs';
import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {inspectSelectedProfileHandles,editSelectedProfileHandle,
  moveSelectedProfileHoleCenter} from '../selected-profile-handles.mjs';

const initial=createDimensionedLPlateSketch();
const original=serializeSketch(initial);
let sketch=initial;
let discovery=discoverPlateProfiles(sketch);
let selection={candidateId:discovery.candidates[0].id,
  sourceSignature:discovery.inputSignature};
const describe=step=>{
  const state=inspectSelectedProfileHandles(sketch,selection);
  if(state.kind!=='selected_profile_handles')throw Error('selected profile unsolved');
  const pts=new Map(solveSketch(sketch).geometry.points.map(p=>[p.id,p]));
  const length=state.controls.find(h=>h.constraintId==='L:length');
  console.log(JSON.stringify({step,profileId:state.semanticProfileId,
    lengthMm:length.valueMm,
    lower:pts.get('L:holeLowerCenter'),upper:pts.get('L:holeUpperCenter'),
    nativeExact:false}));
  return state;
};
let state=describe('original');
let edited=moveSelectedProfileHoleCenter(sketch,selection,{
  kind:'move-hole-center',sourceSignature:state.sourceSignature,
  handleId:'hole-center:L:holeLower',xMm:100,yMm:18
});
if(edited.kind!=='accepted')throw Error(edited.reason);
sketch=edited.sketch;selection=edited.selection;
state=describe('move_lower_hole');
edited=editSelectedProfileHandle(sketch,selection,{
  kind:'set-dimension',sourceSignature:state.sourceSignature,
  handleId:'dimension:L:length',valueMm:150
});
if(edited.kind!=='accepted')throw Error(edited.reason);
sketch=edited.sketch;selection=edited.selection;
state=describe('resize_length');
edited=moveSelectedProfileHoleCenter(sketch,selection,{
  kind:'move-hole-center',sourceSignature:state.sourceSignature,
  handleId:'hole-center:L:holeUpper',xMm:18,yMm:65
});
if(edited.kind!=='accepted')throw Error(edited.reason);
sketch=edited.sketch;selection=edited.selection;
const saved=serializeSketch(sketch);
describe('move_upper_hole');
sketch=parseSketch(saved);
selection={...selection,sourceSignature:serializeSketch(sketch)};
describe('reopen');
sketch=parseSketch(original);
selection={candidateId:selection.candidateId,sourceSignature:serializeSketch(sketch)};
describe('undo');
