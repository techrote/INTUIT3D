import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {
  SELECTED_EDGE_HOLE_PLACEMENT_VERSION,inspectSelectedEdgeHolePlacement,
  setSelectedEdgeHoles,
  type SelectedEdgeHoleCommand,type SelectedEdgeHoleInspection,
  type SelectedEdgeHoleAcceptance,type SelectedEdgeHoleRefusal,
  type SelectedEdgeHole,type SelectedEdge
} from '../selected-edge-hole-placement.mjs';

const doc=createDimensionedLPlateSketch();
const found=discoverPlateProfiles(doc);
const selected={candidateId:found.candidates[0]!.id,
  sourceSignature:found.inputSignature};
const version:1=SELECTED_EDGE_HOLE_PLACEMENT_VERSION;
const inspected=inspectSelectedEdgeHolePlacement(doc,selected);
if(inspected.kind==='selected_edge_hole_placement'){
  const view:SelectedEdgeHoleInspection=inspected;
  const edge:SelectedEdge=view.edges[0]!;
  const hole:SelectedEdgeHole=view.holes[0]!;
  const command:SelectedEdgeHoleCommand={
    kind:'set-edge-holes',sourceSignature:view.sourceSignature,
    edits:[{holeId:hole.holeId,edgeId:edge.edgeId,
      alongMm:20,insetMm:15,radiusMm:hole.radiusMm}]
  };
  const result=setSelectedEdgeHoles(doc,selected,command);
  if(result.kind==='accepted'){
    const committed:SelectedEdgeHoleAcceptance=result;
    const journalSketch=committed.sketch;
    const boundId:string=committed.edits[0]!.anchorPointId;
    void journalSketch;void boundId;
  }else{
    const failed:SelectedEdgeHoleRefusal=result;
    void failed.sourceStatus;
  }
}
void version;
