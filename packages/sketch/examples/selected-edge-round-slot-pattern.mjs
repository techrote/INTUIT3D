import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {serializeSketch} from '../index.mjs';
import {createSelectedEdgeRoundSlotPattern,editSelectedEdgeRoundSlotPattern,
  parseSelectedEdgeRoundSlotPattern,serializeSelectedEdgeRoundSlotPattern,
  inspectSelectedEdgeRoundSlotPattern} from '../selected-edge-round-slot-pattern.mjs';

const source=createDimensionedLPlateSketch();
const candidate=discoverPlateProfiles(source).candidates.find(x=>x.lineIds.includes('L:edge0'));
if(!candidate)throw new Error('selected contour absent');
const selection={candidateId:candidate.id,sourceSignature:serializeSketch(source)};
const added=createSelectedEdgeRoundSlotPattern(source,selection,{
  kind:'create-selected-edge-round-slot-pattern',version:1,
  sourceSignature:serializeSketch(source),
  pattern:{id:'mount',edgeId:'L:edge0',count:3,
    firstCenterMm:20,pitchMm:23,widthMm:8,straightDepthMm:3}
});
if(added.kind!=='accepted')throw new Error(JSON.stringify(added));
const changed=editSelectedEdgeRoundSlotPattern(added.authoring,{
  kind:'edit-selected-edge-round-slot-pattern',version:1,
  sourceSignature:added.authoringSignature,
  count:3,firstCenterMm:21,pitchMm:24,widthMm:9,straightDepthMm:3
});
if(changed.kind!=='accepted')throw new Error(JSON.stringify(changed));
const reopened=inspectSelectedEdgeRoundSlotPattern(
  parseSelectedEdgeRoundSlotPattern(serializeSelectedEdgeRoundSlotPattern(changed.authoring)));
if(reopened.kind!=='selected_edge_round_slot_pattern')throw new Error(JSON.stringify(reopened));
console.log(JSON.stringify({slots:reopened.slots.map(s=>s.id),
  pitchMm:reopened.pattern.pitchMm,analyticArcs:reopened.arcSketch.arcs.length,
  solverStatus:reopened.solution.status,
  degreesOfFreedom:reopened.solution.degreesOfFreedom,
  materialAreaMm2:reopened.profile.materialAreaMm2,
  nativeExact:reopened.nativeExact}));
